/**
 * Parser mutasi rekening (CSV & teks PDF) yang berjalan di browser.
 * Hasilnya ImportRow[] yang dipratinjau pengguna sebelum dikirim ke server.
 */
import { parseRupiah } from "./money";
import type { ImportRow } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, peb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, ags: 8, aug: 8,
  sep: 9, okt: 10, oct: 10, nov: 11, nop: 11, des: 12, dec: 12,
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Tanggal di awal string. Mengembalikan [YYYY-MM-DD, panjang yang dipakai]. */
export function parseDateLoose(s: string, fallbackYear: number): [string, number] | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const v = ymd(+m[1], +m[2], +m[3]); return v ? [v, m[0].length] : null; }
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?!\d)/);
  if (m) { const v = ymd(+m[3], +m[2], +m[1]); return v ? [v, m[0].length] : null; }
  m = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})(?!\d)/);
  if (m && MONTHS[m[2].toLowerCase()]) { const v = ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]); return v ? [v, m[0].length] : null; }
  m = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*(?![A-Za-z])/);
  if (m && MONTHS[m[2].toLowerCase()]) { const v = ymd(fallbackYear, MONTHS[m[2].toLowerCase()], +m[1]); return v ? [v, m[0].length] : null; }
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?![\d/])/);
  if (m) { const v = ymd(fallbackYear, +m[2], +m[1]); return v ? [v, m[0].length] : null; }
  return null;
}

/** Cari tahun periode di teks laporan ("Periode: 01 Okt 2026 - 31 Okt 2026"). */
export function guessYear(text: string, now = new Date()): number {
  const m = text.match(/periode[^\n]{0,60}?(20\d{2})/i) ?? text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : now.getFullYear();
}

// ---------------- CSV ----------------

