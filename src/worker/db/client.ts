import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Tipe database generik: dipakai Neon (produksi) dan PGlite (test). */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(databaseUrl: string): DB {
  return drizzle(neon(databaseUrl), { schema }) as unknown as DB;
}

export { schema };
