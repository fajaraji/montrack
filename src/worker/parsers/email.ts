import { parseRupiah } from "../../shared/money";
import { parseIndoDate } from "./date";
import { findField, htmlToText, toLines } from "./text";

export type ParsedKind =
  | "expense" //      bayar QRIS / merchant / tagihan
  | "income" //       uang masuk dari pihak lain, refund, cashback
  | "topup_out" //    rekening bank → isi saldo e-wallet (target diketahui)
  | "topup_in" //     e-wallet menerima top-up (sumber belum tentu diketahui)
  | "transfer_out" // transfer keluar ke rekening/nama lain
  | "transfer_in" //  transfer masuk dari rekening/nama lain
  | "withdraw"; //    tarik tunai

export interface EmailInput {
  from: string;
  subject: string;
  body: string;
  date: Date;
}

export interface ParsedEmail {
  provider: string;
  kind: ParsedKind;
  amount: number;
  fee: number;
  merchant: string | null;
  counterparty: string | null;
  /** provider e-wallet tujuan, untuk topup_out */
  target: string | null;
  occurredAt: Date;
  reference: string | null;
  last4: string | null;
  confidence: "high" | "low";
  notes: string[];
}

export type ParseResult =
  | { ok: true; parsed: ParsedEmail }
  | { ok: false; status: "ignored" | "unparsed"; provider: string | null; reason: string };

interface ProviderDef {
  id: string;
  /** cocok dengan alamat/nama pengirim */
  from: RegExp;
  /** penanda di isi email (untuk email yang diteruskan / pengirim tak dikenal) */
  body?: RegExp;
  ewallet: boolean;
}

