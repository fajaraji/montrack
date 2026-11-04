import { and, eq, gte, lt } from "drizzle-orm";
import type { DB } from "../db/client";
import { transactions } from "../db/schema";
import { addMonths, formatYm, fromWib, monthRange, wibDateKey, wibParts, type Ym } from "../../shared/time";
import type { ReportsDTO, WeeklyRecapDTO } from "../../shared/types";

type Row = { type: string; amount: number; categoryId: number | null; merchant: string | null; occurredAt: Date };

async function loadRange(db: DB, start: Date, end: Date): Promise<Row[]> {
  return db
    .select({
      type: transactions.type,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      merchant: transactions.merchant,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(and(gte(transactions.occurredAt, start), lt(transactions.occurredAt, end), eq(transactions.excluded, false)));
}

/** Tren beberapa bulan terakhir (sampai bulan `ym`), merchant terbesar, rata-rata per kategori. */
export async function buildReports(db: DB, ym: Ym, months = 6): Promise<ReportsDTO> {
  const first = addMonths(ym, -(months - 1));
  const rows = await loadRange(db, monthRange(first).start, monthRange(ym).end);
  const keys = Array.from({ length: months }, (_, i) => formatYm(addMonths(first, i)));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const trend = keys.map((month) => ({ month, expense: 0, income: 0 }));
  const byCat = new Map<number | null, number[]>();
  const merchants = new Map<string, { name: string; total: number; count: number; categoryId: number | null }>();
  const current = formatYm(ym);

  for (const r of rows) {
    const p = wibParts(r.occurredAt);
    const k = formatYm({ year: p.year, month: p.month });
    const i = idx.get(k);
    if (i == null) continue;
    if (r.type === "expense") {
      trend[i].expense += r.amount;
      const arr = byCat.get(r.categoryId) ?? new Array<number>(months).fill(0);
      arr[i] += r.amount;
      byCat.set(r.categoryId, arr);
      if (k === current) {
        const name = (r.merchant ?? "Tanpa nama").trim();
        const key = name.toLowerCase();
        const m = merchants.get(key) ?? { name, total: 0, count: 0, categoryId: r.categoryId };
        m.total += r.amount;
        m.count += 1;
        merchants.set(key, m);
      }
    } else if (r.type === "income") trend[i].income += r.amount;
  }

  // Rata-rata memakai bulan-bulan penuh sebelum bulan terpilih.
  const fullMonths = Math.max(1, months - 1);
  const categories = [...byCat.entries()]
    .map(([categoryId, perMonth]) => ({
      categoryId,
      perMonth,
      current: perMonth[months - 1],
      average: Math.round(perMonth.slice(0, months - 1).reduce((a, b) => a + b, 0) / fullMonths),
    }))
    .sort((a, b) => b.current - a.current || b.average - a.average);

  return {
    month: current,
    trend,
    categories,
    topMerchants: [...merchants.values()].sort((a, b) => b.total - a.total).slice(0, 10),
  };
}

/** Senin 00:00 WIB dari minggu yang memuat tanggal `d`. */
export function weekStartWib(d: Date): Date {
  const p = wibParts(d);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Minggu
  const back = (dow + 6) % 7;
  return fromWib(p.year, p.month, p.day - back);
}

/** Rekap satu minggu (Senin–Minggu) dibanding minggu sebelumnya. */
export async function weeklyRecap(db: DB, weekStart: Date): Promise<WeeklyRecapDTO> {
  const prevStart = new Date(weekStart.getTime() - 7 * 86400_000);
  const end = new Date(weekStart.getTime() + 7 * 86400_000);
  const rows = await loadRange(db, prevStart, end);
  let total = 0;
  let prevTotal = 0;
  let count = 0;
  let biggest: { merchant: string | null; amount: number; date: string } | null = null;
  const cats = new Map<number | null, number>();
  for (const r of rows) {
    if (r.type !== "expense") continue;
    if (r.occurredAt < weekStart) {
      prevTotal += r.amount;
      continue;
    }
    total += r.amount;
    count++;
    cats.set(r.categoryId, (cats.get(r.categoryId) ?? 0) + r.amount);
    if (!biggest || r.amount > biggest.amount) biggest = { merchant: r.merchant, amount: r.amount, date: wibDateKey(r.occurredAt) };
  }
  return {
    weekStart: wibDateKey(weekStart),
    weekEnd: wibDateKey(new Date(end.getTime() - 1)),
    total,
    prevTotal,
    count,
    topCategories: [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([categoryId, amount]) => ({ categoryId, amount })),
    biggest,
  };
}
