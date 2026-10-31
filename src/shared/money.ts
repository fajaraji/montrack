/**
 * Mengubah teks nominal (format Indonesia maupun internasional) menjadi rupiah utuh.
 * "Rp 35.000" → 35000, "Rp1.250.000,00" → 1250000, "IDR 1,250,000.00" → 1250000,
 * "Rp 25.000,-" → 25000, "35.00" → 35.
 */
export function parseRupiah(input: string | null | undefined): number | null {
  if (!input) return null;
  const m = input.match(/-?\d[\d.,]*/);
  if (!m) return null;
  let s = m[0].replace(/[.,]+$/, "");
  const negative = s.startsWith("-");
  s = s.replace(/^-/, "");
  // Pisahkan bagian desimal (tepat 1–2 digit setelah pemisah terakhir).
  const dec = s.match(/^(.*\d)[.,](\d{1,2})$/);
  let intPart = s;
  let frac = 0;
  if (dec) {
    const lastSep = s[dec[1].length];
    const before = dec[1];
    const otherSep = lastSep === "," ? "." : ",";
    // "35.00" atau "1.250.000,00" atau "1,250,000.00": anggap desimal bila
    // pemisahnya berbeda dari pemisah ribuan atau tidak ada pemisah ribuan sama sekali.
    if (before.includes(otherSep) || !before.includes(lastSep)) {
      intPart = before;
      frac = Number(dec[2].padEnd(2, "0")) / 100;
    }
  }
  const digits = intPart.replace(/[.,]/g, "");
  if (!digits) return null;
  const value = Math.round(Number(digits) + frac);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function formatRupiah(n: number, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(Math.round(n)).toLocaleString("id-ID");
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${sign}Rp${abs}`;
}

/** Ringkas: Rp1,2 jt / Rp350 rb */
export function formatRupiahShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000_000) return `${sign}Rp${(abs / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000_000) return `${sign}Rp${(abs / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (abs >= 1_000) return `${sign}Rp${Math.round(abs / 1_000).toLocaleString("id-ID")} rb`;
  return `${sign}Rp${abs}`;
}