export const PROVIDER_DEFS: ProviderDef[] = [
  { id: "bri", from: /bri\.co\.id|brimo|\bbank bri\b/i, body: /\bBRImo\b|Bank Rakyat Indonesia/i, ewallet: false },
  { id: "bni", from: /bni\.co\.id|wondr|\bbni\b/i, body: /wondr by BNI|BNI Mobile Banking|Bank Negara Indonesia/i, ewallet: false },
  { id: "bsi", from: /bankbsi\.co\.id|\bbsi\b/i, body: /BSI Mobile|Bank Syariah Indonesia|BYOND by BSI/i, ewallet: false },
  { id: "bca", from: /bca\.co\.id|klikbca|\bbca\b/i, body: /myBCA|BCA mobile|Bank Central Asia/i, ewallet: false },
  { id: "mandiri", from: /bankmandiri\.co\.id|livin|\bmandiri\b/i, body: /Livin' by Mandiri|Bank Mandiri/i, ewallet: false },
  { id: "gopay", from: /gopay|gojek\.com|gotofinancial/i, body: /\bGoPay\b/i, ewallet: true },
  { id: "ovo", from: /ovo\.id|\bovo\b/i, body: /\bOVO\b/, ewallet: true },
  { id: "dana", from: /dana\.id|\bdana\b/i, body: /\bDANA\b/, ewallet: true },
  { id: "shopeepay", from: /shopeepay|shopee\.co\.id/i, body: /ShopeePay/i, ewallet: true },
  { id: "linkaja", from: /linkaja/i, body: /LinkAja/i, ewallet: true },
];

const EWALLET_NAMES: [string, RegExp][] = [
  ["gopay", /go-?pay/i],
  ["ovo", /\bovo\b/i],
  ["dana", /\bdana\b/i],
  ["shopeepay", /shopee ?pay/i],
  ["linkaja", /link ?aja/i],
];

export function detectProvider(from: string, subject: string, body: string): ProviderDef | null {
  const byFrom = PROVIDER_DEFS.find((p) => p.from.test(from));
  if (byFrom) return byFrom;
  const head = `${subject}\n${body.slice(0, 2000)}`;
  return PROVIDER_DEFS.find((p) => p.body && p.body.test(head)) ?? null;
}

const AMOUNT_RE = /(?:Rp\.?|IDR)\s*-?\d|^\s*-?\d[\d.,]*\d\s*$/i;

const NOMINAL_LABELS = [
  "Nominal Transaksi", "Nominal Transfer", "Nominal Pembayaran", "Nominal Top Up", "Nominal",
  "Jumlah Transfer", "Jumlah Pembayaran", "Jumlah Top Up", "Jumlah Penarikan", "Jumlah",
  "Harga", "Subtotal", "Amount",
];
const TOTAL_LABELS = [
  "Total Pembayaran", "Total Bayar", "Total Dibayar", "Total Transaksi", "Total Transfer",
  "Total Tagihan", "Total Debet", "Total Debit", "Total Amount", "Total Payment", "Total",
  "Kamu bayar", "Anda membayar", "You paid", "Amount paid",
];
const FEE_LABELS = ["Biaya Admin", "Biaya Administrasi", "Biaya Transaksi", "Biaya Layanan", "Admin Fee", "Biaya", "Fee"];
const MERCHANT_LABELS = [
  "Nama Merchant", "Merchant Name", "Merchant", "Nama Toko", "Toko", "Dibayar ke", "Bayar ke", "Paid to",
  "Pembayaran ke", "Nama Penerima", "Penerima", "Tujuan", "Kepada", "Ke",
];
const COUNTERPARTY_OUT_LABELS = ["Nama Penerima", "Penerima", "Rekening Tujuan", "Tujuan", "Kepada", "Ke", "Recipient", "To"];
const COUNTERPARTY_IN_LABELS = ["Nama Pengirim", "Pengirim", "Dari", "Rekening Pengirim", "Sender", "From"];
const DATE_LABELS = [
  "Tanggal & Waktu", "Tanggal dan Waktu", "Waktu Transaksi", "Tanggal Transaksi", "Tgl Transaksi",
  "Tanggal", "Waktu", "Date", "Transaction Date", "Time",
];
const REF_LABELS = [
  "No. Referensi", "Nomor Referensi", "No Referensi", "No. Ref", "No Ref", "Ref No", "Reference No",
  "Reference Number", "Reference ID", "Ref ID", "ID Transaksi", "Transaction ID", "Order ID", "No. Transaksi", "Nomor Transaksi", "Referensi", "Kode RRN", "RRN",
];
const TIME_LABELS = ["Waktu", "Jam", "Pukul", "Time"];
const SOURCE_LABELS = ["Rekening Sumber", "Sumber Dana", "Dari Rekening", "Rekening Debet", "Nomor Rekening", "Source of Fund", "No. Rekening"];

const IGNORE_SUBJECT = /\b(otp|kode verifikasi|verification code|kode keamanan|login|masuk ke akun|perangkat baru|new device|ubah pin|reset password|kata sandi|e-?statement|rekening koran|laporan bulanan|newsletter|promo|diskon|voucher spesial|cashback hingga|hemat hingga|survey|survei|undian|terms|syarat dan ketentuan|kebijakan privasi)\b/i;
const FAILED = /\b(gagal|ditolak|dibatalkan|failed|declined|cancel(l)?ed|tidak berhasil|pending|menunggu pembayaran|awaiting payment|segera bayar|batas waktu pembayaran)\b/i;

function detectKind(text: string, ewallet: boolean): { kind: ParsedKind; strong: boolean } | null {
  const t = text.toLowerCase();
  if (/tarik tunai|penarikan tunai|cash withdrawal|tarik dana tunai/.test(t)) return { kind: "withdraw", strong: true };
  if (/\btop ?-?up\b|isi saldo|isi ulang saldo/.test(t)) {
    // Bank yang top-up e-wallet; e-wallet yang menerima top-up.
    return { kind: ewallet ? "topup_in" : "topup_out", strong: true };
  }
  if (/refund|pengembalian dana|dana dikembalikan|cashback (masuk|diterima|berhasil)/.test(t)) return { kind: "income", strong: true };
  const incoming = /dana masuk|uang masuk|transfer masuk|kamu (menerima|terima)|anda (menerima|terima)|telah menerima|diterima dari|received from|you received|incoming transfer|kredit masuk|terima uang|terima dana/.test(t);
  if (incoming) return { kind: "transfer_in", strong: true };
  if (/\btransfer\b|\btrf\b|kirim uang|kirim dana|bi-?fast|online transfer|transfer antar|transfer ke/.test(t)) {
    return { kind: "transfer_out", strong: true };
  }
  if (/qris|pembayaran|bayar|payment|purchase|pembelian|transaksi berhasil|paid|berhasil dibayar|tagihan|belanja|order/.test(t)) {
    return { kind: "expense", strong: /qris|pembayaran berhasil|payment successful|berhasil dibayar|bukti pembayaran|struk/.test(t) };
  }
  return null;
}

function extractLast4(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})\D*$/);
  return m ? m[1] : null;
}

