/**
 * Parser notifikasi HP (diteruskan MacroDroid). Sengaja longgar, TIDAK terikat template:
 * cukup nominal "Rp…" + kata kunci arah (bayar/terima/top up). Merchant diambil bila ada;
 * bila ragu, transaksi tetap tercatat dan masuk Tinjau. Perubahan tampilan aplikasi
 * paling buruk membuat transaksi masuk Tinjau, bukan hilang.
 */
import { parseRupiah } from "../../shared/money";
import type { ParseResult, ParsedKind } from "./email";

export interface NotificationInput {
  app: string;
  title: string;
  text: string;
  date: Date;
}

const APPS: [string, RegExp][] = [
  ["jago", /jago|gopay tabungan/i],
  ["bni", /wondr|\bbni\b/i],
  ["bri", /brimo|\bbri\b/i],
  ["bsi", /\bbsi\b|byond/i],
  ["bca", /\bbca\b|mybca/i],
  ["mandiri", /livin|mandiri/i],
  ["dana", /\bdana\b/i],
  ["ovo", /\bovo\b/i],
  ["shopeepay", /shopee/i],
  ["gopay", /gopay|gojek/i],
];

const IGNORE = /\b(otp|kode verifikasi|verification code|login|masuk ke akun|promo|diskon|voucher|cashback hingga|gratis|undian|survey|update aplikasi|pembaruan)\b/i;
const OUT = /\b(you'?ve paid|paid|payment|pembayaran|bayar|membayar|purchase|spent|debited|sent|transfer(?:red)? to|kirim|mengirim|tarik tunai|withdraw)\b/i;
const IN = /\b(you'?ve received|received|receive|menerima|diterima|terima|masuk|credited|refund|dana masuk)\b/i;
const TOPUP = /\btop ?-?up\b|isi saldo/i;
const FAILED = /\b(gagal|failed|declined|dibatalkan|pending|menunggu)\b/i;

function grabName(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m) return null;
  const v = m[1].replace(/\s+/g, " ").trim().replace(/[.,;:!]+$/, "");
  if (!v || v.length < 2 || v.length > 50 || /^(rp|idr)\b/i.test(v)) return null;
  if ((v.match(/[a-z]/gi) ?? []).length < 2) return null; // nomor telepon/kode, bukan nama
  return v;
}

export function parseNotification(n: NotificationInput): ParseResult {
  const text = `${n.title}\n${n.text}`.replace(/\s+/g, " ").trim();
  const provider = APPS.find(([, re]) => re.test(n.app) || re.test(n.title))?.[0] ?? null;
  if (!provider) return { ok: false, status: "unparsed", provider: null, reason: "Aplikasi tidak dikenali." };
  const m = text.match(/(?:Rp\.?|IDR)\s*([\d.,]+)/i);
  const amount = m ? parseRupiah(m[1]) : null;
  if (IGNORE.test(text) && !OUT.test(text) && !IN.test(text)) return { ok: false, status: "ignored", provider, reason: "Bukan notifikasi transaksi." };
  if (FAILED.test(text)) return { ok: false, status: "ignored", provider, reason: "Transaksi gagal/pending." };
  if (!amount || amount <= 0) return { ok: false, status: "ignored", provider, reason: "Tidak ada nominal." };

  let kind: ParsedKind;
  if (TOPUP.test(text)) kind = IN.test(text) || !OUT.test(text) ? "topup_in" : "topup_out";
  else if (IN.test(text) && !/\byou'?ve paid\b/i.test(text)) kind = /refund|cashback/i.test(text) ? "income" : "transfer_in";
  else if (OUT.test(text)) kind = /transfer|kirim|sent/i.test(text) ? "transfer_out" : "expense";
  else return { ok: false, status: "unparsed", provider, reason: "Arah transaksi tidak terbaca." };

  // Nama merchant/pengirim bila ada ("at X", "to X", "di X", "ke X", "from X", "dari X"),
  // hanya dari kalimat inti (sebelum teks bantuan seperti "Need help? Contact ...").
  const core = text.split(/\b(?:need help|contact|butuh bantuan|hubungi|info lebih|cek detail)\b/i)[0];
  const name =
    kind === "transfer_in" || kind === "income" || kind === "topup_in"
      ? grabName(core, /\b(?:from|dari)\s+([^.,\n]+?)(?:\s+(?:via|ke|to|on|pada)\b|[.,]|$)/i)
      : grabName(core, /\b(?:at|to|di|ke|kepada|merchant)\s+([^.,\n]+?)(?:\s+(?:via|with|using|dengan|pakai|on|pada)\b|[.,]|$)/i);

  return {
    ok: true,
    parsed: {
      provider,
      kind,
      amount,
      fee: 0,
      merchant: kind === "expense" ? name : null,
      counterparty: kind === "expense" ? null : name,
      target: null,
      occurredAt: n.date,
      reference: null,
      last4: null,
      confidence: name ? "high" : "low",
      notes: ["Dari notifikasi HP."],
    },
  };
}
