import { and, gte, isNotNull, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { categories, transactions } from "../db/schema";
import { merchantKey } from "./categorize";

interface TxLike {
  id: number;
  type: string;
  merchant: string | null;
  rawMerchant: string | null;
  description: string | null;
}

/**
 * Saran 3 kategori untuk tiap transaksi: kategori yang paling sering dipakai merchant
 * dengan kata serupa (dari riwayat 6 bulan), lalu dilengkapi kategori yang paling sering dipakai.
 * Hanya 2 query untuk seluruh daftar.
 */
export async function suggestCategories(db: DB, txs: TxLike[], max = 3): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!txs.length) return out;
  const since = new Date(Date.now() - 180 * 86400_000);
  const history = await db
    .select({
      type: transactions.type,
      merchant: transactions.merchant,
      rawMerchant: transactions.rawMerchant,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(and(isNotNull(transactions.categoryId), gte(transactions.occurredAt, since), eq(transactions.status, "ok")))
    .limit(5000);
  const cats = await db
    .select({ id: categories.id, kind: categories.kind, archived: categories.archived, sort: categories.sort })
    .from(categories);
  const active = new Map(cats.filter((c) => !c.archived).map((c) => [c.id, c]));

  const wordCats = new Map<string, Map<number, number>>();
  const usage = new Map<number, number>();
  for (const h of history) {
    if (!h.categoryId || !active.has(h.categoryId)) continue;
    usage.set(h.categoryId, (usage.get(h.categoryId) ?? 0) + 1);
    for (const w of new Set(merchantKey(h.rawMerchant ?? h.merchant).split(" "))) {
      if (w.length < 3) continue;
      const m = wordCats.get(w) ?? new Map<number, number>();
      m.set(h.categoryId, (m.get(h.categoryId) ?? 0) + 1);
      wordCats.set(w, m);
    }
  }

  for (const t of txs) {
    const kind = t.type === "income" ? "income" : "expense";
    const score = new Map<number, number>();
    for (const w of new Set(merchantKey(t.rawMerchant ?? t.merchant ?? t.description).split(" "))) {
      for (const [cid, n] of wordCats.get(w) ?? []) {
        if (active.get(cid)?.kind === kind) score.set(cid, (score.get(cid) ?? 0) + n * 10);
      }
    }
    for (const [cid, n] of usage) if (active.get(cid)?.kind === kind) score.set(cid, (score.get(cid) ?? 0) + n);
    let ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (ranked.length < max) {
      const fill = [...active.values()]
        .filter((c) => c.kind === kind && !ranked.includes(c.id))
        .sort((a, b) => a.sort - b.sort)
        .map((c) => c.id);
      ranked = [...ranked, ...fill];
    }
    out.set(t.id, ranked.slice(0, max));
  }
  return out;
}
