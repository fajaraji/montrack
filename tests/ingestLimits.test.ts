import { describe, it, expect, beforeEach } from "vitest";
import { createApp, MAX_EMAILS_PER_REQUEST, type Bindings } from "../src/worker/app";
import { createTestDb, queryCounter } from "./testDb";
import type { DB } from "../src/worker/db/client";
import { inboxEmails } from "../src/worker/db/schema";
import { EMAILS } from "./fixtures";

const env: Bindings = {
  DATABASE_URL: "unused",
  APP_PASSWORD: "rahasia-sekali",
  SESSION_SECRET: "session-secret-yang-panjang",
  INGEST_SECRET: "ingest-secret-123",
};

let db: DB;
let app: ReturnType<typeof createApp>;

async function post(emails: { messageId: string; from: string; subject: string; body: string; date: string }[]) {
  const res = await app.request(
    "/api/ingest/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.INGEST_SECRET}` },
      body: JSON.stringify({ emails }),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as { results: { messageId: string; status: string }[] } };
}

const mk = (key: keyof typeof EMAILS, id: string) => ({ messageId: id, ...EMAILS[key], date: "2026-10-31T06:00:00Z" });

beforeEach(async () => {
  db = await createTestDb();
  app = createApp(() => db);
});

describe("batas subrequest Cloudflare", () => {
  it("satu kiriman maksimal memakai jauh di bawah 50 query, sisanya deferred", async () => {
    const emails = [
      mk("briTopupGopay", "a"), // transfer + biaya admin + akun baru x2
      mk("bsiPayment", "b"), //    pengeluaran + biaya
      mk("bniTransferOut", "c"),
      mk("danaPayment", "d"),
      mk("ovoPayment", "e"),
      mk("gopayQris", "f"),
    ];
    queryCounter.count = 0;
    const r = await post(emails);
    expect(r.status).toBe(200);
    // Kasus terburuk: semua akun & data referensi belum ada di cache.
    expect(queryCounter.count).toBeLessThanOrEqual(40);
    const statuses = r.json.results.map((x) => x.status);
    expect(statuses.slice(0, MAX_EMAILS_PER_REQUEST).every((s) => s === "parsed")).toBe(true);
    expect(statuses.slice(MAX_EMAILS_PER_REQUEST)).toEqual(["deferred", "deferred"]);

    // Yang deferred diterima di kiriman berikutnya.
    const again = await post(emails.slice(MAX_EMAILS_PER_REQUEST));
    expect(again.json.results.map((x) => x.status)).toEqual(["parsed", "parsed"]);
  });

  it("email yang dulu gagal di tengah proses diproses ulang, bukan dianggap duplikat", async () => {
    const e = mk("briQris", "crashed-1");
    // Simulasi: tersimpan di kotak masuk tapi proses terhenti (status unparsed, tanpa catatan).
    await db.insert(inboxEmails).values({ messageId: e.messageId, fromAddr: e.from, subject: e.subject, body: e.body, receivedAt: new Date(e.date) });
    const r = await post([e]);
    expect(r.json.results[0].status).toBe("parsed");
    // Kirim ulang lagi → kali ini memang duplikat.
    expect((await post([e])).json.results[0].status).toBe("duplicate");
  });
});

describe("impor mutasi hemat query", () => {
  it("300 baris tetap di bawah 50 query", async () => {
    const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: env.APP_PASSWORD }) }, env);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const acc = await app.request("/api/accounts", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "BRI", provider: "bri" }) }, env);
    const { id } = (await acc.json()) as { id: number };
    const rows = Array.from({ length: 300 }, (_, i) => ({
      date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
      description: i % 50 === 0 ? "TOPUP GOPAY" : `QRIS TOKO ${i % 7}`,
      amount: -(1000 + i),
    }));
    const send = async () => {
      queryCounter.count = 0;
      const r = await app.request("/api/import", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ accountId: id, rows }) }, env);
      return { json: (await r.json()) as { inserted: number; matched: number; skipped: number }, queries: queryCounter.count };
    };
    const first = await send();
    expect(first.json).toMatchObject({ inserted: 300, matched: 0, skipped: 0 });
    expect(first.queries).toBeLessThan(25);
    const second = await send();
    expect(second.json).toMatchObject({ inserted: 0, skipped: 300 });
    expect(second.queries).toBeLessThan(25);
  });
});
