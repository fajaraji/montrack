import { sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, transactions } from "../db/schema";
import type { AccountDTO, AccountKind } from "../../shared/types";

/**
 * Saldo = saldo awal + pemasukan − pengeluaran − transfer keluar + transfer masuk + penyesuaian.
 * Transfer & penyesuaian TIDAK memengaruhi angka pengeluaran/pemasukan bulanan.
 */
export async function accountBalances(db: DB): Promise<Map<number, number>> {
  const from = await db
    .select({
      id: transactions.accountId,
      delta: sql<string>`coalesce(sum(case
        when ${transactions.type} = 'income' then ${transactions.amount}
        when ${transactions.type} = 'expense' then -${transactions.amount}
        when ${transactions.type} = 'transfer' then -${transactions.amount}
        when ${transactions.type} = 'adjustment' then ${transactions.amount}
        else 0 end), 0)`,
    })
    .from(transactions)
    .where(sql`${transactions.accountId} is not null`)
    .groupBy(transactions.accountId);
  const to = await db
    .select({
      id: transactions.toAccountId,
      delta: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(sql`${transactions.toAccountId} is not null and ${transactions.type} = 'transfer'`)
    .groupBy(transactions.toAccountId);
  const map = new Map<number, number>();
  for (const r of [...from, ...to]) {
    if (r.id == null) continue;
    map.set(r.id, (map.get(r.id) ?? 0) + Number(r.delta));
  }
  return map;
}

export async function listAccountsWithBalance(db: DB): Promise<AccountDTO[]> {
  const rows = await db.select().from(accounts).orderBy(accounts.archived, accounts.id);
  const deltas = await accountBalances(db);
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    provider: a.provider,
    kind: a.kind as AccountKind,
    last4: a.last4,
    openingBalance: a.openingBalance,
    archived: a.archived,
    balance: a.openingBalance + (deltas.get(a.id) ?? 0),
  }));
}
