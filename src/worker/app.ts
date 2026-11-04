import { Hono } from "hono";
import { and, desc, eq, gte, ilike, lt, or, sql, inArray, type SQL } from "drizzle-orm";
import type { DB } from "./db/client";
import { accounts, categories, categoryRules, inboxEmails, transactions } from "./db/schema";
import { isLoggedIn, login, logout, requireIngestSecret, requireSession } from "./auth";
import { monthSummary } from "./services/summary";
import { listAccountsWithBalance } from "./services/balances";
import { learnRule, merchantKey } from "./services/categorize";
import { IngestContext, ingestEmail, ingestNotification, processEmail, reprocessUnparsed, type IngestEmailInput, type IngestNotificationInput } from "./services/ingest";

/**
 * Batas email yang diproses per request. Paket gratis Cloudflare Workers mengizinkan
 * 50 subrequest per request dan tiap query Neon dihitung satu; ±5–9 query per email.
 * Email di atas batas dikembalikan sebagai "deferred" agar dikirim ulang Apps Script.
 */
export const MAX_EMAILS_PER_REQUEST = 4;
import { importStatement } from "./services/importer";
import { getSettings, updateSettings } from "./services/settings";
import { monthRange, parseYm } from "../shared/time";
import { HttpError, TX_TYPES, bad, errorText, int, str, toDTO } from "./http";
import { registerExtraRoutes } from "./routes/extra";
import type { ImportRow, InboxEmailDTO, UndoPayload } from "../shared/types";

export interface Bindings {
  DATABASE_URL: string;
  APP_PASSWORD: string;
  SESSION_SECRET: string;
  INGEST_SECRET: string;
  /** Web Push (opsional) */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  APP_URL?: string;
}
export type AppEnv = { Bindings: Bindings; Variables: { db: DB } };

/** Validasi & normalisasi body transaksi (create/update). */
function txValues(body: Record<string, unknown>, partial: boolean) {
  const v: Partial<typeof transactions.$inferInsert> = {};
  if (body.type !== undefined || !partial) {
    if (!TX_TYPES.includes(body.type as never)) throw bad("type tidak valid");
    v.type = body.type as string;
  }
  const amount = int(body.amount, "amount", { optional: partial });
  if (amount !== undefined && amount !== null) v.amount = amount;
  const accountId = int(body.accountId, "accountId", { optional: true, nullable: true });
  if (accountId !== undefined) v.accountId = accountId;
  const toAccountId = int(body.toAccountId, "toAccountId", { optional: true, nullable: true });
  if (toAccountId !== undefined) v.toAccountId = toAccountId;
  const categoryId = int(body.categoryId, "categoryId", { optional: true, nullable: true });
  if (categoryId !== undefined) v.categoryId = categoryId;
  const merchant = str(body.merchant);
  if (merchant !== undefined) v.merchant = merchant;
  const description = str(body.description, 500);
  if (description !== undefined) v.description = description;
  if (body.occurredAt !== undefined || !partial) {
    const d = new Date(String(body.occurredAt ?? ""));
    if (Number.isNaN(d.getTime())) throw bad("occurredAt tidak valid");
    v.occurredAt = d;
  }
  if (body.status !== undefined) {
    if (body.status !== "ok" && body.status !== "review") throw bad("status tidak valid");
    v.status = body.status;
  }
  if (body.excluded !== undefined) v.excluded = Boolean(body.excluded);
  return v;
}

function checkTxShape(t: { type?: string; amount?: number; accountId?: number | null; toAccountId?: number | null }) {
  if (t.type === "adjustment") {
    if (!t.amount) throw bad("Nominal penyesuaian tidak boleh 0");
  } else if (t.amount !== undefined && t.amount <= 0) throw bad("Nominal harus lebih dari 0");
  if (t.type === "transfer") {
    if (t.accountId == null && t.toAccountId == null) throw bad("Transfer butuh akun asal atau tujuan");
    if (t.accountId != null && t.accountId === t.toAccountId) throw bad("Akun asal dan tujuan sama");
  } else if (t.type && t.accountId == null) {
    throw bad("Pilih akun");
  }
}

