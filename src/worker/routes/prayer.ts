import type { Hono } from "hono";
import type { AppEnv } from "../app";
import { formatClock, formatCountdown, prayerToday } from "../../shared/prayer";

/**
 * Endpoint publik (tanpa login, tanpa database) untuk widget Android (KWGT) dsb.
 * Hanya menghitung dari koordinat yang dikirim; tidak membaca/menyimpan data apa pun.
 *   GET /api/public/sholat?lat=-6.2&lon=106.8&tz=Asia/Jakarta&format=json|next|today
 */
export function registerPrayerRoutes(app: Hono<AppEnv>) {
  app.get("/public/sholat", (c) => {
    const lat = Number(c.req.query("lat"));
    const lon = Number(c.req.query("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 66 || Math.abs(lon) > 180) {
      return c.json({ error: "lat/lon tidak valid" }, 400);
    }
    let tz = c.req.query("tz") || "Asia/Jakarta";
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch {
      tz = "Asia/Jakarta";
    }
    const r = prayerToday(lat, lon, new Date(), tz);
    const clock = (d: Date) => formatClock(d, tz);
    c.header("Cache-Control", "public, max-age=60");
    c.header("Access-Control-Allow-Origin", "*");
    const format = c.req.query("format") ?? "json";
    if (format === "next") return c.text(`${r.next.label} ${clock(r.next.time)} · ${formatCountdown(r.minutesLeft)}`);
    if (format === "today") return c.text(r.today.map((p) => `${p.label} ${clock(p.time)}`).join("\n"));
    return c.json({
      lat,
      lon,
      tz,
      next: { key: r.next.key, label: r.next.label, time: clock(r.next.time), minutesLeft: r.minutesLeft },
      current: r.current?.key ?? null,
      today: Object.fromEntries(r.today.map((p) => [p.key, clock(p.time)])),
    });
  });
}
