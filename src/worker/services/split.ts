import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { transactions, type Transaction } from "../db/schema";

export interface SplitPart {
  amount: number;
  categoryId: number | null;
  description?: string | null;
}

/**
 * Bagi satu transaksi menjadi beberapa (total tetap sama, sehingga saldo tidak berubah).
 * Transaksi asli menjadi bagian pertama; bagian lain menyalin akun, waktu, dan merchant.
 */
export async function splitTransaction(db: DB, id: number, parts: SplitPart[]): Promise<Transaction[]> {
  const [t] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!t) throw new Error("Transaksi tidak ditemukan");
  if (t.type !== "expense" && t.type !== "income") throw new Error("Hanya pengeluaran/pemasukan yang bisa dibagi");
  if (t.splitGroupId != null && t.splitGroupId !== t.id) throw new Error("Bagi dari transaksi aslinya");
  if (parts.length < 2) throw new Error("Minimal 2 bagian");
  if (parts.some((p) => !Number.isInteger(p.amount) || p.amount <= 0)) throw new Error("Nominal tiap bagian harus lebih dari 0");
  const existingGroup = t.splitGroupId === t.id ? await db.select().from(transactions).where(eq(transactions.splitGroupId, t.id)) : [t];
  const total = existingGroup.reduce((s, x) => s + x.amount, 0);
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  if (sum !== total) throw new Error(`Jumlah bagian (${sum}) harus sama dengan total (${total})`);

  // Hapus bagian lama (selain asli), lalu tulis ulang.
  for (const x of existingGroup) if (x.id !== t.id) await db.delete(transactions).where(eq(transactions.id, x.id));
  const [first, ...rest] = parts;
  const [updated] = await db
    .update(transactions)
    .set({ amount: first.amount, categoryId: first.categoryId, description: first.description ?? t.description, splitGroupId: t.id, status: "ok", updatedAt: new Date() })
    .where(eq(transactions.id, t.id))
    .returning();
  const inserted = await db
    .insert(transactions)
    .values(
      rest.map((p) => ({
        type: t.type,
        amount: p.amount,
        accountId: t.accountId,
        categoryId: p.categoryId,
        merchant: t.merchant,
        rawMerchant: t.rawMerchant,
        description: p.description ?? t.description,
        occurredAt: t.occurredAt,
        source: t.source,
        status: "ok",
        excluded: t.excluded,
        splitGroupId: t.id,
      })),
    )
    .returning();
  return [updated, ...inserted];
}

/** Gabungkan kembali transaksi yang dibagi menjadi satu. */
export async function unsplitTransaction(db: DB, groupId: number): Promise<Transaction> {
  const group = await db.select().from(transactions).where(eq(transactions.splitGroupId, groupId));
  const original = group.find((x) => x.id === groupId);
  if (!original) throw new Error("Transaksi asal tidak ditemukan");
  const total = group.reduce((s, x) => s + x.amount, 0);
  for (const x of group) if (x.id !== groupId) await db.delete(transactions).where(eq(transactions.id, x.id));
  const [t] = await db
    .update(transactions)
    .set({ amount: total, splitGroupId: null, updatedAt: new Date() })
    .where(eq(transactions.id, groupId))
    .returning();
  return t;
}