export function createApp(getDb: (env: Bindings) => DB) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: errorText(err) || "Terjadi kesalahan" }, 500);
  });

  app.use("*", async (c, next) => {
    c.set("db", getDb(c.env));
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // ---------- Auth ----------
  app.post("/auth/login", async (c) => {
    const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
    const ok = await login(c, String(body.password ?? ""));
    if (!ok) {
      await new Promise((r) => setTimeout(r, 400));
      return c.json({ error: "Password salah" }, 401);
    }
    return c.json({ ok: true });
  });
  app.post("/auth/logout", (c) => {
    logout(c);
    return c.json({ ok: true });
  });
  app.get("/auth/me", async (c) => c.json({ loggedIn: await isLoggedIn(c) }));

  // ---------- Ingest (Google Apps Script) ----------
  app.post("/ingest/email", requireIngestSecret, async (c) => {
    const body = await c.req.json<IngestEmailInput | { emails: IngestEmailInput[] }>();
    const list = "emails" in body ? body.emails : [body];
    if (!Array.isArray(list) || list.length > 100) throw bad("Maksimal 100 email per kiriman");
    if (list.some((e) => !e?.messageId)) throw bad("messageId wajib");
    const cache = new IngestContext(c.var.db);
    const results = [];
    for (const [i, e] of list.entries()) {
      if (i >= MAX_EMAILS_PER_REQUEST) {
        results.push({ messageId: e.messageId, status: "deferred" });
        continue;
      }
      try {
        results.push({ messageId: e.messageId, ...(await ingestEmail(c.var.db, e, cache)) });
      } catch (err) {
        console.error("ingest gagal", e.messageId, err);
        results.push({ messageId: e.messageId, status: "error", reason: errorText(err) });
      }
    }
    return c.json({ results });
  });

  /** Notifikasi HP yang diteruskan MacroDroid: { app, title, text, time }. */
  app.post("/ingest/notification", requireIngestSecret, async (c) => {
    const body = await c.req.json<IngestNotificationInput | { notifications: IngestNotificationInput[] }>().catch(() => null);
    if (!body) throw bad("Body harus JSON");
    const list = "notifications" in body ? body.notifications : [body];
    if (!Array.isArray(list) || list.length > MAX_EMAILS_PER_REQUEST) throw bad(`Maksimal ${MAX_EMAILS_PER_REQUEST} notifikasi per kiriman`);
    const cache = new IngestContext(c.var.db);
    const results = [];
    for (const n of list) {
      if (!n?.text) throw bad("text wajib");
      results.push(await ingestNotification(c.var.db, n, cache));
    }
    return c.json({ results });
  });

  // ---------- Semua di bawah ini butuh login ----------
  app.use("*", requireSession);

  registerExtraRoutes(app);

  app.get("/summary", async (c) => c.json(await monthSummary(c.var.db, parseYm(c.req.query("month")))));

  // Akun
  app.get("/accounts", async (c) => c.json(await listAccountsWithBalance(c.var.db)));
  app.post("/accounts", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const name = str(b.name, 60);
    if (!name) throw bad("Nama akun wajib");
    const [a] = await c.var.db
      .insert(accounts)
      .values({
        name,
        provider: str(b.provider, 30) ?? "other",
        kind: str(b.kind, 20) ?? "bank",
        last4: str(b.last4, 4) ?? null,
        openingBalance: int(b.openingBalance, "openingBalance", { optional: true }) ?? 0,
      })
      .returning();
    return c.json(a, 201);
  });
  app.patch("/accounts/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<Record<string, unknown>>();
    const v: Partial<typeof accounts.$inferInsert> = {};
    if (b.name !== undefined) v.name = str(b.name, 60) ?? "Akun";
    if (b.provider !== undefined) v.provider = str(b.provider, 30) ?? "other";
    if (b.kind !== undefined) v.kind = str(b.kind, 20) ?? "other";
    if (b.last4 !== undefined) v.last4 = str(b.last4, 4) ?? null;
    if (b.openingBalance !== undefined) v.openingBalance = int(b.openingBalance, "openingBalance") ?? 0;
    if (b.archived !== undefined) v.archived = Boolean(b.archived);
    const [a] = await c.var.db.update(accounts).set(v).where(eq(accounts.id, id)).returning();
    if (!a) throw new HttpError(404, "Akun tidak ditemukan");
    return c.json(a);
  });
  /** Sesuaikan saldo: masukkan saldo sebenarnya, selisihnya dicatat sebagai "penyesuaian" (bukan pengeluaran). */
  app.post("/accounts/:id/adjust", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ actualBalance?: number; note?: string }>();
    const actual = int(b.actualBalance, "actualBalance")!;
    const list = await listAccountsWithBalance(c.var.db);
    const acc = list.find((a) => a.id === id);
    if (!acc) throw new HttpError(404, "Akun tidak ditemukan");
    const delta = actual - acc.balance;
    if (delta === 0) return c.json({ delta: 0, transaction: null });
    const [t] = await c.var.db
      .insert(transactions)
      .values({
        type: "adjustment",
        amount: delta,
        accountId: id,
        merchant: "Penyesuaian saldo",
        description: str(b.note, 200) ?? null,
        occurredAt: new Date(),
        source: "manual",
      })
      .returning();
    return c.json({ delta, transaction: toDTO(t) });
  });

  // Kategori & aturan
  app.get("/categories", async (c) =>
    c.json(await c.var.db.select().from(categories).orderBy(categories.kind, categories.sort, categories.id)),
  );
  app.post("/categories", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const name = str(b.name, 40);
    if (!name) throw bad("Nama kategori wajib");
    const kind = b.kind === "income" ? "income" : "expense";
    const [row] = await c.var.db
      .insert(categories)
      .values({ name, icon: str(b.icon, 8) ?? "•", kind, sort: 500 })
      .returning();
    return c.json(row, 201);
  });
  app.patch("/categories/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<Record<string, unknown>>();
    const v: Partial<typeof categories.$inferInsert> = {};
    if (b.name !== undefined) v.name = str(b.name, 40) ?? "Kategori";
    if (b.icon !== undefined) v.icon = str(b.icon, 8) ?? "•";
    if (b.archived !== undefined) v.archived = Boolean(b.archived);
    if (b.monthlyBudget !== undefined) {
      const n = int(b.monthlyBudget, "monthlyBudget", { nullable: true });
      v.monthlyBudget = n && n > 0 ? n : null;
    }
    const [row] = await c.var.db.update(categories).set(v).where(eq(categories.id, id)).returning();
    if (!row) throw new HttpError(404, "Kategori tidak ditemukan");
    return c.json(row);
  });
  app.get("/rules", async (c) =>
    c.json(await c.var.db.select().from(categoryRules).orderBy(desc(categoryRules.createdAt), categoryRules.pattern)),
  );
  app.post("/rules", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const pattern = str(b.pattern, 60)?.toLowerCase();
    const categoryId = int(b.categoryId, "categoryId")!;
    if (!pattern || pattern.length < 2) throw bad("Kata kunci minimal 2 huruf");
    const [row] = await c.var.db
      .insert(categoryRules)
      .values({ pattern, categoryId, origin: "manual" })
      .onConflictDoUpdate({ target: categoryRules.pattern, set: { categoryId, origin: "manual" } })
      .returning();
    return c.json(row, 201);
  });
  app.delete("/rules/:id", async (c) => {
    await c.var.db.delete(categoryRules).where(eq(categoryRules.id, Number(c.req.param("id"))));
    return c.json({ ok: true });
  });

  // Transaksi
  app.get("/transactions", async (c) => {
    const q = c.req.query();
    const conds: (SQL | undefined)[] = [];
    if (q.month) {
      const { start, end } = monthRange(parseYm(q.month));
      conds.push(gte(transactions.occurredAt, start), lt(transactions.occurredAt, end));
    }
    if (q.type && TX_TYPES.includes(q.type as never)) conds.push(eq(transactions.type, q.type));
    if (q.status === "review" || q.status === "ok") conds.push(eq(transactions.status, q.status));
    if (q.accountId) {
      const id = Number(q.accountId);
      conds.push(or(eq(transactions.accountId, id), eq(transactions.toAccountId, id)));
    }
    if (q.categoryId === "none") conds.push(sql`${transactions.categoryId} is null`);
    else if (q.categoryId) conds.push(eq(transactions.categoryId, Number(q.categoryId)));
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conds.push(or(ilike(transactions.merchant, like), ilike(transactions.description, like)));
    }
    const limit = Math.min(Number(q.limit) || 500, 2000);
    const rows = await c.var.db
      .select()
      .from(transactions)
      .where(and(...conds))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(limit);
    return c.json(rows.map(toDTO));
  });

  app.post("/transactions", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const v = txValues(b, false) as typeof transactions.$inferInsert;
    checkTxShape(v);
    if (v.type !== "transfer") v.toAccountId = null;
    const [t] = await c.var.db.insert(transactions).values({ ...v, source: "manual" }).returning();
    let learned = 0;
    const undo: UndoPayload = { transactions: [], rule: null, deleteIds: [t.id] };
    if (b.remember && t.categoryId && (t.type === "expense" || t.type === "income")) {
      const r = await learnRule(c.var.db, t.merchant, t.categoryId, { exceptId: t.id });
      learned = r.applied;
      undo.transactions.push(...r.changed);
      if (r.pattern) undo.rule = { pattern: r.pattern, categoryId: r.previousRuleCategoryId };
    }
    return c.json({ transaction: toDTO(t), learned, undo }, 201);
  });

  app.patch("/transactions/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<Record<string, unknown>>();
    const [existing] = await c.var.db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) throw new HttpError(404, "Transaksi tidak ditemukan");
    const v = txValues(b, true);
    const merged = { ...existing, ...v };
    checkTxShape(merged);
    if (merged.type !== "transfer") v.toAccountId = null;
    // Mengubah kategori/tipe = sudah ditinjau.
    if (b.status === undefined && (v.categoryId !== undefined || v.type !== undefined)) v.status = "ok";
    const [t] = await c.var.db
      .update(transactions)
      .set({ ...v, updatedAt: new Date() })
      .where(eq(transactions.id, id))
      .returning();
    let learned = 0;
    let pattern: string | null = null;
    // Data untuk tombol "Batalkan": keadaan sebelum perubahan.
    const undo: UndoPayload = {
      transactions: [
        {
          id: existing.id,
          type: existing.type,
          amount: existing.amount,
          accountId: existing.accountId,
          toAccountId: existing.toAccountId,
          categoryId: existing.categoryId,
          merchant: existing.merchant,
          description: existing.description,
          occurredAt: existing.occurredAt.toISOString(),
          status: existing.status,
          excluded: existing.excluded,
        },
      ],
      rule: null,
    };
    if (b.remember && t.categoryId && (t.type === "expense" || t.type === "income")) {
      const r = await learnRule(c.var.db, t.rawMerchant ?? t.merchant ?? t.description, t.categoryId, { exceptId: t.id });
      learned = r.applied;
      pattern = r.pattern;
      undo.transactions.push(...r.changed);
      if (r.pattern) undo.rule = { pattern: r.pattern, categoryId: r.previousRuleCategoryId };
    }
    return c.json({ transaction: toDTO(t), learned, pattern, undo });
  });

  /** Kembalikan transaksi (dan aturan yang ikut dipelajari) ke keadaan sebelum diubah. */
  app.post("/undo", async (c) => {
    const b = await c.req.json<UndoPayload>();
    if (!Array.isArray(b.transactions) || b.transactions.length > 2000) throw bad("Data batalkan tidak valid");
    const del = (b.deleteIds ?? []).map(Number).filter(Number.isInteger);
    if (del.length) await c.var.db.delete(transactions).where(inArray(transactions.id, del));
    // Transaksi yang hanya berubah kategori/status dikembalikan per kelompok (hemat query).
    const simple = new Map<string, number[]>();
    const full: UndoPayload["transactions"] = [];
    for (const prev of b.transactions) {
      const keys = Object.keys(prev).filter((k) => k !== "id");
      if (keys.every((k) => k === "categoryId" || k === "status")) {
        const cat = prev.categoryId == null ? null : int(prev.categoryId, "categoryId");
        const status = prev.status === "ok" ? "ok" : "review";
        const k = `${cat}|${status}`;
        simple.set(k, [...(simple.get(k) ?? []), int(prev.id, "id")!]);
      } else full.push(prev);
    }
    for (const [k, ids] of simple) {
      const [cat, status] = k.split("|");
      await c.var.db
        .update(transactions)
        .set({ categoryId: cat === "null" ? null : Number(cat), status, updatedAt: new Date() })
        .where(inArray(transactions.id, ids));
    }
    for (const prev of full) {
      const id = int(prev.id, "id")!;
      const set: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() };
      if (prev.type !== undefined) {
        if (!TX_TYPES.includes(prev.type as never)) throw bad("type tidak valid");
        set.type = prev.type;
      }
      if (prev.amount !== undefined) set.amount = int(prev.amount, "amount")!;
      if (prev.accountId !== undefined) set.accountId = int(prev.accountId, "accountId", { nullable: true });
      if (prev.toAccountId !== undefined) set.toAccountId = int(prev.toAccountId, "toAccountId", { nullable: true });
      if (prev.categoryId !== undefined) set.categoryId = int(prev.categoryId, "categoryId", { nullable: true });
      if (prev.merchant !== undefined) set.merchant = str(prev.merchant) ?? null;
      if (prev.description !== undefined) set.description = str(prev.description, 500) ?? null;
      if (prev.occurredAt !== undefined) set.occurredAt = new Date(prev.occurredAt);
      if (prev.status === "ok" || prev.status === "review") set.status = prev.status;
      if (prev.excluded !== undefined) set.excluded = Boolean(prev.excluded);
      await c.var.db.update(transactions).set(set).where(eq(transactions.id, id));
    }
    for (const r of [...(b.rule ? [b.rule] : []), ...(b.rules ?? [])]) {
      if (!r?.pattern) continue;
      if (r.categoryId == null) await c.var.db.delete(categoryRules).where(eq(categoryRules.pattern, r.pattern));
      else await c.var.db.update(categoryRules).set({ categoryId: int(r.categoryId, "categoryId")! }).where(eq(categoryRules.pattern, r.pattern));
    }
    return c.json({ ok: true, restored: b.transactions.length });
  });

  app.delete("/transactions/:id", async (c) => {
    await c.var.db.delete(transactions).where(eq(transactions.id, Number(c.req.param("id"))));
    return c.json({ ok: true });
  });

  app.get("/merchant-key", (c) => c.json({ key: merchantKey(c.req.query("text")) }));

  // Kotak masuk email
  app.get("/inbox", async (c) => {
    const status = c.req.query("status");
    const rows = await c.var.db
      .select()
      .from(inboxEmails)
      .where(status ? eq(inboxEmails.status, status) : undefined)
      .orderBy(desc(inboxEmails.receivedAt))
      .limit(200);
    const out: InboxEmailDTO[] = rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      fromAddr: r.fromAddr,
      subject: r.subject,
      receivedAt: r.receivedAt.toISOString(),
      status: r.status,
      note: r.note,
      transactionId: r.transactionId,
      snippet: r.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
    }));
    return c.json(out);
  });
  app.get("/inbox/:id", async (c) => {
    const [r] = await c.var.db.select().from(inboxEmails).where(eq(inboxEmails.id, Number(c.req.param("id"))));
    if (!r) throw new HttpError(404, "Email tidak ditemukan");
    return c.json(r);
  });
  app.post("/inbox/:id/reprocess", async (c) => c.json(await processEmail(c.var.db, Number(c.req.param("id")))));
  app.post("/inbox/:id/ignore", async (c) => {
    await c.var.db
      .update(inboxEmails)
      .set({ status: "ignored", note: "Diabaikan manual." })
      .where(eq(inboxEmails.id, Number(c.req.param("id"))));
    return c.json({ ok: true });
  });
  app.post("/inbox/reprocess-all", async (c) => c.json(await reprocessUnparsed(c.var.db, MAX_EMAILS_PER_REQUEST, Number(c.req.query("after")) || 0)));

  // Impor mutasi
  app.post("/import", async (c) => {
    const b = await c.req.json<{ accountId?: number; filename?: string; rows?: ImportRow[] }>();
    const accountId = int(b.accountId, "accountId")!;
    if (!Array.isArray(b.rows) || !b.rows.length) throw bad("Tidak ada baris untuk diimpor");
    if (b.rows.length > 5000) throw bad("Maksimal 5.000 baris per impor");
    const rows = b.rows.map((r) => ({
      date: String(r.date),
      description: String(r.description ?? "").slice(0, 300),
      amount: Math.round(Number(r.amount)),
    }));
    return c.json(await importStatement(c.var.db, { accountId, filename: str(b.filename, 120) ?? undefined, rows }));
  });

  // Pengaturan
  app.get("/settings", async (c) => c.json(await getSettings(c.var.db)));
  app.patch("/settings", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = {};
    if (b.monthlyBudget !== undefined) patch.monthlyBudget = int(b.monthlyBudget, "monthlyBudget", { nullable: true });
    if (b.ownerNames !== undefined) {
      if (!Array.isArray(b.ownerNames)) throw bad("ownerNames harus daftar");
      patch.ownerNames = b.ownerNames.map((s) => String(s).trim()).filter(Boolean).slice(0, 10);
    }
    if (b.checklistDismissed !== undefined) patch.checklistDismissed = Boolean(b.checklistDismissed);
    return c.json(await updateSettings(c.var.db, patch));
  });

  return app;
}
