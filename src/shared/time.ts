/** Semua perhitungan "bulan ini" memakai WIB (UTC+7, tanpa DST). */
export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface Ym {
  year: number;
  month: number; // 1..12
}

export function wibParts(d: Date) {
  const w = new Date(d.getTime() + WIB_OFFSET_MS);
  return {
    year: w.getUTCFullYear(),
    month: w.getUTCMonth() + 1,
    day: w.getUTCDate(),
    hour: w.getUTCHours(),
    minute: w.getUTCMinutes(),
  };
}

/** Instant UTC dari tanggal/jam lokal WIB. */
export function fromWib(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - WIB_OFFSET_MS);
}

export function parseYm(s: string | undefined | null, now = new Date()): Ym {
  const m = s?.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { year: Number(m[1]), month };
  }
  const p = wibParts(now);
  return { year: p.year, month: p.month };
}

export function formatYm(ym: Ym): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

export function addMonths(ym: Ym, delta: number): Ym {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function daysInMonth(ym: Ym): number {
  return new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate();
}

/** [start, end) dalam UTC untuk satu bulan WIB. */
export function monthRange(ym: Ym): { start: Date; end: Date } {
  const next = addMonths(ym, 1);
  return { start: fromWib(ym.year, ym.month, 1), end: fromWib(next.year, next.month, 1) };
}

/** "YYYY-MM-DD" tanggal WIB. */
export function wibDateKey(d: Date): string {
  const p = wibParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
