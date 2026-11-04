import { and, eq, gte, sql, isNotNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, categories, inboxEmails, transactions } from "../db/schema";
import { getSettings } from "./settings";

export interface ChecklistDTO {
  dismissed: boolean;
  items: { id: string; label: string; done: boolean; href: string; hint: string }[];
}

export async function getChecklist(db: DB): Promise<ChecklistDTO> {
  const s = await getSettings(db);
  const accs = await db.select({ id: accounts.id, opening: accounts.openingBalance }).from(accounts).where(eq(accounts.archived, false));
  const adjusted = await db
    .selectDistinct({ id: transactions.accountId })
    .from(transactions)
    .where(and(eq(transactions.type, "adjustment"), isNotNull(transactions.accountId)));
  const adjustedIds = new Set(adjusted.map((a) => a.id));
  const balancesSet = accs.length > 0 && accs.every((a) => a.opening !== 0 || adjustedIds.has(a.id));
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inboxEmails)
    .where(gte(inboxEmails.createdAt, new Date(Date.now() - 7 * 86400_000)));
  const [budgeted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(categories)
    .where(isNotNull(categories.monthlyBudget));
  return {
    dismissed: s.checklistDismissed,
    items: [
      { id: "email", label: "Email bank/e-wallet masuk otomatis", done: Number(recent?.n ?? 0) > 0, href: "/pengaturan", hint: "Pasang Google Apps Script (7 hari terakhir belum ada email masuk)." },
      { id: "owner", label: "Isi nama pemilik rekening", done: s.ownerNames.length > 0, href: "/pengaturan", hint: "Agar transfer ke rekening sendiri tidak dihitung pengeluaran." },
      { id: "balance", label: "Sesuaikan saldo setiap akun", done: balancesSet, href: "/akun", hint: "Akun yang dibuat otomatis belum tahu saldo awalnya." },
      { id: "budget", label: "Pasang anggaran", done: s.monthlyBudget != null || Number(budgeted?.n ?? 0) > 0, href: "/anggaran", hint: "Total per bulan atau per kategori." },
    ],
  };
}