function cleanName(s: string | null): string | null {
  if (!s) return null;
  const v = s
    // kode terminal QRIS di depan nama merchant, mis. "9XY9 MPM TOKO ..."
    .replace(/^(?:[A-Z0-9]*\d[A-Z0-9]*\s+)?MPM\s+/i, "")
    .replace(/_+/g, " ")
    .replace(/(?:Rp\.?|IDR)\s*[\d.,]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[-:•\s]+|[-:•\s]+$/g, "")
    .trim();
  if (!v || v.length > 80 || /^\d[\d\s*xX.-]*$/.test(v)) return null;
  return v;
}

function findAmount(lines: string[], labels: string[]): number | null {
  const v = findField(lines, labels, { valuePattern: AMOUNT_RE });
  const n = parseRupiah(v);
  return n != null && n > 0 ? n : null;
}

function firstRupiah(text: string): number | null {
  const m = text.match(/(?:Rp\.?|IDR)\s*([\d.,]+)/i);
  const n = m ? parseRupiah(m[1]) : null;
  return n && n > 0 ? n : null;
}

export function parseEmail(input: EmailInput): ParseResult {
  const raw = /<[a-z][\s\S]*>/i.test(input.body) ? htmlToText(input.body) : input.body;
  const lines = toLines(raw);
  const text = lines.join("\n");
  const provider = detectProvider(input.from, input.subject, text);

  if (IGNORE_SUBJECT.test(input.subject) && !/bukti|struk|berhasil|receipt/i.test(input.subject)) {
    return { ok: false, status: "ignored", provider: provider?.id ?? null, reason: "Bukan email transaksi (OTP/promo/info)." };
  }
  if (FAILED.test(input.subject) || /transaksi (gagal|dibatalkan)|payment failed/i.test(text.slice(0, 600))) {
    return { ok: false, status: "ignored", provider: provider?.id ?? null, reason: "Transaksi gagal/pending, tidak dicatat." };
  }
  if (!provider) {
    return { ok: false, status: "unparsed", provider: null, reason: "Pengirim tidak dikenali." };
  }

  const kindInfo = detectKind(`${input.subject}\n${text.slice(0, 1500)}`, provider.ewallet);
  if (!kindInfo) {
    return { ok: false, status: "unparsed", provider: provider.id, reason: "Jenis transaksi tidak dikenali." };
  }
  const notes: string[] = [];
  let { kind } = kindInfo;

  const nominal = findAmount(lines, NOMINAL_LABELS);
  const total = findAmount(lines, TOTAL_LABELS);
  let fee = findAmount(lines, FEE_LABELS) ?? 0;
  let amount: number | null = nominal;
  if (nominal != null && total != null) {
    if (!fee && total > nominal) fee = total - nominal;
  } else if (nominal == null && total != null) {
    amount = fee && total > fee ? total - fee : total;
  }
  let amountFromLabel = amount != null;
  if (amount == null) {
    amount = firstRupiah(text) ?? firstRupiah(input.subject);
    amountFromLabel = false;
    if (amount != null) notes.push("Nominal diambil dari angka Rp pertama.");
  }
  if (amount == null) {
    return { ok: false, status: "unparsed", provider: provider.id, reason: "Nominal tidak ditemukan." };
  }
  if (fee >= amount) fee = 0;

  let dateStr = findField(lines, DATE_LABELS, { valuePattern: /\d/ });
  // Tanggal dan jam di baris terpisah (mis. wondr BNI: "Tanggal" ⏎ "11 Okt 2026", "Waktu" ⏎ "21:33:37 WIB").
  if (dateStr && !/\d{1,2}[:.]\d{2}/.test(dateStr)) {
    const time = findField(lines, TIME_LABELS, { valuePattern: /^\d{1,2}[:.]\d{2}/ });
    if (time) dateStr = `${dateStr} ${time}`;
  }
  let occurredAt = parseIndoDate(dateStr);
  if (!occurredAt || Math.abs(occurredAt.getTime() - input.date.getTime()) > 40 * 86400_000) {
    if (dateStr) notes.push("Tanggal di email tidak terbaca, memakai waktu email.");
    occurredAt = input.date;
  }

  const reference = cleanRef(findField(lines, REF_LABELS, { valuePattern: /[A-Za-z0-9]{4,}/ }));
  const last4 = extractLast4(findField(lines, SOURCE_LABELS, { valuePattern: /\d{3,}/ }));

  let merchant: string | null = null;
  let counterparty: string | null = null;
  let target: string | null = null;

  if (kind === "transfer_out" || kind === "topup_out") {
    counterparty = cleanName(findField(lines, COUNTERPARTY_OUT_LABELS));
  } else if (kind === "transfer_in" || kind === "topup_in") {
    counterparty = cleanName(findField(lines, COUNTERPARTY_IN_LABELS));
  } else if (kind === "expense") {
    merchant = cleanName(findField(lines, MERCHANT_LABELS));
  } else if (kind === "income") {
    counterparty = cleanName(findField(lines, COUNTERPARTY_IN_LABELS)) ?? cleanName(findField(lines, MERCHANT_LABELS));
  }

  // Transfer dari bank ke e-wallet = top-up.
  if (!provider.ewallet && (kind === "transfer_out" || kind === "topup_out" || kind === "expense")) {
    const hay = `${input.subject}\n${counterparty ?? ""}\n${merchant ?? ""}\n${kind === "topup_out" ? text.slice(0, 1500) : ""}`;
    const hit = EWALLET_NAMES.find(([, re]) => re.test(hay));
    if (hit && (kind !== "expense" || /top ?up|isi saldo/i.test(hay))) {
      kind = "topup_out";
      target = hit[0];
    }
  }
  if (kind === "topup_out" && !target) {
    // Top-up dari bank tapi e-wallet tujuan tidak terdeteksi: perlakukan sebagai transfer keluar.
    kind = "transfer_out";
    notes.push("Top-up tanpa e-wallet tujuan yang jelas.");
  }

  if (!merchant && kind === "expense") {
    merchant = cleanName(
      input.subject
        .replace(/\b(bukti|struk|receipt|notifikasi|transaksi|pembayaran|payment|berhasil|successful|kamu|anda|telah|di|qris|e-?receipt)\b/gi, " ")
        .replace(/[|:–—-]+/g, " "),
    );
  }

  const confidence: "high" | "low" = amountFromLabel && kindInfo.strong ? "high" : "low";
  return {
    ok: true,
    parsed: {
      provider: provider.id,
      kind,
      amount,
      fee,
      merchant,
      counterparty,
      target,
      occurredAt,
      reference,
      last4,
      confidence,
      notes,
    },
  };
}

function cleanRef(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/[A-Za-z0-9-]{4,}/);
  return m ? m[0] : null;
}
