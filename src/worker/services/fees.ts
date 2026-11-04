import { eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { recurringFees, transactions, type RecurringFee } from "../db/schema";
import { addMonths, daysInMonth, formatYm, fromWib, parseYm, wibParts, type Ym } from "../../shared/time";

/** Tanggal jatuh tempo biaya di bulan tertentu (tanggal 31 → akhir bulan untuk bulan pendek). */
export function dueDate(fee: Pick<RecurringFee, "dayOfMonth">, ym: Ym): Date {
  return fromWib(ym.year, ym.month, Math.min(fee.dayOfMonth, daysInMonth(ym)), 8, 0);
}

const fingerprint = (feeId: number, ym: Ym) => `fee:${feeId}:${formatYm(ym)}`;

/**
 * Catat biaya rutin yang sudah jatuh tempo bulan ini (dan bulan lalu bila sempat terlewat).
 * Idempoten: setiap biaya hanya dicatat sekali per bulan (fingerprint unik).
 * Nominal yang dipakai = nominal saat dicatat, jadi mengubah nominal hanya berlaku ke depan.
 */
export async function runRecurringFees(db: DB, now = new Date()): Promise<number> {
  const fees = await db.select().from(recurringFees).where(eq(recurringFees.active, true));
  if (!fees.length) return 0;
  const p = wibParts(now);
  const cur: Ym = { year: p.year, month: p.month };
  const months = [addMonths(cur, -1), cur];
  const wanted = fees.flatMap((f) =>
    months
      .filter((ym) => formatYm(ym) >= f.startMonth && dueDate(f, ym).getTime() <= now.getTime())
      .map((ym) => ({ f, ym, fp: fingerprint(f.id, ym) })),
  );
  if (!wanted.length) return 0;
  const existing = await db
    .select({ fp: transactions.fingerprint })
    .from(transactions)
    .where(inArray(transactions.fingerprint, wanted.map((w) => w.fp)));
  const have = new Set(existing.map((e) => e.fp));
  const todo = wanted.filter((w) => !have.has(w.fp));
  if (!todo.length) return 0;
  const rows = await db
    .insert(transactions)
    .values(
      todo.map(({ f, ym, fp }) => ({
        type: "expense",
        amount: f.amount,
        accountId: f.accountId,
        categoryId: f.categoryId,
        merchant: f.name,
        description: "Biaya rutin otomatis",
        occurredAt: dueDate(f, ym),
        source: "recurring",
        status: "ok",
        fingerprint: fp,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: transactions.id });
  return rows.length;
}

export interface FeeInput {
  name: string;
  amount: number;
  accountId: number;
  categoryId: number | null;
  dayOfMonth: number;
  /** true = mulai bulan depan; false = mulai bulan ini (dicatat bila tanggalnya sudah lewat) */
  startNextMonth?: boolean;
}

export function startMonthFor(startNextMonth: boolean | undefined, now = new Date()): string {
  const cur = parseYm(null, now);
  return formatYm(startNextMonth ? addMonths(cur, 1) : cur);
}

export async function listFees(db: DB) {
  return db.select().from(recurringFees).orderBy(recurringFees.dayOfMonth, recurringFees.id);
}
