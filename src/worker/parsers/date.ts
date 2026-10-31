import { fromWib } from "../../shared/time";

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, ags: 8, agus: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, nop: 11, november: 11, nopember: 11,
  des: 12, dec: 12, desember: 12, december: 12,
};

function tzOffsetHours(s: string): number {
  if (/\bWITA\b/i.test(s)) return 8;
  if (/\bWIT\b/i.test(s)) return 9;
  const g = s.match(/(?:GMT|UTC)\s*([+-])\s*(\d{1,2})/i);
  if (g) return (g[1] === "-" ? -1 : 1) * Number(g[2]);
  return 7; // default WIB
}

function build(y: number, mo: number, d: number, h: number, mi: number, sec: number, tz: number): Date | null {
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // fromWib mengasumsikan +7; koreksi jika zona lain.
  const dt = fromWib(y, mo, d, h, mi, sec);
  return new Date(dt.getTime() - (tz - 7) * 3600_000);
}

/** Parse tanggal/jam gaya Indonesia & internasional. Mengembalikan null bila tidak dikenali. */
export function parseIndoDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = input.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const tz = tzOffsetHours(s);
  const pickTime = (rest: string) => {
    const t = rest.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?!\d)/);
    return t ? [Number(t[1]), Number(t[2]), Number(t[3] ?? 0)] : [0, 0, 0];
  };

  // 2026-10-31 14:22
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.*))?/);
  if (m) {
    const [h, mi, sec] = pickTime(m[4] ?? "");
    return build(+m[1], +m[2], +m[3], h, mi, sec, tz);
  }
  // 31/10/2026 14:22  atau 31-10-26
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(.*)/);
  if (m) {
    const [h, mi, sec] = pickTime(m[4] ?? "");
    return build(+m[3], +m[2], +m[1], h, mi, sec, tz);
  }
  // 31 Okt 2026 14:22  /  31 Oktober 2026 pukul 14.22
  m = s.match(/(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{2,4})(.*)/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) {
      const [h, mi, sec] = pickTime(m[4] ?? "");
      return build(+m[3], mo, +m[1], h, mi, sec, tz);
    }
  }
  // Oct 31, 2026 14:22
  m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})(.*)/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) {
      const [h, mi, sec] = pickTime(m[4] ?? "");
      return build(+m[3], mo, +m[2], h, mi, sec, tz);
    }
  }
  return null;
}
