import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { settings } from "../db/schema";
import type { SettingsDTO } from "../../shared/types";

const DEFAULTS: SettingsDTO = { monthlyBudget: null, ownerNames: [], hasPin: false, checklistDismissed: false };
/** Kunci yang boleh diubah lewat PATCH /settings (pinHash diatur lewat endpoint khusus). */
const EDITABLE = new Set(["monthlyBudget", "ownerNames", "checklistDismissed"]);

export async function getSettings(db: DB): Promise<SettingsDTO> {
  const rows = await db.select().from(settings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    monthlyBudget: typeof map.monthlyBudget === "number" ? map.monthlyBudget : DEFAULTS.monthlyBudget,
    ownerNames: Array.isArray(map.ownerNames) ? (map.ownerNames as string[]) : DEFAULTS.ownerNames,
    hasPin: typeof map.pinHash === "string" && map.pinHash.length > 0,
    checklistDismissed: map.checklistDismissed === true,
  };
}

export async function getRawSetting(db: DB, key: string): Promise<unknown> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value;
}

export async function setRawSetting(db: DB, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function deleteSetting(db: DB, key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

export async function updateSettings(db: DB, patch: Partial<SettingsDTO>): Promise<SettingsDTO> {
  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE.has(key)) continue;
    await setRawSetting(db, key, value);
  }
  return getSettings(db);
}
