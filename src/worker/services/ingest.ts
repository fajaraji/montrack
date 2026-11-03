import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, categories, inboxEmails, transactions, type Account, type InboxEmail, type NewTransaction, type Transaction } from "../db/schema";
import { parseEmail, type ParsedEmail } from "../parsers/email";
import { htmlToText, toLines } from "../parsers/text";
import { categorize, loadRules, type Rule } from "./categorize";
import { getSettings } from "./settings";
import { PROVIDERS } from "../../shared/types";

/**
 * Cache per request. Cloudflare Workers (paket gratis) membatasi 50 subrequest per
 * request, dan setiap query Neon = 1 subrequest. Data referensi (aturan, pengaturan,
 * kategori, akun) dimuat sekali saja untuk semua email dalam satu kiriman.
 */
export class IngestContext {
  private rules?: Rule[];
  private owners?: string[];
  private cats?: Map<string, number>;
  private accs?: Account[];
  constructor(private db: DB) {}

  async getRules() {
    return (this.rules ??= await loadRules(this.db));
  }
  async getOwners() {
    return (this.owners ??= (await getSettings(this.db)).ownerNames);
  }
  async categoryId(name: string): Promise<number | null> {
    if (!this.cats) {
      const rows = await this.db.select({ id: categories.id, name: categories.name }).from(categories);
      this.cats = new Map(rows.map((r) => [r.name, r.id]));
    }
    return this.cats.get(name) ?? null;
  }
  /** Akun untuk provider (prioritas 4 digit terakhir yang cocok); dibuat otomatis bila belum ada. */
  async account(provider: string, last4?: string | null): Promise<Account> {
    this.accs ??= await this.db.select().from(accounts).orderBy(accounts.id);
    const rows = this.accs.filter((a) => a.provider === provider && !a.archived);
    if (rows.length) return (last4 && rows.find((a) => a.last4 === last4)) || rows[0];
    const def = PROVIDERS.find((x) => x.id === provider);
    const [created] = await this.db
      .insert(accounts)
      .values({ name: def?.label ?? provider.toUpperCase(), provider, kind: def?.kind ?? "other", last4: last4 ?? null })
      .returning();
    this.accs.push(created);
    return created;
  }
}

export interface IngestEmailInput {
  messageId: string;
  from: string;
  subject: string;
  body: string;
  date: string | Date;
}

export interface IngestResult {
  emailId: number | null;
  status: "duplicate" | "parsed" | "merged" | "ignored" | "unparsed";
  transactionIds: number[];
  reason?: string;
}

const MERGE_WINDOW_MS = 30 * 60 * 1000;

function isOwner(name: string | null, owners: string[]): boolean {
  if (!name) return false;
  const n = name.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return owners.some((o) => {
    const k = o.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
    return k.length >= 3 && (n.includes(k) || k.includes(n));
  });
}

function fingerprintOf(p: ParsedEmail, suffix = ""): string {
  if (p.reference) return `email:${p.provider}:${p.reference}${suffix}`;
  const minute = Math.floor(p.occurredAt.getTime() / 60000);
  return `email:${p.provider}:${p.kind}:${p.amount}:${minute}:${(p.merchant ?? p.counterparty ?? "").toLowerCase()}${suffix}`;
}

/**
 * Cari transfer pasangan (mis. "Top Up GoPay" dari BRI + "Top Up berhasil" dari GoPay)
 * dengan nominal sama dalam ±30 menit, lalu lengkapi sisi yang masih kosong.
 */
async function mergeTransfer(db: DB, t: NewTransaction): Promise<Transaction | null> {
  const at = t.occurredAt as Date;
  const candidates = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "transfer"),
        eq(transactions.amount, t.amount),
        gte(transactions.occurredAt, new Date(at.getTime() - MERGE_WINDOW_MS)),
        lte(transactions.occurredAt, new Date(at.getTime() + MERGE_WINDOW_MS)),
      ),
    );
  for (const e of candidates) {
    const fromOk = e.accountId == null || t.accountId == null || e.accountId === t.accountId;
    const toOk = e.toAccountId == null || t.toAccountId == null || e.toAccountId === t.toAccountId;
    // Pasangan = satu email dari sisi pengirim, satu dari sisi penerima:
    // salah satu sisinya harus "tidak diketahui" di salah satu transaksi saja.
    const complementary =
      (e.accountId == null) !== (t.accountId == null) || (e.toAccountId == null) !== (t.toAccountId == null);
    if (!fromOk || !toOk || !complementary) continue;
    // Jangan gabungkan dua kali ke transaksi yang sama.
    const [already] = await db
      .select({ id: inboxEmails.id })
      .from(inboxEmails)
      .where(and(eq(inboxEmails.transactionId, e.id), eq(inboxEmails.status, "merged")))
      .limit(1);
    if (already) continue;
    const [updated] = await db
      .update(transactions)
      .set({
        accountId: e.accountId ?? t.accountId ?? null,
        toAccountId: e.toAccountId ?? t.toAccountId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, e.id))
      .returning();
    return updated;
  }
  return null;
}

