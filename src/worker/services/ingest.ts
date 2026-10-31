import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { inboxEmails, transactions, type NewTransaction, type Transaction } from "../db/schema";
import { parseEmail, type ParsedEmail } from "../parsers/email";
import { htmlToText, toLines } from "../parsers/text";
import { categorize, categoryIdByName, loadRules, type Rule } from "./categorize";
import { findOrCreateAccount } from "./accounts";
import { getSettings } from "./settings";

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
  ctx: { emailId: number | null; rules?: Rule[]; owners?: string[] },
): Promise<{ status: "parsed" | "merged" | "duplicate"; ids: number[] }> {
  const rules = ctx.rules ?? (await loadRules(db));
  const owners = ctx.owners ?? (await getSettings(db)).ownerNames;
  const account = await findOrCreateAccount(db, p.provider, p.last4);
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
        categorize(rules, p.counterparty, p.merchant) ?? (await categoryIdByName(db, "Refund & Cashback"));
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
          categorize(rules, p.counterparty) ?? (await categoryIdByName(db, "Transfer ke Orang Lain"));
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
          categorize(rules, p.counterparty) ?? (await categoryIdByName(db, "Transfer Masuk"));
        main = { ...base, type: "income", accountId: account.id, merchant: p.counterparty, categoryId,
          description: "Transfer masuk", status: review ? "review" : "ok" };
      }
      break;
    }
    case "topup_out": {
      const target = await findOrCreateAccount(db, p.target!);
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
      const cash = await findOrCreateAccount(db, "cash");
      main = { ...base, type: "transfer", accountId: account.id, toAccountId: cash.id,
        merchant: "Tarik tunai", status: review ? "review" : "ok" };
      break;
    }
  }

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
      categoryId: await categoryIdByName(db, "Biaya Bank & Admin"),
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

export async function ingestEmail(db: DB, input: IngestEmailInput): Promise<IngestResult> {
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
  if (!email) return { emailId: null, status: "duplicate", transactionIds: [] };
  return processEmail(db, email.id);
}

/** (Ulang) proses satu email yang sudah tersimpan. */
export async function processEmail(db: DB, emailId: number): Promise<IngestResult> {
  const [email] = await db.select().from(inboxEmails).where(eq(inboxEmails.id, emailId));
  if (!email) throw new Error("email tidak ditemukan");
  const r = parseEmail({ from: email.fromAddr, subject: email.subject, body: email.body, date: email.receivedAt });
  if (!r.ok) {
    await db
      .update(inboxEmails)
      .set({ status: r.status, provider: r.provider, note: r.reason })
      .where(eq(inboxEmails.id, emailId));
    return { emailId, status: r.status, transactionIds: [], reason: r.reason };
  }
  const rec = await recordParsed(db, r.parsed, { emailId });
  const status = rec.status === "duplicate" ? "duplicate" : rec.status;
  await db
    .update(inboxEmails)
    .set({
      status: rec.status === "merged" ? "merged" : rec.status === "duplicate" ? "ignored" : "parsed",
      provider: r.parsed.provider,
      note: rec.status === "duplicate" ? "Transaksi sudah tercatat." : r.parsed.notes.join(" ") || null,
      transactionId: rec.ids[0] ?? null,
    })
    .where(eq(inboxEmails.id, emailId));
  return { emailId, status, transactionIds: rec.ids };
}

export async function reprocessUnparsed(db: DB): Promise<{ processed: number; parsed: number }> {
  const rows = await db
    .select({ id: inboxEmails.id })
    .from(inboxEmails)
    .where(sql`${inboxEmails.status} = 'unparsed'`);
  let parsed = 0;
  for (const r of rows) {
    const res = await processEmail(db, r.id);
    if (res.status === "parsed" || res.status === "merged") parsed++;
  }
  return { processed: rows.length, parsed };
}
