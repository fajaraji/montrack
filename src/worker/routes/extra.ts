import type { Hono } from "hono";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import { recurringFees, transactions } from "../db/schema";
import { listFees, runRecurringFees, startMonthFor } from "../services/fees";
import { HttpError, bad, int, str, toDTO } from "../http";
import { learnRule } from "../services/categorize";
import { suggestCategories } from "../services/suggest";
import { deleteRename, loadRenames, upsertRename } from "../services/renames";
import { exportTransactionsCsv } from "../services/exportCsv";
import { getChecklist } from "../services/checklist";
import { buildReports, weekStartWib, weeklyRecap } from "../services/reports";
import { detectRecurring } from "../services/recurring";
import { splitTransaction, unsplitTransaction } from "../services/split";
import { parseYm, fromWib } from "../../shared/time";
import type { ReviewItemDTO, UndoPayload } from "../../shared/types";

export function registerExtraRoutes(app: Hono<AppEnv>) {
  // ---------- Tinjau ----------
  app.get("/review", async (c) => {
    const rows = await c.var.db
      .select()
      .from(transactions)
      .where(eq(transactions.status, "review"))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(300);
    const sugg = await suggestCategories(c.var.db, rows.filter((r) => r.type === "expense" || r.type === "income"));
    const out: ReviewItemDTO[] = rows.map((r) => ({ ...toDTO(r), suggestions: sugg.get(r.id) ?? [] }));
    return c.json(out);
  });

  /** Ubah banyak transaksi sekaligus (kategori / tandai benar / abaikan / hapus), dengan data Batalkan. */
  app.post("/transactions/bulk", async (c) => {
    const b = await c.req.json<{ ids?: number[]; categoryId?: number | null; status?: string; excluded?: boolean; remember?: boolean; delete?: boolean }>();
    const ids = [...new Set((b.ids ?? []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw bad("Tidak ada transaksi dipilih");
    if (ids.length > 500) throw bad("Maksimal 500 transaksi sekaligus");
    if (b.delete) {
      await c.var.db.delete(transactions).where(inArray(transactions.id, ids));
      return c.json({ ok: true, count: ids.length });
    }
    const before = await c.var.db.select().from(transactions).where(inArray(transactions.id, ids));
    const undo: UndoPayload = {
      transactions: before.map((t) => ({ id: t.id, categoryId: t.categoryId, status: t.status, excluded: t.excluded })),
      rule: null,
      rules: [],
    };
    const set: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() };
    if (b.categoryId !== undefined) {
      set.categoryId = int(b.categoryId, "categoryId", { nullable: true });
      set.status = "ok";
    }
    if (b.status === "ok" || b.status === "review") set.status = b.status;
    if (b.excluded !== undefined) set.excluded = Boolean(b.excluded);
    await c.var.db.update(transactions).set(set).where(inArray(transactions.id, ids));

    let learned = 0;
    if (b.remember && set.categoryId) {
      // Satu aturan per merchant berbeda (dibatasi agar tetap di bawah batas query Workers).
      const seen = new Set<string>();
      for (const t of before) {
        if (t.type !== "expense" && t.type !== "income") continue;
        const text = t.rawMerchant ?? t.merchant ?? t.description;
        const k = (text ?? "").toLowerCase();
        if (!k || seen.has(k) || seen.size >= 6) continue;
        seen.add(k);
        const r = await learnRule(c.var.db, text, set.categoryId, { exceptId: t.id });
        learned += r.applied;
        const already = new Set(undo.transactions.map((x) => x.id));
        undo.transactions.push(...r.changed.filter((x) => !already.has(x.id)));
        if (r.pattern) undo.rules!.push({ pattern: r.pattern, categoryId: r.previousRuleCategoryId });
      }
    }
    return c.json({ ok: true, count: ids.length, learned, undo });
  });

  // ---------- Ganti nama merchant ----------
  app.get("/renames", async (c) => c.json(await loadRenames(c.var.db)));
  app.post("/renames", async (c) => {
    const b = await c.req.json<{ raw?: string; name?: string; pattern?: string }>();
    const name = str(b.name, 80);
    const raw = str(b.raw, 200) ?? str(b.pattern, 60);
    if (!name || !raw) throw bad("Isi nama merchant asli dan nama baru");
    try {
      return c.json(await upsertRename(c.var.db, raw, name, str(b.pattern, 60) ?? undefined), 201);
    } catch (e) {
      throw bad((e as Error).message);
    }
  });
  app.delete("/renames/:id", async (c) => {
    await deleteRename(c.var.db, Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  // ---------- Saran catat cepat ----------
  app.get("/suggestions/merchants", async (c) => {
    const since = new Date(Date.now() - 90 * 86400_000);
    const rows = await c.var.db
      .select({
        merchant: transactions.merchant,
        categoryId: sql<number | null>`mode() within group (order by ${transactions.categoryId})`,
        accountId: sql<number | null>`mode() within group (order by ${transactions.accountId})`,
        amount: sql<number>`(mode() within group (order by ${transactions.amount}))::bigint`,
        n: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(and(eq(transactions.type, "expense"), isNotNull(transactions.merchant), gte(transactions.occurredAt, since)))
      .groupBy(transactions.merchant)
      .orderBy(desc(sql`count(*)`))
      .limit(8);
    return c.json(rows.map((r) => ({ ...r, amount: Number(r.amount) })));
  });

  // ---------- Ekspor ----------
  app.get("/export.csv", async (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const d = (s?: string) => {
      const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? fromWib(+m[1], +m[2], +m[3]) : undefined;
    };
    const toDate = d(to);
    const csv = await exportTransactionsCsv(c.var.db, { from: d(from), to: toDate ? new Date(toDate.getTime() + 86400_000) : undefined });
    const stamp = new Date().toISOString().slice(0, 10);
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="montrack-${stamp}.csv"`,
    });
  });

  // ---------- Checklist, laporan, rekap, tagihan ----------
  app.get("/checklist", async (c) => c.json(await getChecklist(c.var.db)));
  app.get("/reports", async (c) => c.json(await buildReports(c.var.db, parseYm(c.req.query("month")), 6)));
  app.get("/recap", async (c) => {
    const q = c.req.query("week")?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const start = q ? weekStartWib(fromWib(+q[1], +q[2], +q[3], 12)) : new Date(weekStartWib(new Date()).getTime() - 7 * 86400_000);
    return c.json(await weeklyRecap(c.var.db, start));
  });
  app.get("/recurring", async (c) => c.json(await detectRecurring(c.var.db)));

  // ---------- Bagi transaksi ----------
  app.post("/transactions/:id/split", async (c) => {
    const b = await c.req.json<{ parts?: { amount: number; categoryId: number | null; description?: string }[] }>();
    const parts = (b.parts ?? []).map((p) => ({
      amount: int(p.amount, "amount")!,
      categoryId: int(p.categoryId, "categoryId", { optional: true, nullable: true }) ?? null,
      description: str(p.description, 200) ?? null,
    }));
    try {
      const rows = await splitTransaction(c.var.db, Number(c.req.param("id")), parts);
      return c.json(rows.map(toDTO));
    } catch (e) {
      throw bad((e as Error).message);
    }
  });
  app.post("/transactions/:id/unsplit", async (c) => {
    try {
      return c.json(toDTO(await unsplitTransaction(c.var.db, Number(c.req.param("id")))));
    } catch (e) {
      throw bad((e as Error).message);
    }
  });
  app.get("/transactions/:id/split", async (c) => {
    const id = Number(c.req.param("id"));
    const [t] = await c.var.db.select().from(transactions).where(eq(transactions.id, id));
    if (!t) throw new HttpError(404, "Transaksi tidak ditemukan");
    const group = t.splitGroupId ? await c.var.db.select().from(transactions).where(eq(transactions.splitGroupId, t.splitGroupId)).orderBy(transactions.id) : [t];
    return c.json(group.map(toDTO));
  });



  // ---------- Biaya rutin ----------
  app.get("/fees", async (c) => c.json(await listFees(c.var.db)));
  const feeValues = (b: Record<string, unknown>, partial: boolean) => {
    const v: Partial<typeof recurringFees.$inferInsert> = {};
    if (b.name !== undefined || !partial) {
      const name = str(b.name, 60);
      if (!name) throw bad("Nama biaya wajib");
      v.name = name;
    }
    if (b.amount !== undefined || !partial) {
      const a = int(b.amount, "amount")!;
      if (a <= 0) throw bad("Nominal harus lebih dari 0");
      v.amount = a;
    }
    if (b.accountId !== undefined || !partial) v.accountId = int(b.accountId, "accountId")!;
    if (b.categoryId !== undefined) v.categoryId = int(b.categoryId, "categoryId", { nullable: true }) ?? null;
    if (b.dayOfMonth !== undefined || !partial) {
      const d = int(b.dayOfMonth, "dayOfMonth")!;
      if (d < 1 || d > 31) throw bad("Tanggal harus 1–31");
      v.dayOfMonth = d;
    }
    if (b.active !== undefined) v.active = Boolean(b.active);
    return v;
  };
  app.post("/fees", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const v = feeValues(b, false) as typeof recurringFees.$inferInsert;
    const [f] = await c.var.db
      .insert(recurringFees)
      .values({ ...v, startMonth: startMonthFor(Boolean(b.startNextMonth)) })
      .returning();
    const recorded = await runRecurringFees(c.var.db);
    return c.json({ fee: f, recorded }, 201);
  });
  app.patch("/fees/:id", async (c) => {
    const [f] = await c.var.db.update(recurringFees).set(feeValues(await c.req.json(), true)).where(eq(recurringFees.id, Number(c.req.param("id")))).returning();
    if (!f) throw new HttpError(404, "Biaya tidak ditemukan");
    return c.json(f);
  });
  app.delete("/fees/:id", async (c) => {
    await c.var.db.delete(recurringFees).where(eq(recurringFees.id, Number(c.req.param("id"))));
    return c.json({ ok: true });
  });
}
