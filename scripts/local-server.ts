/**
 * Jalankan Montrack sepenuhnya di laptop tanpa Neon/Cloudflare:
 *   npm run local          (data disimpan di folder .local-db)
 *   npm run local:demo     (isi contoh transaksi bulan ini)
 * Password default: montrack (ubah lewat LOCAL_APP_PASSWORD).
 * Sengaja TIDAK membaca APP_PASSWORD/SESSION_SECRET/INGEST_SECRET dari environment,
 * agar secret produksi tidak terpakai atau tercetak saat mencoba di laptop.
 */
import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "../src/worker/db/schema";
import { seedDefaults } from "../src/worker/db/seed";
import { createApp, type Bindings } from "../src/worker/app";
import { ingestEmail } from "../src/worker/services/ingest";
import type { DB } from "../src/worker/db/client";
import { EMAILS } from "../tests/fixtures";
import { fromWib, wibParts } from "../src/shared/time";

const dataDir = process.env.LOCAL_DB_DIR ?? ".local-db";
const client = new PGlite(dataDir === "memory" ? undefined : dataDir);
const db = drizzle(client, { schema }) as unknown as DB;
await migrate(db as never, { migrationsFolder: "./drizzle" });
await seedDefaults(db);

const env: Bindings = {
  DATABASE_URL: "pglite",
  APP_PASSWORD: process.env.LOCAL_APP_PASSWORD ?? "montrack",
  SESSION_SECRET: "local-session-secret-not-for-production",
  INGEST_SECRET: "local-ingest-secret",
};

if (process.argv.includes("--demo")) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.transactions);
  if (!n) {
    // Sebar contoh ke 10 hari terakhir (hari ke-10 = hari ini).
    const at = (day: number, h: number, m = 0) => {
      const p = wibParts(new Date(Date.now() - (10 - day) * 86400_000));
      return fromWib(p.year, p.month, p.day, h, m);
    };
    const fixDate = (body: string, d: Date) => {
      const p = wibParts(d);
      const s = `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
      return body
        .replace(/(Tanggal\s*:?\s*)[^\n<]+/i, `$1${s}`)
        .replace(/(Tanggal Transaksi\s*:?\s*)[^\n<]+/i, `$1${s}`)
        .replace(/(Waktu\s*:?\s*\n?)[^\n<]+/i, `$1${s}`)
        .replace(/(Date:\s*)[^\n<]+/i, `$1${s}`)
        .replace(/(<td>Tanggal<\/td><td>)[^<]+/i, `$1${s}`);
    };
    const plan: [keyof typeof EMAILS, number, number][] = [
      ["bniTransferIn", 1, 9], ["briTopupGopay", 2, 8], ["gopayTopupIn", 2, 8], ["gopayQris", 3, 7],
      ["briQris", 3, 12], ["bsiPayment", 5, 20], ["danaPayment", 6, 19], ["ovoPayment", 8, 10],
      ["bniTransferOut", 9, 19], ["shopeepayRefund", 10, 13], ["otp", 10, 14],
    ];
    let i = 0;
    for (const [key, day, hour] of plan) {
      const e = EMAILS[key];
      const d = at(day, hour, 15);
      await ingestEmail(db, { messageId: `demo-${i++}`, from: e.from, subject: e.subject, body: fixDate(e.body, d), date: d });
    }
    await ingestEmail(db, {
      messageId: "demo-unknown",
      from: "Notifikasi <info@bankbaru.example>",
      subject: "Info transaksi",
      body: "Transaksi Rp 15.000 di TOKO ABC",
      date: at(10, 6),
    });
    console.log("✓ Data demo dimasukkan.");
  }
}

const api = createApp(() => db);
const app = new Hono();
app.route("/", api as unknown as Hono);
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", (c) => {
  const index = "./dist/client/index.html";
  if (!existsSync(index)) return c.text("Jalankan `npm run build` dulu.", 500);
  return c.html(readFileSync(index, "utf8"));
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: (req) => app.fetch(req, env), port });
console.log(
  `Montrack lokal: http://localhost:${port}  (password: ${process.env.LOCAL_APP_PASSWORD ? "dari LOCAL_APP_PASSWORD" : "montrack"})`,
);
