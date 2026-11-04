import type { DB } from "../db/client";
import { goals } from "../db/schema";
import { listAccountsWithBalance } from "./balances";
import { wibParts } from "../../shared/time";
import type { GoalDTO } from "../../shared/types";

export async function listGoals(db: DB, now = new Date()): Promise<GoalDTO[]> {
  const rows = await db.select().from(goals).orderBy(goals.archived, goals.id);
  const needBalances = rows.some((g) => g.accountId != null);
  const balances = needBalances ? new Map((await listAccountsWithBalance(db)).map((a) => [a.id, a])) : new Map();
  const n = wibParts(now);
  return rows.map((g) => {
    const acc = g.accountId != null ? balances.get(g.accountId) : undefined;
    const progress = acc ? Math.max(0, acc.balance) : g.saved;
    let monthsLeft: number | null = null;
    let perMonth: number | null = null;
    if (g.deadline) {
      const [y, m] = g.deadline.split("-").map(Number);
      monthsLeft = Math.max(1, (y - n.year) * 12 + (m - n.month) + 1);
      perMonth = Math.max(0, Math.ceil((g.target - progress) / monthsLeft));
    }
    return {
      id: g.id,
      name: g.name,
      icon: g.icon,
      target: g.target,
      saved: g.saved,
      accountId: g.accountId,
      accountName: acc?.name ?? null,
      deadline: g.deadline,
      archived: g.archived,
      progress,
      pct: g.target > 0 ? Math.min(100, Math.round((progress / g.target) * 100)) : 0,
      monthsLeft,
      perMonth,
    };
  });
}
