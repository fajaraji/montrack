import { describe, it, expect, beforeEach } from "vitest";
import { createApp, type Bindings } from "../src/worker/app";
import { createTestDb } from "./testDb";
import type { DB } from "../src/worker/db/client";
import { EMAILS } from "./fixtures";
import type { AccountDTO, CategoryDTO, MonthSummaryDTO, TransactionDTO } from "../src/shared/types";

const env: Bindings = {
  DATABASE_URL: "unused",
  APP_PASSWORD: "rahasia-sekali",
  SESSION_SECRET: "session-secret-yang-panjang",
  INGEST_SECRET: "ingest-secret-123",
};

let db: DB;
let app: ReturnType<typeof createApp>;
let cookie = "";

async function call<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(
    `/api${path}`,
    {
      method,
      headers: { "content-type": "application/json", cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  const json = (await res.json()) as T;
  return { status: res.status, json, res };
}

async function ingest(e: { from: string; subject: string; body: string }, id: string, date = "2026-10-31T06:00:00Z") {
  return call<{ results: { status: string; transactionIds: number[] }[] }>(
    "POST",
    "/ingest/email",
    { messageId: id, ...e, date },
    { authorization: `Bearer ${env.INGEST_SECRET}` },
  );
}

beforeEach(async () => {
  db = await createTestDb();
  app = createApp(() => db);
  cookie = "";
  const r = await call("POST", "/auth/login", { password: env.APP_PASSWORD });
  expect(r.status).toBe(200);
  cookie = (r.res.headers.get("set-cookie") ?? "").split(";")[0];
});

describe("auth", () => {
  it("menolak tanpa sesi & password salah", async () => {
    const saved = cookie;
    cookie = "";
    expect((await call("GET", "/summary")).status).toBe(401);
    expect((await call("POST", "/auth/login", { password: "salah" })).status).toBe(401);
    cookie = saved;
    expect((await call("GET", "/summary")).status).toBe(200);
  });
  it("ingest butuh secret", async () => {
    const r = await call("POST", "/ingest/email", { messageId: "x", ...EMAILS.briQris, date: "2026-10-31" }, { authorization: "Bearer salah" });
    expect(r.status).toBe(401);
  });
});

describe("alur email → ringkasan", () => {
  it("top-up BRI→GoPay digabung jadi satu transfer, tidak dihitung pengeluaran", async () => {
    const a = await ingest(EMAILS.briTopupGopay, "m1", "2026-10-30T01:16:00Z");
    expect(a.json.results[0].status).toBe("parsed");
    expect(a.json.results[0].transactionIds).toHaveLength(2); // transfer + biaya admin
    const b = await ingest(EMAILS.gopayTopupIn, "m2", "2026-10-30T01:16:30Z");
    expect(b.json.results[0].status).toBe("merged");
    // email yang sama dikirim ulang → duplikat
    expect((await ingest(EMAILS.gopayTopupIn, "m2")).json.results[0].status).toBe("duplicate");

    await ingest(EMAILS.briQris, "m3");
    await ingest(EMAILS.gopayQris, "m4", "2026-10-04T00:13:00Z");
    await ingest(EMAILS.otp, "m5");

    const txs = (await call<TransactionDTO[]>("GET", "/transactions?month=2026-10")).json;
    const transfers = txs.filter((t) => t.type === "transfer");
    expect(transfers).toHaveLength(1);
    const accs = (await call<AccountDTO[]>("GET", "/accounts")).json;
    const bri = accs.find((x) => x.provider === "bri")!;
    const gopay = accs.find((x) => x.provider === "gopay")!;
    expect(transfers[0]).toMatchObject({ accountId: bri.id, toAccountId: gopay.id, amount: 100000 });

    const s = (await call<MonthSummaryDTO>("GET", "/summary?month=2026-10")).json;
    // 1.000 biaya admin + 25.000 kopi + 35.000 sayur. Top-up 100.000 TIDAK masuk pengeluaran.
    expect(s.expense).toBe(61000);
    expect(s.transferTotal).toBe(100000);
    expect(bri.balance).toBe(-126000);
    expect(gopay.balance).toBe(100000 - 35000);

    const cats = (await call<CategoryDTO[]>("GET", "/categories")).json;
    const kopi = txs.find((t) => t.merchant === "KOPI SENJA JAKARTA")!;
    expect(cats.find((c) => c.id === kopi.categoryId)?.name).toBe("Kopi & Jajan");
  });

  it("transfer ke nama sendiri dicatat sebagai transfer, ke orang lain sebagai pengeluaran perlu ditinjau", async () => {
    await call("PATCH", "/settings", { ownerNames: ["Budi Santoso"] });
    await ingest(EMAILS.bniTransferOut, "t1");
    let txs = (await call<TransactionDTO[]>("GET", "/transactions")).json;
    expect(txs.find((t) => t.amount === 250000)?.type).toBe("transfer");

    db = await createTestDb();
    await ingest(EMAILS.bniTransferOut, "t1");
    txs = (await call<TransactionDTO[]>("GET", "/transactions")).json;
    expect(txs.find((t) => t.amount === 250000)).toMatchObject({ type: "expense", status: "review" });
  });
});

describe("kategori belajar dari koreksi", () => {
  it("ganti kategori + ingat → aturan baru & transaksi serupa ikut", async () => {
    const accs = await call<{ id: number }>("POST", "/accounts", { name: "Tunai", provider: "cash", kind: "cash" });
    const accountId = accs.json.id;
    const mk = (merchant: string) =>
      call<{ transaction: TransactionDTO }>("POST", "/transactions", {
        type: "expense", amount: 15000, accountId, merchant, occurredAt: "2026-10-10T05:00:00Z",
      });
    const a = (await mk("QRIS WARKOP MBAK SRI 0099")).json.transaction;
    const b = (await mk("WARKOP MBAK SRI")).json.transaction;
    expect(a.categoryId).toBeNull();
    const cats = (await call<CategoryDTO[]>("GET", "/categories")).json;
    const makan = cats.find((c) => c.name === "Makan & Minum")!;
    const r = await call<{ learned: number; pattern: string }>("PATCH", `/transactions/${a.id}`, { categoryId: makan.id, remember: true });
    expect(r.json.pattern).toBe("warkop mbak sri");
    expect(r.json.learned).toBe(1);
    const after = (await call<TransactionDTO[]>("GET", "/transactions")).json;
    expect(after.find((t) => t.id === b.id)?.categoryId).toBe(makan.id);
    // email baru dari merchant yang sama otomatis berkategori
    await ingest({ ...EMAILS.danaPayment, body: EMAILS.danaPayment.body.replace("Nasi Goreng Pak Kumis", "Warkop Mbak Sri") }, "d1");
    const fromEmail = (await call<TransactionDTO[]>("GET", "/transactions?q=Warkop%20Mbak%20Sri")).json.find((t) => t.source === "email");
    expect(fromEmail?.categoryId).toBe(makan.id);
  });
});

describe("saldo & penyesuaian", () => {
  it("penyesuaian saldo tidak mengubah pengeluaran bulanan", async () => {
    const acc = (await call<{ id: number }>("POST", "/accounts", { name: "BRI", provider: "bri", kind: "bank", openingBalance: 1000000 })).json;
    await call("POST", "/transactions", { type: "expense", amount: 200000, accountId: acc.id, merchant: "Indomaret", occurredAt: new Date().toISOString() });
    const adj = await call<{ delta: number }>("POST", `/accounts/${acc.id}/adjust`, { actualBalance: 750000 });
    expect(adj.json.delta).toBe(-50000);
    const accs = (await call<AccountDTO[]>("GET", "/accounts")).json;
    expect(accs[0].balance).toBe(750000);
    const s = (await call<MonthSummaryDTO>("GET", "/summary")).json;
    expect(s.expense).toBe(200000);
  });
  it("validasi input", async () => {
    expect((await call("POST", "/transactions", { type: "expense", amount: -5, accountId: 1, occurredAt: "2026-10-01" })).status).toBe(400);
    expect((await call("POST", "/transactions", { type: "nope", amount: 5 })).status).toBe(400);
  });
});

describe("impor mutasi", () => {
  it("mencocokkan transaksi email, menambah biaya admin, impor ulang tidak dobel", async () => {
    await ingest(EMAILS.briQris, "q1"); // 31 Okt, 25.000
    const bri = (await call<AccountDTO[]>("GET", "/accounts")).json.find((a) => a.provider === "bri")!;
    const rows = [
      { date: "2026-10-31", description: "QRIS KOPI SENJA JAKARTA", amount: -25000 },
      { date: "2026-10-31", description: "BIAYA ADM BULANAN", amount: -12500 },
      { date: "2026-10-28", description: "TOPUP GOPAY 0812xxxx", amount: -50000 },
      { date: "2026-10-25", description: "BUNGA", amount: 1234 },
    ];
    const r = await call<{ inserted: number; matched: number; skipped: number }>("POST", "/import", { accountId: bri.id, rows });
    expect(r.json).toMatchObject({ matched: 1, inserted: 3, skipped: 0 });
    const again = await call<{ inserted: number; matched: number; skipped: number }>("POST", "/import", { accountId: bri.id, rows });
    expect(again.json).toMatchObject({ matched: 0, inserted: 0, skipped: 4 });

    const txs = (await call<TransactionDTO[]>("GET", "/transactions?month=2026-10")).json;
    const cats = (await call<CategoryDTO[]>("GET", "/categories")).json;
    const adm = txs.find((t) => t.description === "BIAYA ADM BULANAN")!;
    expect(cats.find((c) => c.id === adm.categoryId)?.name).toBe("Biaya Bank & Admin");
    expect(txs.find((t) => t.description?.startsWith("TOPUP GOPAY"))?.type).toBe("transfer");
    const s = (await call<MonthSummaryDTO>("GET", "/summary?month=2026-10")).json;
    expect(s.expense).toBe(25000 + 12500);
    expect(s.income).toBe(1234);
  });
});

describe("salah pilih kategori: batalkan & koreksi", () => {
  async function setup() {
    const acc = (await call<{ id: number }>("POST", "/accounts", { name: "BNI", provider: "bni" })).json.id;
    const mk = async (merchant: string) =>
      (await call<{ transaction: TransactionDTO }>("POST", "/transactions", {
        type: "expense", amount: 15000, accountId: acc, merchant, occurredAt: "2026-10-10T05:00:00Z", status: "review",
      })).json.transaction;
    const cats = (await call<CategoryDTO[]>("GET", "/categories")).json;
    return {
      a: await mk("WARKOP BU TINI 01"), b: await mk("WARKOP BU TINI"), c: await mk("WARKOP BU TINI CABANG"),
      lainnya: cats.find((x) => x.name === "Lainnya")!, makan: cats.find((x) => x.name === "Makan & Minum")!,
    };
  }
  const byId = async () => new Map((await call<TransactionDTO[]>("GET", "/transactions")).json.map((t) => [t.id, t]));

  it("Batalkan mengembalikan transaksi, transaksi serupa, dan menghapus aturan yang baru dipelajari", async () => {
    const { a, b, c, lainnya } = await setup();
    const r = await call<{ learned: number; undo: unknown }>("PATCH", `/transactions/${a.id}`, { categoryId: lainnya.id, status: "ok", remember: true });
    expect(r.json.learned).toBe(2);
    expect((await call<{ pattern: string }[]>("GET", "/rules")).json.some((x) => x.pattern === "warkop bu tini")).toBe(true);

    await call("POST", "/undo", r.json.undo);
    const m = await byId();
    for (const t of [a, b, c]) expect(m.get(t.id)).toMatchObject({ categoryId: null });
    expect(m.get(a.id)?.status).toBe("review");
    expect((await call<{ pattern: string }[]>("GET", "/rules")).json.some((x) => x.pattern === "warkop bu tini")).toBe(false);
  });

  it("koreksi kategori + ingat ikut memperbaiki transaksi yang dulu kena aturan salah", async () => {
    const { a, b, c, lainnya, makan } = await setup();
    await call("PATCH", `/transactions/${a.id}`, { categoryId: lainnya.id, remember: true });
    // Sadar salah → ubah salah satunya ke Makan & Minum dengan "ingat"
    const r = await call<{ learned: number }>("PATCH", `/transactions/${b.id}`, { categoryId: makan.id, remember: true });
    expect(r.json.learned).toBe(2);
    const m = await byId();
    for (const t of [a, b, c]) expect(m.get(t.id)?.categoryId).toBe(makan.id);
  });

  it("kategori baru bisa dibuat dan dipakai", async () => {
    const c = (await call<CategoryDTO>("POST", "/categories", { name: "Kursus", icon: "🎓", kind: "expense" })).json;
    const ren = await call<CategoryDTO>("PATCH", `/categories/${c.id}`, { name: "Kursus & AI", icon: "🤖" });
    expect(ren.json).toMatchObject({ name: "Kursus & AI", icon: "🤖" });
  });
});
