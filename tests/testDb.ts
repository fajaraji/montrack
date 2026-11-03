import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/worker/db/schema";
import { seedDefaults } from "../src/worker/db/seed";
import type { DB } from "../src/worker/db/client";

/** Penghitung query, untuk memastikan tetap di bawah batas 50 subrequest Cloudflare. */
export const queryCounter = { count: 0 };

export async function createTestDb(): Promise<DB> {
  const client = new PGlite();
  const db = drizzle(client, {
    schema,
    logger: { logQuery: () => void queryCounter.count++ },
  }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedDefaults(db);
  return db;
}
