import { and, eq, gte, lte, or, sql, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, importBatches, importRows, transactions } from "../db/schema";
import type { ImportResultDTO, ImportRow } from "../../shared/types";
import { fromWib } from "../../shared/time";
import { categorize, loadRules } from "./categorize";
import { findOrCreateAccount } from "./accounts";

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
 */
export async function importStatement(
  db: DB,
  input: { accountId: number; filename?: string; rows: ImportRow[] },
): Promise<ImportResultDTO> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!account) throw new Error("Akun tidak ditemukan");
  const rules = await loadRules(db);

  const [batch] = await db
    .insert(importBatches)
    .values({ accountId: account.id, filename: input.filename ?? null, rowCount: input.rows.length })
    .returning();

  const seen = new Map<string, number>();
  const usedTx = new Set<number>();
  const result: ImportResultDTO = { batchId: batch.id, inserted: 0, matched: 0, skipped: 0, rows: [] };

  for (const [index, r] of input.rows.entries()) {
    if (!r.amount || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      result.skipped++;
      result.rows.push({ index, result: "skipped", transactionId: null });
      continue;
    }
    const baseKey = `import:${account.id}:${r.date}:${r.amount}:${r.description.trim().toLowerCase()}`;
    const occurrence = (seen.get(baseKey) ?? 0) + 1;
    seen.set(baseKey, occurrence);
    const fingerprint = `${baseKey}:${occurrence}`;

    const [already] = await db.select().from(importRows).where(eq(importRows.fingerprint, fingerprint));
    if (already) {
      result.skipped++;
      result.rows.push({ index, result: "skipped", transactionId: already.transactionId });
      continue;
    }

    const at = rowDate(r);
    const abs = Math.abs(r.amount);
    const out = r.amount < 0;
    const sideCond = out
      ? or(
          and(sql`${transactions.type} in ('expense','transfer')`, eq(transactions.accountId, account.id)),
          and(eq(transactions.type, "adjustment"), eq(transactions.accountId, account.id), sql`${transactions.amount} < 0`),
        )
      : or(
          and(eq(transactions.type, "income"), eq(transactions.accountId, account.id)),
          and(eq(transactions.type, "transfer"), eq(transactions.toAccountId, account.id)),
        );
    const candidates = await db
      .select()
      .from(transactions)
      .where(
        and(
          sql`abs(${transactions.amount}) = ${abs}`,
          gte(transactions.occurredAt, new Date(at.getTime() - 1.5 * DAY)),
          lte(transactions.occurredAt, new Date(at.getTime() + 1.5 * DAY)),
          isNull(transactions.importBatchId),
          sideCond,
        ),
      );
    const match = candidates
      .filter((c) => !usedTx.has(c.id))
      .sort((a, b) => Math.abs(a.occurredAt.getTime() - at.getTime()) - Math.abs(b.occurredAt.getTime() - at.getTime()))[0];

    let txId: number;
    let kind: "inserted" | "matched";
    if (match) {
      await db.update(transactions).set({ importBatchId: batch.id }).where(eq(transactions.id, match.id));
      txId = match.id;
      kind = "matched";
    } else {
      const desc = r.description.trim();
      const wallet = out && /top ?up|topup|isi saldo/i.test(desc) ? EWALLET_IN_DESC.find(([, re]) => re.test(desc)) : undefined;
      let values: Omit<typeof transactions.$inferInsert, "occurredAt">;
      if (wallet) {
        const target = await findOrCreateAccount(db, wallet[0]);
        values = { type: "transfer", amount: abs, accountId: account.id, toAccountId: target.id, merchant: `Top up ${target.name}` };
      } else {
        const categoryId = categorize(rules, desc);
        values = {
          type: out ? "expense" : "income",
          amount: abs,
          accountId: account.id,
          categoryId,
          merchant: desc.slice(0, 120),
          status: categoryId == null ? "review" : "ok",
        };
      }
      const [ins] = await db
        .insert(transactions)
        .values({ ...values, description: desc, occurredAt: at, source: "import", importBatchId: batch.id })
        .returning();
      txId = ins.id;
      kind = "inserted";
    }
    usedTx.add(txId);
    await db.insert(importRows).values({ fingerprint, batchId: batch.id, result: kind, transactionId: txId });
    result[kind]++;
    result.rows.push({ index, result: kind, transactionId: txId });
  }

  await db
    .update(importBatches)
    .set({ inserted: result.inserted, matched: result.matched })
    .where(eq(importBatches.id, batch.id));
  return result;
}
