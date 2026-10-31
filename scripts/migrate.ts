/**
 * Jalankan migrasi + isi kategori default ke database Neon.
 *   DATABASE_URL=postgresql://... npm run db:migrate
 * (atau isi DATABASE_URL di .dev.vars)
 */
import { readFileSync, existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import * as schema from "../src/worker/db/schema";
import { seedDefaults } from "../src/worker/db/seed";
import type { DB } from "../src/worker/db/client";

function loadDevVars() {
  if (process.env.DATABASE_URL || !existsSync(".dev.vars")) return;
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadDevVars();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL belum diisi (env atau .dev.vars).");
  process.exit(1);
}
const db = drizzle(neon(url), { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
await seedDefaults(db as unknown as DB);
console.log("✓ Migrasi & seed selesai.");
