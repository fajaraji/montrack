import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { settings } from "../db/schema";
import type { SettingsDTO } from "../../shared/types";

const DEFAULTS: SettingsDTO = { monthlyBudget: null, ownerNames: [] };

export async function getSettings(db: DB): Promise<SettingsDTO> {
  const rows = await db.select().from(settings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    monthlyBudget: typeof map.monthlyBudget === "number" ? map.monthlyBudget : DEFAULTS.monthlyBudget,
    ownerNames: Array.isArray(map.ownerNames) ? (map.ownerNames as string[]) : DEFAULTS.ownerNames,
  };
}

export async function updateSettings(db: DB, patch: Partial<SettingsDTO>): Promise<SettingsDTO> {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    const existing = await db.select().from(settings).where(eq(settings.key, key));
    if (existing.length) await db.update(settings).set({ value }).where(eq(settings.key, key));
    else await db.insert(settings).values({ key, value });
  }
  return getSettings(db);
}
