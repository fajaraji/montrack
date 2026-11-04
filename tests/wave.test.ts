import { describe, it, expect, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";
import { createApp, type Bindings } from "../src/worker/app";
import { createTestDb } from "./testDb";
import type { DB } from "../src/worker/db/client";
import { EMAILS } from "./fixtures";
import { dailyChecks, vapidJwt, weeklyRecapNotification } from "../src/worker/services/push";
import { detectRecurring } from "../src/worker/services/recurring";
import { fromWib } from "../src/shared/time";
import type {
  CategoryDTO, ChecklistLike, GoalDTO, MonthSummaryDTO, ReportsDTO, ReviewItemDTO, TransactionDTO,
} from "./types";

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
  const res = await app.request(`/api${path}`, { method, headers: { "content-type": "application/json", cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const text = await res.text();
  let json: T;
  try { json = JSON.parse(text) as T; } catch { json = text as unknown as T; }
  return { status: res.status, json, res };
}

let accountId = 0;
let cats: CategoryDTO[] = [];
const cat = (n: string) => cats.find((c) => c.name === n)!.id;
async function tx(merchant: string, amount: number, at: string, extra: Record<string, unknown> = {}) {
  return (await call<{ transaction: TransactionDTO }>("POST", "/transactions", { type: "expense", amount, accountId, merchant, occurredAt: at, ...extra })).json.transaction;
}

beforeEach(async () => {
  db = await createTestDb();
  app = createApp(() => db);
  cookie = "";
  const r = await call("POST", "/auth/login", { password: env.APP_PASSWORD });
  cookie = (r.res.headers.get("set-cookie") ?? "").split(";")[0];
  accountId = (await call<{ id: number }>("POST", "/accounts", { name: "BNI", provider: "bni" })).json.id;
  cats = (await call<CategoryDTO[]>("GET", "/categories")).json;
});

describe("sesi", () => {
  it("cookie sesi berlaku 180 hari", async () => {
    const r = await call("POST", "/auth/login", { password: env.APP_PASSWORD });
    expect(r.res.headers.get("set-cookie")).toMatch(/Max-Age=15552000/);
  });
});

describe("tinjau massal & saran", () => {
  it("saran kategori dari riwayat merchant serupa", async () => {
    await tx("WARTEG KHARISMA BAHARI", 15000, "2026-10-01T05:00:00Z", { categoryId: cat("Makan & Minum") });
    await tx("WARTEG KHARISMA BAHARI CABANG 2", 16000, "2026-10-05T05:00:00Z", { status: "review" });
    const list = (await call<ReviewItemDTO[]>("GET", "/review")).json;
    expect(list).toHaveLength(1);
    expect(list[0].suggestions[0]).toBe(cat("Makan & Minum"));
    expect(list[0].suggestions).toHaveLength(3);
  });
  it("kategori massal + ingat, lalu batalkan semuanya", async () => {
    const a = await tx("TOKO ALFA SATU", 1000, "2026-10-01T05:00:00Z", { status: "review" });
    const b = await tx("TOKO BETA DUA", 2000, "2026-10-01T05:00:00Z", { status: "review" });
    const c = await tx("TOKO ALFA SATU", 3000, "2026-10-02T05:00:00Z", { status: "review" });
    const r = await call<{ undo: unknown; learned: number }>("POST", "/transactions/bulk", { ids: [a.id, b.id], categoryId: cat("Lainnya"), remember: true });
    expect(r.json.learned).toBe(1); // c ikut lewat aturan "toko alfa satu"
    expect((await call<ReviewItemDTO[]>("GET", "/review")).json).toHaveLength(0);
    await call("POST", "/undo", r.json.undo);
    const after = (await call<ReviewItemDTO[]>("GET", "/review")).json;
    expect(after.map((x) => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect((await call<{ pattern: string }[]>("GET", "/rules")).json.some((x) => x.pattern === "toko alfa satu")).toBe(false);
  });
});

describe("ganti nama merchant", () => {
  it("menerapkan ke transaksi lama dan email baru, bisa dihapus", async () => {
    const old = await tx("9XY9 MPM ALFAMART IR H DJ", 11300, "2026-10-01T05:00:00Z");
    const r = await call<{ pattern: string; applied: number }>("POST", "/renames", { raw: old.merchant, name: "Alfamart" });
    expect(r.json).toMatchObject({ pattern: "alfamart ir h dj", applied: 1 });
    const list = (await call<TransactionDTO[]>("GET", "/transactions")).json;
    expect(list[0]).toMatchObject({ merchant: "Alfamart", rawMerchant: "9XY9 MPM ALFAMART IR H DJ" });
    const body = EMAILS.briQris.body.replace("KOPI SENJA JAKARTA", "8ZZ8 MPM ALFAMART IR H DJ");
    await call("POST", "/ingest/email", { messageId: "x1", ...EMAILS.briQris, body, date: "2026-10-31T06:00:00Z" }, { authorization: `Bearer ${env.INGEST_SECRET}` });
    const fromEmail = (await call<TransactionDTO[]>("GET", "/transactions")).json.find((t) => t.source === "email")!;
    expect(fromEmail.merchant).toBe("Alfamart");
    const renames = (await call<{ id: number }[]>("GET", "/renames")).json;
    await call("DELETE", `/renames/${renames[0].id}`);
    const restored = (await call<TransactionDTO[]>("GET", "/transactions")).json.find((t) => t.id === old.id)!;
    expect(restored.merchant).toBe("9XY9 MPM ALFAMART IR H DJ");
  });
});

describe("abaikan dari laporan, ekspor, checklist", () => {
  it("transaksi diabaikan tidak masuk pengeluaran tapi tetap di saldo", async () => {
    const now = new Date().toISOString();
    await tx("Makan siang", 50000, now);
    const reimburse = await tx("Hotel dinas kantor", 900000, now);
    await call("PATCH", `/transactions/${reimburse.id}`, { excluded: true });
    const s = (await call<MonthSummaryDTO>("GET", "/summary")).json;
    expect(s.expense).toBe(50000);
    const acc = (await call<{ balance: number }[]>("GET", "/accounts")).json[0];
    expect(acc.balance).toBe(-950000);
  });
  it("ekspor CSV berisi semua transaksi", async () => {
    await tx('Toko "Kutip", Koma', 12345, "2026-10-01T05:00:00Z", { categoryId: cat("Belanja Harian") });
    const r = await call<string>("GET", "/export.csv");
    expect(r.res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(r.json).toContain("Tanggal,Jam,Jenis,Nominal");
    expect(r.json).toContain('"Toko ""Kutip"", Koma"');
    expect(r.json).toContain("-12345");
    expect(r.json).toContain("Belanja Harian");
  });
  it("checklist mendeteksi langkah yang sudah selesai", async () => {
    let c = (await call<ChecklistLike>("GET", "/checklist")).json;
    expect(c.items.find((i) => i.id === "owner")!.done).toBe(false);
    await call("PATCH", "/settings", { ownerNames: ["Budi"] });
    await call("POST", `/accounts/${accountId}/adjust`, { actualBalance: 100000 });
    await call("PATCH", `/categories/${cat("Makan & Minum")}`, { monthlyBudget: 1500000 });
    c = (await call<ChecklistLike>("GET", "/checklist")).json;
    for (const id of ["owner", "balance", "budget"]) expect(c.items.find((i) => i.id === id)!.done).toBe(true);
    await call("PATCH", "/settings", { checklistDismissed: true });
    expect((await call<ChecklistLike>("GET", "/checklist")).json.dismissed).toBe(true);
  });
});

describe("laporan, tagihan rutin, bagi transaksi, target", () => {
  it("laporan 6 bulan dan merchant terbesar", async () => {
    await tx("Kopi A", 20000, "2026-09-10T05:00:00Z", { categoryId: cat("Kopi & Jajan") });
    await tx("Kopi A", 30000, "2026-10-10T05:00:00Z", { categoryId: cat("Kopi & Jajan") });
    await tx("Kopi A", 10000, "2026-10-11T05:00:00Z", { categoryId: cat("Kopi & Jajan") });
    const r = (await call<ReportsDTO>("GET", "/reports?month=2026-10")).json;
    expect(r.trend.map((t) => t.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(r.trend[5].expense).toBe(40000);
    expect(r.topMerchants[0]).toMatchObject({ name: "Kopi A", total: 40000, count: 2 });
    const k = r.categories.find((x) => x.categoryId === cat("Kopi & Jajan"))!;
    expect(k.current).toBe(40000);
    expect(k.average).toBe(4000); // 20.000 / 5 bulan penuh
  });
  it("mendeteksi langganan bulanan", async () => {
    for (const m of [7, 8, 9, 10]) await tx("NETFLIX.COM", 54000, fromWib(2026, m, 5, 9).toISOString());
    await tx("Warung acak", 54000, "2026-10-06T05:00:00Z");
    const list = await detectRecurring(db, fromWib(2026, 10, 20));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "NETFLIX.COM", amount: 54000, nextDate: "2026-11-05", occurrences: 4 });
  });
  it("bagi transaksi lalu gabungkan kembali", async () => {
    const t = await tx("INDOMARET", 100000, "2026-10-10T05:00:00Z");
    const parts = [{ amount: 60000, categoryId: cat("Belanja Harian") }, { amount: 40000, categoryId: cat("Rumah Tangga") }];
    expect((await call("POST", `/transactions/${t.id}/split`, { parts: [{ amount: 1, categoryId: null }, { amount: 2, categoryId: null }] })).status).toBe(400);
    const r = await call<TransactionDTO[]>("POST", `/transactions/${t.id}/split`, { parts });
    expect(r.json.map((x) => x.amount)).toEqual([60000, 40000]);
    const s = (await call<MonthSummaryDTO>("GET", "/summary?month=2026-10")).json;
    expect(s.expense).toBe(100000);
    expect(s.byCategory).toHaveLength(2);
    const back = await call<TransactionDTO>("POST", `/transactions/${t.id}/unsplit`);
    expect(back.json).toMatchObject({ amount: 100000, splitGroupId: null });
    expect((await call<TransactionDTO[]>("GET", "/transactions")).json).toHaveLength(1);
  });
  it("target tabungan: setoran manual & akun tertaut", async () => {
    const g = (await call<{ id: number }>("POST", "/goals", { name: "Dana darurat", target: 1000000, deadline: "2027-12-31" })).json;
    await call("POST", `/goals/${g.id}/deposit`, { amount: 250000 });
    const tab = (await call<{ id: number }>("POST", "/accounts", { name: "Tabungan", provider: "bni", openingBalance: 400000 })).json;
    await call("POST", "/goals", { name: "Liburan", target: 800000, accountId: tab.id });
    const list = (await call<GoalDTO[]>("GET", "/goals")).json;
    expect(list[0]).toMatchObject({ progress: 250000, pct: 25 });
    expect(list[0].perMonth).toBeGreaterThan(0);
    expect(list[1]).toMatchObject({ progress: 400000, pct: 50, accountName: "Tabungan" });
  });
});

describe("notifikasi", () => {
  it("peringatan anggaran 80% & 100% sekali saja", async () => {
    await call("PATCH", `/categories/${cat("Makan & Minum")}`, { monthlyBudget: 100000 });
    await tx("Makan", 85000, new Date().toISOString(), { categoryId: cat("Makan & Minum") });
    expect(await dailyChecks(db)).toBe(1);
    expect(await dailyChecks(db)).toBe(0);
    await tx("Makan lagi", 20000, new Date().toISOString(), { categoryId: cat("Makan & Minum") });
    expect(await dailyChecks(db)).toBe(1);
    const n = (await call<{ unread: number; items: { title: string }[] }>("GET", "/notifications")).json;
    expect(n.unread).toBe(2);
    expect(n.items[0].title).toMatch(/terlewati/);
    await call("POST", "/notifications/read-all");
    expect((await call<{ unread: number }>("GET", "/notifications")).json.unread).toBe(0);
  });
  it("rekap mingguan", async () => {
    const now = fromWib(2026, 11, 2, 8); // Senin
    await tx("Belanja", 70000, fromWib(2026, 10, 28, 12).toISOString());
    expect(await weeklyRecapNotification(db, now)).toBe(true);
    expect(await weeklyRecapNotification(db, now)).toBe(false);
  });
  it("JWT VAPID ditandatangani ES256 yang valid", async () => {
    const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
    const d = (await webcrypto.subtle.exportKey("jwk", pair.privateKey)).d!;
    const jwt = await vapidJwt({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: d, APP_URL: "https://x.workers.dev" }, "https://fcm.googleapis.com");
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://x.workers.dev" });
    const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });
});
