import { and, gte, lt, sql, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { inboxEmails, transactions } from "../db/schema";
import { getSettings } from "./settings";
import { addMonths, daysInMonth, formatYm, monthRange, wibParts, type Ym } from "../../shared/time";
import type { MonthSummaryDTO } from "../../shared/types";

function group(rows: { categoryId: number | null; amount: number }[]) {
  const m = new Map<number | null, { total: number; count: number }>();
  for (const r of rows) {
    const g = m.get(r.categoryId) ?? { total: 0, count: 0 };
    g.total += r.amount;
    g.count += 1;
    m.set(r.categoryId, g);
  }
  return [...m.entries()]
    .map(([categoryId, g]) => ({ categoryId, ...g }))
    .sort((a, b) => b.total - a.total);
}

export async function monthSummary(db: DB, ym: Ym, now = new Date()): Promise<MonthSummaryDTO> {
  const { start, end } = monthRange(ym);
  const rows = await db
    .select({
      type: transactions.type,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(and(gte(transactions.occurredAt, start), lt(transactions.occurredAt, end)));

  const dim = daysInMonth(ym);
  const nowP = wibParts(now);
  const isCurrentMonth = nowP.year === ym.year && nowP.month === ym.month;
  const isFuture = ym.year * 12 + ym.month > nowP.year * 12 + nowP.month;
  const dayOfMonth = isCurrentMonth ? nowP.day : isFuture ? 0 : dim;

  const daily = new Array<number>(dim).fill(0);
  const expenses: { categoryId: number | null; amount: number }[] = [];
  const incomes: { categoryId: number | null; amount: number }[] = [];
  let transferTotal = 0;
  for (const r of rows) {
    if (r.type === "expense") {
      expenses.push(r);
      daily[wibParts(r.occurredAt).day - 1] += r.amount;
    } else if (r.type === "income") incomes.push(r);
    else if (r.type === "transfer") transferTotal += r.amount;
  }
  const expense = expenses.reduce((s, r) => s + r.amount, 0);
  const income = incomes.reduce((s, r) => s + r.amount, 0);

  // Bulan lalu: total & sampai tanggal yang sama (untuk perbandingan yang adil).
  const prev = addMonths(ym, -1);
  const prevRange = monthRange(prev);
  const prevRows = await db
    .select({ amount: transactions.amount, occurredAt: transactions.occurredAt })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredAt, prevRange.start),
        lt(transactions.occurredAt, prevRange.end),
      ),
    );
  const prevDim = daysInMonth(prev);
  const cutoffDay = Math.min(dayOfMonth, prevDim);
  let prevExpenseTotal = 0;
  let prevExpenseSamePeriod = 0;
  for (const r of prevRows) {
    prevExpenseTotal += r.amount;
    if (wibParts(r.occurredAt).day <= cutoffDay) prevExpenseSamePeriod += r.amount;
  }

  const settings = await getSettings(db);
  const budget = settings.monthlyBudget && settings.monthlyBudget > 0 ? settings.monthlyBudget : null;
  const budgetRemaining = budget != null ? budget - expense : null;
  let safePerDay: number | null = null;
  if (budgetRemaining != null && (isCurrentMonth || isFuture)) {
    const daysLeft = isCurrentMonth ? dim - nowP.day + 1 : dim;
    safePerDay = Math.max(0, Math.floor(budgetRemaining / daysLeft));
  }

  const [review] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.status, "review"));
  const [unparsed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inboxEmails)
    .where(eq(inboxEmails.status, "unparsed"));

  return {
    month: formatYm(ym),
    expense,
    income,
    net: income - expense,
    prevExpenseSamePeriod,
    prevExpenseTotal,
    dayOfMonth,
    daysInMonth: dim,
    isCurrentMonth,
    byCategory: group(expenses),
    incomeByCategory: group(incomes),
    daily,
    transferTotal,
    budget,
    budgetRemaining,
    safePerDay,
    reviewCount: Number(review?.n ?? 0),
    unparsedEmailCount: Number(unparsed?.n ?? 0),
  };
}
