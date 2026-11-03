import { and, eq, gte, lte, or, isNull, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, importBatches, importRows, transactions } from "../db/schema";
import type { ImportResultDTO, ImportRow } from "../../shared/types";
import { fromWib } from "../../shared/time";
import { categorize, loadRules } from "./categorize";
import { IngestContext } from "./ingest";

const DAY = 86400_000;
const EWALLET_IN_DESC: [string, RegExp][] = [
  ["gopay", /go-?pay/i],
  ["ovo", /\bovo\b/i],
  ["dana", /\bdana\b/i],
  ["shopeepay", /shopee ?pay/i],
  ["linkaja", /link ?aja/i],
];

function rowDate(r: ImportRow): Date {
  const [y, m, d] = r.date.split("-").map(Number);
  return fromWib(y, m, d, 12, 0); // tengah hari WIB: aman untuk pencocokan ±1 hari
}

/**
 * Impor mutasi: setiap baris dicocokkan dengan transaksi yang sudah ada (dari email/manual)
 * pada akun yang sama, nominal sama, tanggal ±1 hari. Yang tidak cocok (mis. biaya admin
 * bulanan, bunga, auto-debit) dimasukkan sebagai transaksi baru.
 *
 * Jumlah query dibuat tetap (±10) berapa pun banyaknya baris, karena paket gratis
 * Cloudflare Workers membatasi 50 subrequest (query Neon) per request.
 */