export function parseCsvText(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLines = clean.split(/\r?\n/).slice(0, 10).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => [d, firstLines.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (q) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

export interface CsvMapping {
  headerRow: number;
  date: number;
  description: number;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  dc: number | null;
}

const H = {
  date: /^(tanggal|tgl|date|posting|tanggal transaksi|trans(action)? date|waktu)/i,
  description: /(keterangan|deskripsi|uraian|description|remark|detail|narasi|transaksi|berita)/i,
  debit: /^(debet|debit|db|keluar|uang keluar|withdrawal|mutasi debet|mutasi debit)$/i,
  credit: /^(kredit|credit|cr|masuk|uang masuk|deposit|mutasi kredit)$/i,
  amount: /^(jumlah|amount|nominal|mutasi|nilai)/i,
  dc: /^(d\/?k|db\/?cr|dk|tipe|type|jenis|d\/c)$/i,
};

export function detectCsvMapping(table: string[][]): CsvMapping | null {
  for (let r = 0; r < Math.min(table.length, 20); r++) {
    const cells = table[r];
    const find = (re: RegExp, exclude: number[] = []) => cells.findIndex((c, i) => !exclude.includes(i) && re.test(c));
    const date = find(H.date);
    if (date < 0) continue;
    const debit = find(H.debit);
    const credit = find(H.credit);
    const amount = find(H.amount, [debit, credit]);
    if (debit < 0 && credit < 0 && amount < 0) continue;
    let description = find(H.description, [date]);
    if (description < 0) description = cells.findIndex((_, i) => ![date, debit, credit, amount].includes(i));
    return {
      headerRow: r,
      date,
      description,
      debit: debit >= 0 ? debit : null,
      credit: credit >= 0 ? credit : null,
      amount: debit < 0 && credit < 0 ? amount : null,
      dc: (() => { const i = find(H.dc); return i >= 0 ? i : null; })(),
    };
  }
  return null;
}

function signedAmount(cell: string, dcCell?: string): number | null {
  const n = parseRupiah(cell.replace(/\s/g, ""));
  if (n == null) return null;
  const tag = `${dcCell ?? ""} ${cell}`.toUpperCase();
  if (/\b(DB|D|DEBIT|DEBET)\b/.test(tag) || /\d\s*DB$/.test(cell.toUpperCase())) return -Math.abs(n);
  if (/\b(CR|K|KREDIT|CREDIT)\b/.test(tag) || /\d\s*CR$/.test(cell.toUpperCase())) return Math.abs(n);
  if (/^\s*-|\(\s*[\d.,]+\s*\)/.test(cell)) return -Math.abs(n);
  return n;
}

export function rowsFromCsv(table: string[][], map: CsvMapping, fallbackYear: number): ImportRow[] {
  const out: ImportRow[] = [];
  for (const cells of table.slice(map.headerRow + 1)) {
    const d = parseDateLoose(cells[map.date] ?? "", fallbackYear);
    if (!d) continue;
    let amount: number | null = null;
    if (map.debit != null || map.credit != null) {
      const deb = map.debit != null ? parseRupiah(cells[map.debit]) ?? 0 : 0;
      const cre = map.credit != null ? parseRupiah(cells[map.credit]) ?? 0 : 0;
      amount = Math.abs(cre) - Math.abs(deb);
    } else if (map.amount != null) {
      amount = signedAmount(cells[map.amount] ?? "", map.dc != null ? cells[map.dc] : undefined);
    }
    if (!amount) continue;
    out.push({ date: d[0], description: (cells[map.description] ?? "").replace(/\s+/g, " ").trim(), amount });
  }
  return out;
}

// ---------------- PDF ----------------

export interface TextItem {
  str: string;
  x: number;
  /** koordinat PDF: makin besar makin ke atas */
  y: number;
  page: number;
}

interface Line {
  page: number;
  y: number;
  items: TextItem[];
}

export function groupLines(items: TextItem[], tolerance = 2.5): Line[] {
  const sorted = items
    .filter((i) => i.str.trim())
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= tolerance) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

const AMOUNT_TOKEN = /^\(?-?(?:Rp\.?\s*)?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\)?(?:\s*(?:DB|CR|D|K))?$/i;
const STOP_WORDS = /^(saldo awal|saldo akhir|opening balance|closing balance|total|halaman|page|mutasi debet|mutasi kredit|jumlah)/i;

function isAmountToken(s: string): boolean {
  const t = s.trim();
  if (!AMOUNT_TOKEN.test(t)) return false;
  const digits = t.replace(/\D/g, "");
  // butuh pemisah ribuan/desimal, atau setidaknya 3 digit, agar nomor kecil tidak terbaca nominal
  return /[.,]/.test(t) || digits.length >= 3;
}

export interface PdfParseResult {
  rows: (ImportRow & { balance?: number | null; guessed?: boolean })[];
  warnings: string[];
}

export function parseStatementItems(items: TextItem[], fallbackYear?: number): PdfParseResult {
  const lines = groupLines(items);
  const allText = lines.map((l) => l.items.map((i) => i.str).join(" ")).join("\n");
  const year = fallbackYear ?? guessYear(allText);
  const warnings: string[] = [];

  // Kolom dari baris header.
  let cols: { debit?: number; credit?: number; balance?: number } = {};
  for (const l of lines) {
    const find = (re: RegExp) => l.items.find((i) => re.test(i.str.trim()));
    const d = find(/^(debet|debit|db|mutasi debet|mutasi debit|keluar)$/i);
    const c = find(/^(kredit|credit|cr|mutasi kredit|masuk)$/i);
    if (d && c) {
      const b = find(/^(saldo|balance)$/i);
      cols = { debit: d.x, credit: c.x, balance: b?.x };
      break;
    }
  }

  type Row = PdfParseResult["rows"][number] & { _desc: string[] };
  const rows: Row[] = [];
  let current: Row | null = null;

  for (const l of lines) {
    const text = l.items.map((i) => i.str).join(" ").trim();
    const date = parseDateLoose(text, year);
    if (date) {
      const descTokens: string[] = [];
      const amounts: { v: string; x: number }[] = [];
      let consumed = 0;
      for (const it of l.items) {
        const s = it.str.trim();
        if (consumed < date[1]) {
          consumed += s.length + 1;
          continue;
        }
        if (/^\d{1,2}[:.]\d{2}(:\d{2})?$/.test(s)) continue; // jam
        if (isAmountToken(s)) amounts.push({ v: s, x: it.x });
        else descTokens.push(s);
      }
      if (!amounts.length) {
        current = null;
        continue;
      }
      let amount: number | null = null;
      let balance: number | null = null;
      let guessed = false;
      if (cols.debit != null && cols.credit != null) {
        for (const a of amounts) {
          const dist = (x?: number) => (x == null ? Infinity : Math.abs(a.x - x));
          const n = Math.abs(parseRupiah(a.v) ?? 0);
          const nearest = [
            ["debit", dist(cols.debit)],
            ["credit", dist(cols.credit)],
            ["balance", dist(cols.balance)],
          ].sort((p, q) => (p[1] as number) - (q[1] as number))[0][0];
          if (nearest === "debit" && n) amount = -n;
          else if (nearest === "credit" && n) amount = n;
          else if (nearest === "balance") balance = parseRupiah(a.v);
        }
      } else {
        const tagged = amounts.find((a) => /(DB|CR|D|K)$/i.test(a.v));
        const mutation = tagged ?? (amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0]);
        if (amounts.length >= 2 && mutation !== amounts[amounts.length - 1]) balance = parseRupiah(amounts[amounts.length - 1].v);
        const n = Math.abs(parseRupiah(mutation.v) ?? 0);
        if (/(DB|D)$/i.test(mutation.v) || /^\(|^-/.test(mutation.v)) amount = -n;
        else if (/(CR|K)$/i.test(mutation.v)) amount = n;
        else {
          // Tebak arah dari perubahan saldo; kalau tidak bisa, anggap keluar.
          const prev = rows[rows.length - 1];
          if (balance != null && prev?.balance != null) amount = balance >= prev.balance ? n : -n;
          else { amount = -n; guessed = true; }
        }
      }
      if (!amount) {
        current = null;
        continue;
      }
      current = { date: date[0], description: "", amount, balance, guessed, _desc: descTokens };
      rows.push(current);
    } else if (current && !STOP_WORDS.test(text) && !l.items.some((i) => isAmountToken(i.str))) {
      if (current._desc.join(" ").length < 140) current._desc.push(text);
    } else if (STOP_WORDS.test(text)) {
      current = null;
    }
  }

  if (!cols.debit && rows.some((r) => r.guessed)) {
    warnings.push("Kolom debit/kredit tidak terdeteksi; arah sebagian transaksi ditebak. Periksa tanda +/− sebelum impor.");
  }
  if (!rows.length) warnings.push("Tidak ada baris transaksi yang terbaca dari PDF ini.");
  return {
    rows: rows.map(({ _desc, ...r }) => ({ ...r, description: _desc.join(" ").replace(/\s+/g, " ").trim() })),
    warnings,
  };
}
