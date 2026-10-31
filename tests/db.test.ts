import { describe, it, expect } from "vitest";
import { createTestDb } from "./testDb";
import { categories, categoryRules } from "../src/worker/db/schema";
import { seedDefaults } from "../src/worker/db/seed";

describe("database", () => {
  it("migrasi & seed berjalan, dan seed idempoten", async () => {
    const db = await createTestDb();
    const cats = await db.select().from(categories);
    expect(cats.length).toBeGreaterThan(20);
    await seedDefaults(db);
    expect((await db.select().from(categories)).length).toBe(cats.length);
    expect((await db.select().from(categoryRules)).length).toBeGreaterThan(100);
  });
});