async function insertTx(db: DB, t: NewTransaction): Promise<Transaction | null> {
  const rows = await db.insert(transactions).values(t).onConflictDoNothing().returning();
  return rows[0] ?? null;
}

/** Ubah hasil parse menjadi transaksi. Mengembalikan transaksi utama + biaya (jika ada). */
export async function recordParsed(
  db: DB,
  p: ParsedEmail,
  ctx: { emailId: number | null; subject?: string; cache?: IngestContext },
): Promise<{ status: "parsed" | "merged" | "duplicate"; ids: number[] }> {
  const cache = ctx.cache ?? new IngestContext(db);
  const rules = await cache.getRules();
  const owners = await cache.getOwners();
  const account = await cache.account(p.provider, p.last4);
  const review = p.confidence === "low";
  const base = {
    amount: p.amount,
    occurredAt: p.occurredAt,
    source: "email" as const,
    emailId: ctx.emailId,
    fingerprint: fingerprintOf(p),
  };

  let main: NewTransaction;
  switch (p.kind) {
    case "expense": {
      const categoryId = categorize(rules, p.merchant, p.counterparty);
      main = { ...base, type: "expense", accountId: account.id, merchant: p.merchant, categoryId,
        status: review || categoryId == null ? "review" : "ok" };
      break;
    }
    case "income": {
      const categoryId =
        categorize(rules, p.counterparty, p.merchant) ?? (await cache.categoryId("Refund & Cashback"));
      main = { ...base, type: "income", accountId: account.id, merchant: p.counterparty, categoryId,
        status: review ? "review" : "ok" };
      break;
    }
    case "transfer_out": {
      if (isOwner(p.counterparty, owners)) {
        main = { ...base, type: "transfer", accountId: account.id, toAccountId: null, merchant: p.counterparty,
          description: "Transfer ke rekening sendiri", status: review ? "review" : "ok" };
      } else {
        const categoryId =
          categorize(rules, p.counterparty) ?? (await cache.categoryId("Transfer ke Orang Lain"));
        main = { ...base, type: "expense", accountId: account.id, merchant: p.counterparty, categoryId,
          description: "Transfer keluar", status: "review" };
      }
      break;
    }
    case "transfer_in": {
      if (isOwner(p.counterparty, owners)) {
        main = { ...base, type: "transfer", accountId: null, toAccountId: account.id, merchant: p.counterparty,
          description: "Transfer dari rekening sendiri", status: review ? "review" : "ok" };
      } else {
        const categoryId =
          categorize(rules, p.counterparty) ?? (await cache.categoryId("Transfer Masuk"));
        main = { ...base, type: "income", accountId: account.id, merchant: p.counterparty, categoryId,
          description: "Transfer masuk", status: review ? "review" : "ok" };
      }
      break;
    }
    case "topup_out": {
      const target = await cache.account(p.target!);
      main = { ...base, type: "transfer", accountId: account.id, toAccountId: target.id,
        merchant: `Top up ${target.name}`, status: review ? "review" : "ok" };
      break;
    }
    case "topup_in": {
      main = { ...base, type: "transfer", accountId: null, toAccountId: account.id,
        merchant: `Top up ${account.name}`, description: p.counterparty ? `dari ${p.counterparty}` : null,
        status: review ? "review" : "ok" };
      break;
    }
    case "withdraw": {
      const cash = await cache.account("cash");
      main = { ...base, type: "transfer", accountId: account.id, toAccountId: cash.id,
        merchant: "Tarik tunai", status: review ? "review" : "ok" };
      break;
    }
  }

  // Tanpa nama merchant/pengirim: pakai subjek email sebagai keterangan.
  if (!main.merchant && !main.description && ctx.subject) main.description = ctx.subject.slice(0, 200);

  const ids: number[] = [];
  let status: "parsed" | "merged" | "duplicate" = "parsed";

  if (main.type === "transfer") {
    const merged = await mergeTransfer(db, main);
    if (merged) {
      status = "merged";
      ids.push(merged.id);
    }
  }
  if (status !== "merged") {
    const inserted = await insertTx(db, main);
    if (inserted) ids.push(inserted.id);
    else status = "duplicate";
  }

  if (p.fee > 0 && status !== "duplicate") {
    const feeTx = await insertTx(db, {
      type: "expense",
      amount: p.fee,
      accountId: account.id,
      merchant: "Biaya admin",
      description: main.merchant ? `Biaya untuk ${main.merchant}` : null,
      categoryId: await cache.categoryId("Biaya Bank & Admin"),
      occurredAt: p.occurredAt,
      source: "email",
      status: "ok",
      emailId: ctx.emailId,
      fingerprint: fingerprintOf(p, ":fee"),
    });
    if (feeTx) ids.push(feeTx.id);
  }
  return { status, ids };
}

