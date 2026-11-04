import { describe, it, expect } from "vitest";
import { formatClock, prayerTimesFor, prayerToday } from "../src/shared/prayer";

const TZ = "Asia/Jakarta";
const clocks = (lat: number, lon: number, y: number, m: number, d: number) =>
  Object.fromEntries(prayerTimesFor(lat, lon, { y, m, d }).map((p) => [p.key, formatClock(p.time, TZ)]));

describe("waktu sholat (parameter Kemenag)", () => {
  it("cocok dengan jadwal Kemenag Kota Jakarta, 5 Nov 2026", () => {
    // Pembanding: tabel jadwal sholat Kota Jakarta (kode Kemenag 1301), Liputan6 Nov 2026.
    expect(clocks(-6.1754, 106.8272, 2026, 11, 5)).toMatchObject({
      imsak: "03:58", subuh: "04:08", dzuhur: "11:40", ashar: "14:57", maghrib: "17:50", isya: "19:02",
    });
  });
  it("beda daerah, beda waktu (Cianjur lebih lambat dari Jakarta)", () => {
    const jkt = clocks(-6.1754, 106.8272, 2026, 11, 5);
    const cjr = clocks(-6.8167, 107.1333, 2026, 11, 5);
    expect(cjr.dzuhur).not.toBe(jkt.dzuhur);
  });
  it("sholat berikutnya & lewat Isya → Subuh besok", () => {
    const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 5, h - 7, m));
    expect(prayerToday(-6.1754, 106.8272, at(12, 0), TZ).next.key).toBe("ashar");
    const late = prayerToday(-6.1754, 106.8272, at(21, 0), TZ);
    expect(late.next.key).toBe("subuh");
    expect(formatClock(late.next.time, TZ)).toMatch(/^04:0/);
    expect(late.minutesLeft).toBeGreaterThan(400);
  });
});

import { createApp, type Bindings } from "../src/worker/app";
import { createTestDb } from "./testDb";

describe("GET /api/public/sholat", () => {
  const env: Bindings = { DATABASE_URL: "x", APP_PASSWORD: "p", SESSION_SECRET: "s-yang-panjang", INGEST_SECRET: "i" };
  it("publik tanpa login, json & teks widget", async () => {
    const db = await createTestDb();
    const app = createApp(() => db);
    const j = await app.request("/api/public/sholat?lat=-6.2&lon=106.85&tz=Asia/Jakarta", {}, env);
    expect(j.status).toBe(200);
    const body = (await j.json()) as { today: Record<string, string>; next: { label: string } };
    expect(Object.keys(body.today)).toEqual(["imsak", "subuh", "terbit", "dzuhur", "ashar", "maghrib", "isya"]);
    const t = await app.request("/api/public/sholat?lat=-6.2&lon=106.85&format=next", {}, env);
    expect(await t.text()).toMatch(/^(Subuh|Dzuhur|Ashar|Maghrib|Isya) \d\d:\d\d · /);
    const bad = await app.request("/api/public/sholat?lat=abc&lon=1", {}, env);
    expect(bad.status).toBe(400);
  });
});
