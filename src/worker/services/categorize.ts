import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { categoryRules, transactions } from "../db/schema";

export interface Rule {
  pattern: string;
  categoryId: number;
}

/** Huruf kecil, tanda baca jadi spasi, diberi spasi di kedua ujung agar pola "rm " cocok di awal kata. */
export function normalizeText(s: string | null | undefined): string {
  if (!s) return "";
  return ` ${s.toLowerCase().replace(/[^\p{L}\p{N}&!.\-]+/gu, " ").replace(/\s+/g, " ").trim()} `;
}

const NOISE_WORDS = new Set([
  "qris", "pembayaran", "payment", "bayar", "pay", "pt", "tbk", "cv", "ud", "toko", "merchant",
  "di", "ke", "via", "id", "idr", "rp", "trx", "transaksi", "purchase", "pembelian", "berhasil",
  "trf", "transfer", "tf", "dari", "kepada", "to", "from", "debit", "kredit", "db", "cr", "mpm",
]);

/**
 * Kunci merchant yang stabil untuk "belajar" kategori:
 * "QRIS KOPI SENJA 00123 JKT" → "kopi senja jkt"
 */
export function merchantKey(s: string | null | undefined): string {
  if (!s) return "";
  const words = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&\s]+/gu, " ")
    .split(/\s+/)
    // buang kata berangka (kode terminal/cabang, nomor referensi)
    .filter((w) => w && !NOISE_WORDS.has(w) && !/\d/.test(w));
  return words.slice(0, 4).join(" ").trim();
}

export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => b.pattern.length - a.pattern.length);
}

/** Pola terpanjang yang cocok menang (mis. "grabfood" mengalahkan "grab"). */
export function categorize(rules: Rule[], ...texts: (string | null | undefined)[]): number | null {
  const hay = texts.map(normalizeText).join(" ");
  if (!hay.trim()) return null;
  for (const r of rules) {
    const p = r.pattern.toLowerCase();
    if (p.trim() && hay.includes(p)) return r.categoryId;
  }
  return null;
}

export async function loadRules(db: DB): Promise<Rule[]> {
  const rows = await db
    .select({ pattern: categoryRules.pattern, categoryId: categoryRules.categoryId })
    .from(categoryRules);
  return sortRules(rows);
}

export interface LearnResult {
  pattern: string | null;
  applied: number;
  /** kategori aturan sebelumnya untuk pola ini (null = belum ada aturan) */
  previousRuleCategoryId: number | null;
  /** keadaan transaksi lain sebelum ikut diubah, untuk "Batalkan" */
  changed: { id: number; categoryId: number | null; status: string }[];
}

/**
 * Simpan aturan dari koreksi pengguna lalu terapkan ke transaksi lain yang cocok:
 * yang belum berkategori, ATAU yang dulu dikategorikan oleh aturan lama untuk pola
 * yang sama (sehingga salah pilih bisa dikoreksi sekaligus).
 */
export async function learnRule(
  db: DB,
  text: string | null | undefined,
  categoryId: number,
  opts: { exceptId?: number } = {},
): Promise<LearnResult> {
  const pattern = merchantKey(text);
  const none: LearnResult = { pattern: null, applied: 0, previousRuleCategoryId: null, changed: [] };
  if (pattern.length < 3) return none;

  const [old] = await db.select().from(categoryRules).where(eq(categoryRules.pattern, pattern));
  await db
    .insert(categoryRules)
    .values({ pattern, categoryId, origin: "learned" })
    .onConflictDoUpdate({ target: categoryRules.pattern, set: { categoryId, origin: "learned" } });

  const like = `%${pattern.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const oldCat = old && old.categoryId !== categoryId ? old.categoryId : null;
  const targets = await db
    .select({ id: transactions.id, categoryId: transactions.categoryId, status: transactions.status })
    .from(transactions)
    .where(
      and(
        oldCat != null ? or(isNull(transactions.categoryId), eq(transactions.categoryId, oldCat)) : isNull(transactions.categoryId),
        sql`${transactions.type} in ('expense','income')`,
        or(
          sql`lower(coalesce(${transactions.merchant}, '')) like ${like}`,
          sql`lower(coalesce(${transactions.description}, '')) like ${like}`,
        ),
        opts.exceptId ? sql`${transactions.id} <> ${opts.exceptId}` : undefined,
      ),
    );
  if (targets.length) {
    await db
      .update(transactions)
      .set({ categoryId, status: "ok", updatedAt: new Date() })
      .where(inArray(transactions.id, targets.map((t) => t.id)));
  }
  return { pattern, applied: targets.length, previousRuleCategoryId: old?.categoryId ?? null, changed: targets };
}