/** HTML → teks per baris (sel tabel dipisah tab) agar hemat ruang dan mudah dibaca ulang. */
function normalizeBody(body: string): string {
  if (!/<[a-z][\s\S]*>/i.test(body)) return body;
  return toLines(htmlToText(body)).join("\n");
}

export async function ingestEmail(db: DB, input: IngestEmailInput, cache = new IngestContext(db)): Promise<IngestResult> {
  const receivedAt = new Date(input.date);
  const date = Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt;
  const [email] = await db
    .insert(inboxEmails)
    .values({
      messageId: input.messageId,
      fromAddr: input.from ?? "",
      subject: input.subject ?? "",
      body: normalizeBody(input.body ?? "").slice(0, 50_000),
      receivedAt: date,
    })
    .onConflictDoNothing()
    .returning();
  if (email) return processEmail(db, email, cache);
  // Sudah pernah diterima. Kalau dulu gagal diproses (status masih "unparsed" tanpa catatan),
  // proses ulang sekarang, bukan dianggap duplikat.
  const [existing] = await db.select().from(inboxEmails).where(eq(inboxEmails.messageId, input.messageId));
  if (existing && existing.status === "unparsed" && existing.note == null) return processEmail(db, existing, cache);
  return { emailId: existing?.id ?? null, status: "duplicate", transactionIds: [] };
}

/** (Ulang) proses satu email yang sudah tersimpan. */
export async function processEmail(db: DB, emailOrId: number | InboxEmail, cache = new IngestContext(db)): Promise<IngestResult> {
  let email: InboxEmail | undefined;
  if (typeof emailOrId === "number") [email] = await db.select().from(inboxEmails).where(eq(inboxEmails.id, emailOrId));
  else email = emailOrId;
  if (!email) throw new Error("email tidak ditemukan");
  const emailId = email.id;
  const r = parseEmail({ from: email.fromAddr, subject: email.subject, body: email.body, date: email.receivedAt });
  if (!r.ok) {
    await db
      .update(inboxEmails)
      .set({ status: r.status, provider: r.provider, note: r.reason })
      .where(eq(inboxEmails.id, emailId));
    return { emailId, status: r.status, transactionIds: [], reason: r.reason };
  }
  const rec = await recordParsed(db, r.parsed, { emailId, subject: email.subject, cache });
  await db
    .update(inboxEmails)
    .set({
      status: rec.status === "merged" ? "merged" : rec.status === "duplicate" ? "ignored" : "parsed",
      provider: r.parsed.provider,
      note: rec.status === "duplicate" ? "Transaksi sudah tercatat." : r.parsed.notes.join(" ") || "",
      transactionId: rec.ids[0] ?? null,
    })
    .where(eq(inboxEmails.id, emailId));
  return { emailId, status: rec.status, transactionIds: rec.ids };
}

/** Proses ulang email "belum terbaca", sedikit demi sedikit agar tidak melewati batas subrequest. */
export async function reprocessUnparsed(
  db: DB,
  limit = 5,
  afterId = 0,
): Promise<{ processed: number; parsed: number; remaining: number; lastId: number }> {
  const rows = await db
    .select()
    .from(inboxEmails)
    .where(sql`${inboxEmails.status} = 'unparsed' and ${inboxEmails.id} > ${afterId}`)
    .orderBy(inboxEmails.id)
    .limit(limit + 1);
  const batch = rows.slice(0, limit);
  const cache = new IngestContext(db);
  let parsed = 0;
  for (const r of batch) {
    const res = await processEmail(db, r, cache);
    if (res.status === "parsed" || res.status === "merged") parsed++;
  }
  return {
    processed: batch.length,
    parsed,
    remaining: rows.length > limit ? 1 : 0,
    lastId: batch.length ? batch[batch.length - 1].id : afterId,
  };
}
