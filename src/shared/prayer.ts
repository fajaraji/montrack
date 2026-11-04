/**
 * Waktu sholat dihitung lokal dari koordinat (tanpa API), parameter Kemenag RI:
 * Subuh 20°, Isya 18°, Ashar mazhab Syafi'i, plus ihtiyat (koreksi kehati-hatian)
 * Subuh/Ashar/Isya +2 menit, Dzuhur/Maghrib +3 menit, Terbit −2 menit, Imsak = Subuh − 10 menit.
 * Dicocokkan dengan jadwal Kemenag Kota Jakarta 5 Nov 2026 (lihat tests/prayer.test.ts).
 */
import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from "adhan";

export type PrayerKey = "imsak" | "subuh" | "terbit" | "dzuhur" | "ashar" | "maghrib" | "isya";

export interface PrayerTime {
  key: PrayerKey;
  label: string;
  time: Date;
  /** waktu sholat wajib (bukan imsak/terbit) */
  wajib: boolean;
}

const LABEL: Record<PrayerKey, string> = {
  imsak: "Imsak",
  subuh: "Subuh",
  terbit: "Terbit",
  dzuhur: "Dzuhur",
  ashar: "Ashar",
  maghrib: "Maghrib",
  isya: "Isya",
};

/** Tanggal kalender (Y-M-D) di zona waktu tertentu. */
export function localYmd(now: Date, timeZone?: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Jadwal satu hari kalender (y-m-d) untuk koordinat tertentu. */
export function prayerTimesFor(lat: number, lon: number, ymd: { y: number; m: number; d: number }): PrayerTime[] {
  const params = CalculationMethod.Singapore(); // 20° / 18°
  params.madhab = Madhab.Shafi;
  params.methodAdjustments = { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
  params.adjustments = { fajr: 2, sunrise: -2, dhuhr: 3, asr: 2, maghrib: 3, isha: 2 };
  // adhan membaca komponen tanggal lokal dari objek Date; buat tanggal "polos" tengah hari.
  const t = new PrayerTimes(new Coordinates(lat, lon), new Date(ymd.y, ymd.m - 1, ymd.d, 12), params);
  const list: [PrayerKey, Date, boolean][] = [
    ["imsak", new Date(t.fajr.getTime() - 10 * 60_000), false],
    ["subuh", t.fajr, true],
    ["terbit", t.sunrise, false],
    ["dzuhur", t.dhuhr, true],
    ["ashar", t.asr, true],
    ["maghrib", t.maghrib, true],
    ["isya", t.isha, true],
  ];
  return list.map(([key, time, wajib]) => ({ key, label: LABEL[key], time, wajib }));
}

/** Jadwal hari ini + sholat wajib berikutnya (bila Isya sudah lewat → Subuh besok). */
export function prayerToday(lat: number, lon: number, now = new Date(), timeZone?: string) {
  const ymd = localYmd(now, timeZone);
  const today = prayerTimesFor(lat, lon, ymd);
  let next = today.find((p) => p.wajib && p.time.getTime() > now.getTime());
  if (!next) {
    const tmr = localYmd(new Date(now.getTime() + 86400_000), timeZone);
    next = prayerTimesFor(lat, lon, tmr).find((p) => p.key === "subuh")!;
  }
  const current = [...today].reverse().find((p) => p.wajib && p.time.getTime() <= now.getTime()) ?? null;
  return { today, next, current, minutesLeft: Math.max(0, Math.ceil((next.time.getTime() - now.getTime()) / 60_000)) };
}

export function formatClock(d: Date, timeZone?: string): string {
  return d.toLocaleTimeString("id-ID", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).replace(".", ":");
}

export function formatCountdown(min: number): string {
  if (min < 60) return `${min} menit lagi`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} jam ${m} menit lagi` : `${h} jam lagi`;
}
