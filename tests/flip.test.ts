import { describe, it, expect, beforeEach } from "vitest";
import { createApp, type Bindings } from "../src/worker/app";
import { createTestDb } from "./testDb";
import type { DB } from "../src/worker/db/client";
import { FLIP, WONDR_TRANSFER } from "./fixtures";
import type { AccountDTO, MonthSummaryDTO, TransactionDTO } from "../src/shared/types";

const env: Bindings = { DATABASE_URL: "x", APP_PASSWORD: "rahasia-sekali", SESSION_SECRET: "session-secret-yang-panjang", INGEST_SECRET: "ingest-secret-123" };
let db: DB;
let app: ReturnType<typeof createApp>;
let cookie = "";
let n = 0;
const call = async <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json", cookie, ...headers }, body: body ? JSON.stringify(body) : undefined }, env);
  return { status: res.status, json: (await res.json()) as T };
};
const ingest = (e: { from: string; subject: string; body: string }, date: string) =>
  call<{ results: { status: string }[] }>("POST", "/ingest/email", { messageId: `m${n++}`, ...e, date }, { authorization: `Bearer ${env.INGEST_SECRET}` });
const toFlip = (amount: string) => {
  const e = WONDR_TRANSFER("FLIPTECH LENTERA INSPIRASI PERTIWI PT", "BNI • 1234567890", amount);
  return { ...e, body: e.body.replace("Metode\nBI-FAST", "Metode\nOnline").replace("Rp2.500", "Rp0").replace("Rp102.500", amount).replace(/Reference ID\n\d+/, `Reference ID\n${Date.now()}${n}`) };
};
const txs = async () => (await call<TransactionDTO[]>("GET", "/transactions")).json;

beforeEach(async () => {
  db = await createTestDb();
  app = createApp(() => db);
  const r = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: env.APP_PASSWORD }) }, env);
  cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  await call("PATCH", "/settings", { ownerNames: ["NAMA PEMILIK"] });
});

describe("Flip", () => {
  it("ke orang lain: transfer BNI→Flip jadi pengeluaran ke penerima asli + biaya kode unik", async () => {
    await ingest(toFlip("Rp495.475"), "2026-11-02T13:00:00Z");
    expect((await ingest(FLIP.success("ORANG LAIN", "Bank Jago Syariah", "Rp495.000"), "2026-11-02T14:10:00Z")).json.results[0].status).toBe("merged");
    const list = await txs();
    const main = list.find((t) => t.merchant === "ORANG LAIN")!;
    expect(main).toMatchObject({ type: "expense", amount: 495000, description: "via Flip ke Jago" });
    expect(list.find((t) => t.merchant === "Biaya Flip (kode unik)")?.amount).toBe(475);
    expect(list).toHaveLength(2);
  });

  it("ke rekening sendiri: jadi transfer BNI → Jago, saldo Jago bertambah", async () => {
    await ingest(toFlip("Rp1.000.337"), "2026-11-02T13:00:00Z");
    await ingest(FLIP.success("NAMA PEMILIK", "Bank Jago Syariah", "Rp1.000.000"), "2026-11-02T13:30:00Z");
    const t = (await txs()).find((x) => x.type === "transfer")!;
    const accs = (await call<AccountDTO[]>("GET", "/accounts")).json;
    expect(t).toMatchObject({ amount: 1000000, toAccountId: accs.find((a) => a.provider === "jago")!.id });
    expect(accs.find((a) => a.provider === "jago")!.balance).toBe(1000000);
    const s = (await call<MonthSummaryDTO>("GET", "/summary?month=2026-11")).json;
    expect(s.expense).toBe(337); // hanya biaya kode unik
  });

  it("email Flip datang lebih dulu → menunggu, lalu terpasang saat transfer BNI masuk", async () => {
    expect((await ingest(FLIP.success("ORANG LAIN", "BCA", "Rp200.000"), "2026-11-02T14:10:00Z")).json.results[0].status).toBe("unparsed");
    await ingest(toFlip("Rp200.123"), "2026-11-02T13:00:00Z");
    const list = await txs();
    expect(list.find((t) => t.merchant === "ORANG LAIN")).toMatchObject({ amount: 200000, description: "via Flip ke BCA" });
  });

  it("refund: transaksi asal & refund tidak dihitung, saldo kembali", async () => {
    await ingest(toFlip("Rp495.475"), "2026-11-02T13:00:00Z");
    await ingest(FLIP.refund("495475"), "2026-11-03T02:14:00Z");
    const s = (await call<MonthSummaryDTO>("GET", "/summary?month=2026-11")).json;
    expect(s.expense).toBe(0);
    expect(s.income).toBe(0);
    const bni = (await call<AccountDTO[]>("GET", "/accounts")).json.find((a) => a.provider === "bni")!;
    expect(bni.balance).toBe(0);
  });

  it("'Informasi transfer' dan email promo Jago diabaikan", async () => {
    expect((await ingest(FLIP.info, "2026-11-02T13:00:00Z")).json.results[0].status).toBe("ignored");
    const promo = { from: "Jago <hello@jago.com>", subject: "15K BONUS to grow your toy collection", body: "Get Rp15.000 bonus when you pay with Jago" };
    expect((await ingest(promo, "2026-11-02T13:00:00Z")).json.results[0].status).toBe("ignored");
    expect(await txs()).toHaveLength(0);
  });
});
