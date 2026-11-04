import { describe, it, expect, beforeEach } from "vitest";
import { parseNotification } from "../src/worker/parsers/notification";
import { parseEmail } from "../src/worker/parsers/email";
import { createApp, type Bindings } from "../src/worker/app";
import { createTestDb } from "./testDb";
import type { DB } from "../src/worker/db/client";
import { JAGO_NOTIF, WONDR_TRANSFER } from "./fixtures";
import type { AccountDTO, TransactionDTO } from "../src/shared/types";

const date = new Date("2026-11-02T13:50:00Z");

describe("parser notifikasi (longgar)", () => {
  it("Jago bayar: nominal & arah terbaca, tanpa merchant → ragu (masuk Tinjau)", () => {
    const r = parseNotification({ ...JAGO_NOTIF.paid, date });
    expect(r).toMatchObject({ ok: true, parsed: { provider: "jago", kind: "expense", amount: 20000, merchant: null, confidence: "low" } });
  });
  it("Jago terima dana", () => {
    const r = parseNotification({ ...JAGO_NOTIF.received, date });
    expect(r).toMatchObject({ ok: true, parsed: { provider: "jago", kind: "transfer_in", amount: 100000, counterparty: "NAMA PEMILIK" } });
  });
  it("bahasa Indonesia & merchant dari kata 'di'", () => {
    const r = parseNotification({ app: "DANA", title: "Pembayaran berhasil", text: "Kamu bayar Rp15.500 di Kopi Kenangan.", date });
    expect(r).toMatchObject({ ok: true, parsed: { provider: "dana", kind: "expense", amount: 15500, merchant: "Kopi Kenangan", confidence: "high" } });
  });
  it("format berubah tetap tertangkap selama ada Rp dan kata kunci", () => {
    const r = parseNotification({ app: "Jago", title: "Transaksi", text: "Payment of Rp 9.000 completed using your GoPay Tabungan", date });
    expect(r).toMatchObject({ ok: true, parsed: { kind: "expense", amount: 9000 } });
  });
  it("OTP/promo/tanpa nominal diabaikan", () => {
    for (const text of ["Kode OTP kamu 123456", "Promo diskon 50% hari ini!", "Selamat datang di Jago"]) {
      const r = parseNotification({ app: "Jago", title: "Jago", text, date });
      expect(r.ok).toBe(false);
    }
  });
});

describe("email transfer BNI: bank tujuan", () => {
  it("membaca bank tujuan dari baris 'NAMA BANK • nomor'", () => {
    for (const [line, bank] of [["JAGO SYARIAH • 123456789012", "jago"], ["BANK BSI • 7123456789", "bsi"], ["BCA • 1234567890", "bca"]]) {
      const r = parseEmail({ ...WONDR_TRANSFER("NAMA PEMILIK", line), date });
      expect(r.ok && r.parsed.targetBank).toBe(bank);
    }
  });
});

const env: Bindings = { DATABASE_URL: "x", APP_PASSWORD: "rahasia-sekali", SESSION_SECRET: "session-secret-yang-panjang", INGEST_SECRET: "ingest-secret-123" };
let db: DB;
let app: ReturnType<typeof createApp>;
let cookie = "";
const call = async <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json", cookie, ...headers }, body: body ? JSON.stringify(body) : undefined }, env);
  return { status: res.status, json: (await res.json()) as T };
};
const auth = { authorization: `Bearer ${env.INGEST_SECRET}` };

beforeEach(async () => {
  db = await createTestDb();
  app = createApp(() => db);
  const r = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: env.APP_PASSWORD }) }, env);
  cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  await call("PATCH", "/settings", { ownerNames: ["NAMA PEMILIK"] });
});

describe("alur notifikasi + email", () => {
  it("transfer BNI → Jago atas nama sendiri: satu transfer, saldo Jago naik, notifikasi Jago tidak dobel", async () => {
    await call("POST", "/ingest/email", { messageId: "t1", ...WONDR_TRANSFER("NAMA PEMILIK", "JAGO SYARIAH • 123456789012"), date: date.toISOString() }, auth);
    const n = await call<{ results: { status: string }[] }>("POST", "/ingest/notification", { ...JAGO_NOTIF.received, time: date.getTime() + 60_000 }, auth);
    expect(n.json.results[0].status).toBe("duplicate");
    const txs = (await call<TransactionDTO[]>("GET", "/transactions")).json;
    const transfers = txs.filter((t) => t.type === "transfer");
    expect(transfers).toHaveLength(1);
    const accs = (await call<AccountDTO[]>("GET", "/accounts")).json;
    const jago = accs.find((a) => a.provider === "jago")!;
    expect(transfers[0].toAccountId).toBe(jago.id);
    expect(jago.balance).toBe(100000);
    // tidak ada pengeluaran selain biaya admin
    expect(txs.filter((t) => t.type === "expense").map((t) => t.amount)).toEqual([2500]);
  });

  it("notifikasi bayar Jago tercatat dan masuk Tinjau; dikirim ulang tidak dobel", async () => {
    const body = { ...JAGO_NOTIF.paid, time: date.getTime() };
    expect((await call<{ results: { status: string }[] }>("POST", "/ingest/notification", body, auth)).json.results[0].status).toBe("parsed");
    expect((await call<{ results: { status: string }[] }>("POST", "/ingest/notification", body, auth)).json.results[0].status).toBe("duplicate");
    const txs = (await call<TransactionDTO[]>("GET", "/transactions")).json;
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: "expense", amount: 20000, source: "notification", status: "review" });
  });

  it("notifikasi tanpa secret ditolak", async () => {
    expect((await call("POST", "/ingest/notification", JAGO_NOTIF.paid)).status).toBe(401);
  });
});
