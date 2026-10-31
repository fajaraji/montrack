import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, type Account } from "../db/schema";
import { PROVIDERS } from "../../shared/types";

/** Cari akun untuk provider (prioritaskan 4 digit terakhir yang cocok); buat otomatis bila belum ada. */
export async function findOrCreateAccount(db: DB, provider: string, last4?: string | null): Promise<Account> {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, provider), eq(accounts.archived, false)))
    .orderBy(accounts.id);
  if (rows.length) {
    if (last4) {
      const hit = rows.find((a) => a.last4 && a.last4 === last4);
      if (hit) return hit;
    }
    return rows[0];
  }
  const def = PROVIDERS.find((p) => p.id === provider);
  const [created] = await db
    .insert(accounts)
    .values({
      name: def?.label ?? provider.toUpperCase(),
      provider,
      kind: def?.kind ?? "other",
      last4: last4 ?? null,
    })
    .returning();
  return created;
}
