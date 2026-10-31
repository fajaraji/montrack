/** Ubah HTML email menjadi teks per baris (cukup untuk tabel struk bank/e-wallet). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table|section)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function toLines(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((l) => l.split("\t"))
    .map((l) => l.replace(/[  ]+/g, " ").trim())
    .filter(Boolean);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cari nilai untuk salah satu label, mendukung:
 *   "Nominal : Rp 25.000"   |  "Nominal Rp 25.000"  |  "Nominal" ⏎ "Rp 25.000"
 * Label dicoba berurutan; label pertama yang ditemukan menang.
 */
export function findField(lines: string[], labels: string[], opts: { valuePattern?: RegExp } = {}): string | null {
  for (const label of labels) {
    const re = new RegExp(`^${escapeRe(label)}\\b\\s*[:：\\-=]?\\s*(.*)$`, "i");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      const candidates = [m[1], lines[i + 1], lines[i + 2]].filter((v): v is string => !!v && !!v.trim());
      for (const c of candidates) {
        const v = c.replace(/^[:：\-=]\s*/, "").trim();
        if (!v) continue;
        if (opts.valuePattern && !opts.valuePattern.test(v)) continue;
        return v;
      }
    }
  }
  return null;
}
