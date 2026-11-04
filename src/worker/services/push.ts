import { desc, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { categories, notifications, pushSubscriptions } from "../db/schema";
import { monthSummary } from "./summary";
import { detectRecurring } from "./recurring";
import { weekStartWib, weeklyRecap } from "./reports";
import { formatRupiah } from "../../shared/money";
import { MONTHS_ID, parseYm, wibDateKey, wibParts } from "../../shared/time";

export interface PushEnv {
  VAPID_PUBLIC_KEY?: string; // base64url, titik P-256 tak terkompresi (65 byte)
  VAPID_PRIVATE_KEY?: string; // base64url, skalar d (32 byte)
  APP_URL?: string;
}

const b64u = {
  encode(bytes: ArrayBuffer | Uint8Array): string {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(s: string): Uint8Array {
    const t = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  },
};

/** JWT VAPID (ES256) untuk satu push service. */
export async function vapidJwt(env: PushEnv, audience: string, now = Date.now()): Promise<string> {
  const pub = b64u.decode(env.VAPID_PUBLIC_KEY!);
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const enc = (o: unknown) => b64u.encode(new TextEncoder().encode(JSON.stringify(o)));
  const head = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.APP_URL || "mailto:noreply@montrack.invalid" })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head));
  return `${head}.${b64u.encode(sig)}`;
}

/** Kirim "colekan" tanpa isi; service worker mengambil isi notifikasi terbaru dari API. */
export async function pokeAll(db: DB, env: PushEnv): Promise<{ sent: number; removed: number }> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { sent: 0, removed: 0 };
  const subs = await db.select().from(pushSubscriptions).limit(10);
  let sent = 0;
  let removed = 0;
  for (const s of subs) {
    try {
      const aud = new URL(s.endpoint).origin;
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: { TTL: "86400", Urgency: "normal", Authorization: `vapid t=${await vapidJwt(env, aud)}, k=${env.VAPID_PUBLIC_KEY}`, "Content-Length": "0" },
      });
      if (res.status === 404 || res.status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        removed++;
      } else if (res.ok) sent++;
    } catch {
      /* jaringan push service gagal: coba lagi di jadwal berikutnya */
    }
  }
  return { sent, removed };
}

/** Buat notifikasi (sekali saja per dedupeKey). Mengembalikan true bila baru. */
export async function notify(
  db: DB,
  n: { kind: string; dedupeKey: string; title: string; body: string; url?: string },
): Promise<boolean> {
  const rows = await db
    .insert(notifications)
    .values({ kind: n.kind, dedupeKey: n.dedupeKey, title: n.title, body: n.body, url: n.url ?? "/" })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function latestNotifications(db: DB, limit = 30) {
  return db.select().from(notifications).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit);
}

export async function unreadCount(db: DB): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(eq(notifications.read, false));
  return Number(r?.n ?? 0);
}

/** Harian (malam): peringatan anggaran 80%/100% dan tagihan rutin besok. */
export async function dailyChecks(db: DB, now = new Date()): Promise<number> {
  let created = 0;
  const ym = parseYm(null, now);
  const ymKey = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
  const s = await monthSummary(db, ym, now);
  const cats = await db.select().from(categories);
  const spent = new Map(s.byCategory.map((g) => [g.categoryId, g.total]));
  const checks: { key: string; name: string; budget: number; used: number; url: string }[] = [];
  if (s.budget) checks.push({ key: "total", name: "Total pengeluaran", budget: s.budget, used: s.expense, url: "/" });
  for (const c of cats) {
    if (!c.monthlyBudget || c.archived) continue;
    checks.push({ key: `cat${c.id}`, name: `${c.icon} ${c.name}`, budget: c.monthlyBudget, used: spent.get(c.id) ?? 0, url: "/anggaran" });
  }
  for (const ch of checks) {
    const pct = ch.used / ch.budget;
    const level = pct >= 1 ? 100 : pct >= 0.8 ? 80 : 0;
    if (!level) continue;
    const ok = await notify(db, {
      kind: "budget",
      dedupeKey: `budget:${ymKey}:${ch.key}:${level}`,
      title: level === 100 ? `Anggaran terlewati: ${ch.name}` : `Anggaran hampir habis: ${ch.name}`,
      body:
        level === 100
          ? `Sudah ${formatRupiah(ch.used)} dari ${formatRupiah(ch.budget)} (${MONTHS_ID[ym.month - 1]}).`
          : `Sudah ${Math.round(pct * 100)}% (${formatRupiah(ch.used)} dari ${formatRupiah(ch.budget)}). Sisa ${formatRupiah(ch.budget - ch.used)}.`,
      url: ch.url,
    });
    if (ok) created++;
  }
  const tomorrow = wibDateKey(new Date(now.getTime() + 86400_000));
  for (const r of await detectRecurring(db, now)) {
    if (r.nextDate !== tomorrow) continue;
    if (await notify(db, { kind: "bill", dedupeKey: `bill:${r.key}:${r.nextDate}`, title: `Tagihan besok: ${r.name}`, body: `Biasanya ${formatRupiah(r.amount)}.`, url: "/laporan" }))
      created++;
  }
  return created;
}

/** Senin pagi: rekap minggu lalu. */
export async function weeklyRecapNotification(db: DB, now = new Date()): Promise<boolean> {
  const thisWeek = weekStartWib(now);
  const last = new Date(thisWeek.getTime() - 7 * 86400_000);
  const r = await weeklyRecap(db, last);
  if (!r.count) return false;
  const diff = r.total - r.prevTotal;
  const cmp = r.prevTotal === 0 ? "" : diff > 0 ? ` (${formatRupiah(diff)} lebih banyak dari minggu sebelumnya)` : diff < 0 ? ` (${formatRupiah(-diff)} lebih hemat)` : "";
  const p = wibParts(last);
  return notify(db, {
    kind: "recap",
    dedupeKey: `recap:${r.weekStart}`,
    title: "Rekap minggu lalu",
    body: `Keluar ${formatRupiah(r.total)} dari ${r.count} transaksi${cmp}.`,
    url: `/laporan?week=${r.weekStart}&m=${p.year}`,
  });
}
