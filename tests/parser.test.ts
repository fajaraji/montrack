import { describe, it, expect } from "vitest";
import { parseEmail, type ParsedEmail } from "../src/worker/parsers/email";
import { parseIndoDate } from "../src/worker/parsers/date";
import { parseRupiah } from "../src/shared/money";
import { wibParts } from "../src/shared/time";
import { EMAILS } from "./fixtures";

const date = new Date("2026-10-31T06:00:00Z");
function parse(e: { from: string; subject: string; body: string }): ParsedEmail {
  const r = parseEmail({ ...e, date });
  if (!r.ok) throw new Error(`expected ok, got ${r.status}: ${r.reason}`);
  return r.parsed;
}

describe("parseRupiah", () => {
  it.each([
    ["Rp 35.000", 35000],
    ["Rp1.250.000,00", 1250000],
    ["IDR 1,250,000.00", 1250000],
    ["Rp 25.000,-", 25000],
    ["35.00", 35],
    ["Rp100.000", 100000],
    ["9.500.000", 9500000],
    ["-Rp 10.000", 10000],
    ["Rp 0,00", 0],
  ])("%s → %s", (s, n) => {
    expect(parseRupiah(s)).toBe(n);
  });
});

describe("parseIndoDate", () => {
  it("format Indonesia lengkap", () => {
    const d = parseIndoDate("31 Oktober 2026, 12:41:07 WIB")!;
    expect(wibParts(d)).toMatchObject({ year: 2026, month: 10, day: 31, hour: 12, minute: 41 });
  });
  it("dd/mm/yyyy", () => {
    expect(wibParts(parseIndoDate("30/10/2026 08:15:20")!)).toMatchObject({ day: 30, month: 10, hour: 8 });
  });
  it("English month", () => {
    expect(wibParts(parseIndoDate("31 Oct 2026 10:05")!)).toMatchObject({ day: 31, hour: 10, minute: 5 });
  });
  it("WITA", () => {
    expect(wibParts(parseIndoDate("31 Okt 2026 10:00 WITA")!)).toMatchObject({ hour: 9 });
  });
});

describe("parseEmail", () => {
  it("BRI QRIS → pengeluaran dengan merchant", () => {
    const p = parse(EMAILS.briQris);
    expect(p).toMatchObject({ provider: "bri", kind: "expense", amount: 25000, fee: 0, merchant: "KOPI SENJA JAKARTA", last4: "4567", confidence: "high" });
    expect(p.reference).toBe("123456789012");
  });
  it("BRI top up GoPay (HTML) → topup_out dengan biaya admin", () => {
    const p = parse(EMAILS.briTopupGopay);
    expect(p).toMatchObject({ provider: "bri", kind: "topup_out", target: "gopay", amount: 100000, fee: 1000 });
  });
  it("GoPay menerima top-up → topup_in", () => {
    const p = parse(EMAILS.gopayTopupIn);
    expect(p).toMatchObject({ provider: "gopay", kind: "topup_in", amount: 100000 });
  });
  it("GoPay QRIS", () => {
    const p = parse(EMAILS.gopayQris);
    expect(p).toMatchObject({ provider: "gopay", kind: "expense", amount: 35000, merchant: "Sayur & Telur Bu Ani" });
    expect(wibParts(p.occurredAt)).toMatchObject({ day: 4, month: 10, hour: 7, minute: 12 });
  });
  it("BNI transfer keluar dengan biaya", () => {
    const p = parse(EMAILS.bniTransferOut);
    expect(p).toMatchObject({ provider: "bni", kind: "transfer_out", amount: 250000, fee: 2500, counterparty: "BUDI SANTOSO" });
  });
  it("BNI dana masuk", () => {
    const p = parse(EMAILS.bniTransferIn);
    expect(p).toMatchObject({ provider: "bni", kind: "transfer_in", amount: 9500000, counterparty: "PT MAJU JAYA" });
  });
  it("BSI bayar PLN: nominal + biaya dari total", () => {
    const p = parse(EMAILS.bsiPayment);
    expect(p).toMatchObject({ provider: "bsi", kind: "expense", amount: 200000, fee: 2500, merchant: "PLN PREPAID" });
  });
  it("DANA label tanpa titik dua", () => {
    const p = parse(EMAILS.danaPayment);
    expect(p).toMatchObject({ provider: "dana", kind: "expense", amount: 22000, merchant: "Nasi Goreng Pak Kumis" });
  });
  it("OVO bahasa Inggris", () => {
    const p = parse(EMAILS.ovoPayment);
    expect(p).toMatchObject({ provider: "ovo", kind: "expense", amount: 44500, merchant: "INDOMARET TEBET" });
  });
  it("ShopeePay refund → income", () => {
    const p = parse(EMAILS.shopeepayRefund);
    expect(p).toMatchObject({ provider: "shopeepay", kind: "income", amount: 59000 });
  });
  it("OTP, promo, dan transaksi gagal diabaikan", () => {
    for (const e of [EMAILS.otp, EMAILS.promo, EMAILS.failed]) {
      const r = parseEmail({ ...e, date });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe("ignored");
    }
  });
  it("pengirim tak dikenal → unparsed", () => {
    const r = parseEmail({ from: "x@example.com", subject: "Halo", body: "Rp 10.000", date });
    expect(r).toMatchObject({ ok: false, status: "unparsed" });
  });
});
