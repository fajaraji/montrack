import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { merchantRenames, transactions } from "../db/schema";
import { merchantKey, normalizeText } from "./categorize";

export interface Rename {
  id: number;
  pattern: string;
  name: string;
}

export async function loadRenames(db: DB): Promise<Rename[]> {
  const rows = await db.select({ id: merchantRenames.id, pattern: merchantRenames.pattern, name: merchantRenames.name }).from(merchantRenames);
  return rows.sort((a, b) => b.pattern.length - a.pattern.length);
}

/** Nama tampilan untuk merchant mentah, atau null bila tidak ada aturan yang cocok. */
export function applyRename(renames: Rename[], raw: string | null | undefined): string | null {
  const hay = normalizeText(raw);
  if (!hay.trim()) return null;
  return renames.find((r) => hay.includes(r.pattern))?.name ?? null;
}

function likeOf(pattern: string) {
  return `%${pattern.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}

/**
 * Simpan aturan ganti nama dari nama merchant mentah, lalu terapkan ke transaksi lama.
 * Nama asli disimpan di raw_merchant sehingga pencocokan berikutnya tetap memakai nama asli.
 */
export async function upsertRename(
  db: DB,
  rawMerchant: string,
  name: string,
  patternOverride?: string,
): Promise<{ pattern: string; applied: number }> {
  const pattern = (patternOverride?.trim().toLowerCase() || merchantKey(rawMerchant)).slice(0, 60);
  if (pattern.length < 3) throw new Error("Nama merchant terlalu pendek untuk dijadikan aturan");
  await db
    .insert(merchantRenames)
    .values({ pattern, name })
    .onConflictDoUpdate({ target: merchantRenames.pattern, set: { name } });
  const updated = await db
    .update(transactions)
    .set({
      rawMerchant: sql`coalesce(${transactions.rawMerchant}, ${transactions.merchant})`,
      merchant: name,
      updatedAt: new Date(),
    })
    .where(sql`lower(coalesce(${transactions.rawMerchant}, ${transactions.merchant}, '')) like ${likeOf(pattern)}`)
    .returning({ id: transactions.id });
  return { pattern, applied: updated.length };
}

/** Hapus aturan dan kembalikan nama asli pada transaksi yang terkena. */
export async function deleteRename(db: DB, id: number): Promise<void> {
  const [r] = await db.select().from(merchantRenames).where(eq(merchantRenames.id, id));
  if (!r) return;
  await db
    .update(transactions)
    .set({ merchant: sql`${transactions.rawMerchant}`, rawMerchant: null, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.merchant, r.name),
        sql`lower(coalesce(${transactions.rawMerchant}, '')) like ${likeOf(r.pattern)}`,
      ),
    );
  await db.delete(merchantRenames).where(eq(merchantRenames.id, id));
}