export async function importStatement(
  db: DB,
  input: { accountId: number; filename?: string; rows: ImportRow[] },
): Promise<ImportResultDTO> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!account) throw new Error("Akun tidak ditemukan");
  const rules = await loadRules(db);
  const cache = new IngestContext(db);

  const [batch] = await db
    .insert(importBatches)
    .values({ accountId: account.id, filename: input.filename ?? null, rowCount: input.rows.length })
    .returning();
  const result: ImportResultDTO = { batchId: batch.id, inserted: 0, matched: 0, skipped: 0, rows: [] };

  // 1) Sidik jari tiap baris (baris identik di hari yang sama dibedakan urutannya).
  const seen = new Map<string, number>();
  type Prepared = { index: number; row: ImportRow; fingerprint: string; at: Date };
  const valid: Prepared[] = [];
  const outcome = new Map<number, { result: "inserted" | "matched" | "skipped"; transactionId: number | null }>();
  for (const [index, r] of input.rows.entries()) {
    if (!r.amount || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      outcome.set(index, { result: "skipped", transactionId: null });
      continue;
    }
    const baseKey = `import:${account.id}:${r.date}:${r.amount}:${r.description.trim().toLowerCase()}`;
    const n = (seen.get(baseKey) ?? 0) + 1;
    seen.set(baseKey, n);
    valid.push({ index, row: r, fingerprint: `${baseKey}:${n}`, at: rowDate(r) });
  }

  // 2) Baris yang sudah pernah diimpor (satu query).
  const already = new Map<string, number | null>();
  if (valid.length) {
    const rows = await db
      .select({ fingerprint: importRows.fingerprint, transactionId: importRows.transactionId })
      .from(importRows)
      .where(inArray(importRows.fingerprint, valid.map((v) => v.fingerprint)));
    for (const r of rows) already.set(r.fingerprint, r.transactionId);
  }
  const fresh = valid.filter((v) => {
    if (!already.has(v.fingerprint)) return true;
    outcome.set(v.index, { result: "skipped", transactionId: already.get(v.fingerprint) ?? null });
    return false;
  });

  // 3) Kandidat pencocokan di rentang tanggal mutasi (satu query), lalu cocokkan di memori.
  const matchedIds: number[] = [];
  const toInsert: { p: Prepared; values: typeof transactions.$inferInsert }[] = [];
  if (fresh.length) {
    const minAt = Math.min(...fresh.map((v) => v.at.getTime())) - 1.5 * DAY;
    const maxAt = Math.max(...fresh.map((v) => v.at.getTime())) + 1.5 * DAY;
    const candidates = await db
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.occurredAt, new Date(minAt)),
          lte(transactions.occurredAt, new Date(maxAt)),
          isNull(transactions.importBatchId),
          or(eq(transactions.accountId, account.id), eq(transactions.toAccountId, account.id)),
        ),
      );
    const used = new Set<number>();
    for (const v of fresh) {
      const abs = Math.abs(v.row.amount);
      const out = v.row.amount < 0;
      const match = candidates
        .filter((c) => {
          if (used.has(c.id) || Math.abs(c.amount) !== abs) return false;
          if (Math.abs(c.occurredAt.getTime() - v.at.getTime()) > 1.5 * DAY) return false;
          if (out) {
            return (
              ((c.type === "expense" || c.type === "transfer") && c.accountId === account.id) ||
              (c.type === "adjustment" && c.accountId === account.id && c.amount < 0)
            );
          }
          return (c.type === "income" && c.accountId === account.id) || (c.type === "transfer" && c.toAccountId === account.id);
        })
        .sort((a, b) => Math.abs(a.occurredAt.getTime() - v.at.getTime()) - Math.abs(b.occurredAt.getTime() - v.at.getTime()))[0];
      if (match) {
        used.add(match.id);
        matchedIds.push(match.id);
        outcome.set(v.index, { result: "matched", transactionId: match.id });
        continue;
      }
      const desc = v.row.description.trim();
      const wallet = out && /top ?up|topup|isi saldo/i.test(desc) ? EWALLET_IN_DESC.find(([, re]) => re.test(desc)) : undefined;
      let values: typeof transactions.$inferInsert;
      if (wallet) {
        const target = await cache.account(wallet[0]);
        values = { type: "transfer", amount: abs, accountId: account.id, toAccountId: target.id, merchant: `Top up ${target.name}`, occurredAt: v.at };
      } else {
        const categoryId = categorize(rules, desc);
        values = {
          type: out ? "expense" : "income",
          amount: abs,
          accountId: account.id,
          categoryId,
          merchant: desc.slice(0, 120),
          status: categoryId == null ? "review" : "ok",
          occurredAt: v.at,
        };
      }
      toInsert.push({
        p: v,
        values: { ...values, description: desc, source: "import", importBatchId: batch.id, fingerprint: v.fingerprint },
      });
    }
  }

  // 4) Tulis sekaligus: transaksi baru, tandai yang cocok, catat sidik jari baris.
  if (toInsert.length) {
    const ins = await db
      .insert(transactions)
      .values(toInsert.map((t) => t.values))
      .returning({ id: transactions.id, fingerprint: transactions.fingerprint });
    const byFp = new Map(ins.map((r) => [r.fingerprint, r.id]));
    for (const t of toInsert) outcome.set(t.p.index, { result: "inserted", transactionId: byFp.get(t.p.fingerprint) ?? null });
  }
  if (matchedIds.length) {
    await db.update(transactions).set({ importBatchId: batch.id }).where(inArray(transactions.id, matchedIds));
  }
  const rowRecords = fresh
    .map((v) => ({ v, o: outcome.get(v.index)! }))
    .filter(({ o }) => o.result !== "skipped")
    .map(({ v, o }) => ({ fingerprint: v.fingerprint, batchId: batch.id, result: o.result, transactionId: o.transactionId }));
  if (rowRecords.length) await db.insert(importRows).values(rowRecords).onConflictDoNothing();

  for (let index = 0; index < input.rows.length; index++) {
    const o = outcome.get(index) ?? { result: "skipped" as const, transactionId: null };
    result[o.result]++;
    result.rows.push({ index, ...o });
  }
  await db
    .update(importBatches)
    .set({ inserted: result.inserted, matched: result.matched })
    .where(eq(importBatches.id, batch.id));
  return result;
}

