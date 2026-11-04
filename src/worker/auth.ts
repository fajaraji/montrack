import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import type { AppEnv } from "./app";

export const SESSION_COOKIE = "mt_session";
/** Sesi diperpanjang otomatis setiap dipakai; hanya kedaluwarsa bila tidak dibuka selama ini. */
const SESSION_DAYS = 180;
const RENEW_AFTER_SECONDS = 24 * 3600;

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Perbandingan waktu-konstan (melalui hash agar panjang selalu sama). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function requireSecret(v: string | undefined, name: string): string {
  if (!v || v.length < 8) throw new Error(`${name} belum di-set (minimal 8 karakter).`);
  return v;
}

export async function login(c: Context<AppEnv>, password: string): Promise<boolean> {
  const expected = requireSecret(c.env.APP_PASSWORD, "APP_PASSWORD");
  const secret = requireSecret(c.env.SESSION_SECRET, "SESSION_SECRET");
  if (!(await safeEqual(password, expected))) return false;
  await issueSession(c, secret);
  return true;
}

async function issueSession(c: Context<AppEnv>, secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign({ sub: "owner", iat: now, exp: now + SESSION_DAYS * 86400 }, secret, "HS256");
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export function logout(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

export async function isLoggedIn(c: Context<AppEnv>): Promise<boolean> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !c.env.SESSION_SECRET) return false;
  try {
    const payload = await verify(token, c.env.SESSION_SECRET, "HS256");
    // Perpanjang otomatis (maks. sekali sehari) agar tidak perlu login ulang selama rutin dipakai.
    const iat = typeof payload.iat === "number" ? payload.iat : 0;
    if (Date.now() / 1000 - iat > RENEW_AFTER_SECONDS) await issueSession(c, c.env.SESSION_SECRET);
    return true;
  } catch {
    return false;
  }
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await isLoggedIn(c))) return c.json({ error: "Belum login" }, 401);
  await next();
};

export const requireIngestSecret: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secret = c.env.INGEST_SECRET;
  const header = c.req.header("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!secret || secret.length < 8 || !token || !(await safeEqual(token, secret))) {
    return c.json({ error: "Secret ingest salah" }, 401);
  }
  await next();
};

/** Hash PIN dengan garam acak (PIN pendek, jadi juga dibatasi jumlah percobaannya). */
export async function hashPin(pin: string, salt: string = crypto.randomUUID()): Promise<string> {
  const bytes = await sha256(`${salt}:${pin}`);
  return `${salt}:${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function checkPin(pin: string, stored: string): Promise<boolean> {
  const [salt] = stored.split(":");
  return safeEqual(await hashPin(pin, salt), stored);
}
