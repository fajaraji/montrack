import type { transactions } from "./db/schema";
import type { TransactionDTO } from "../shared/types";

/** Pesan error yang berguna: drizzle membungkus penyebab aslinya di `cause`. */
export function errorText(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  const cause = e?.cause?.message;
  const msg = (e?.message ?? String(err)).split("\n")[0].slice(0, 160);
  return cause ? `${cause} (${msg})` : msg;
}

export class HttpError extends Error {
  constructor(public status: 400 | 401 | 404 | 429, message: string) {
    super(message);
  }
}
export const bad = (msg: string) => new HttpError(400, msg);

export const TX_TYPES = ["expense", "income", "transfer", "adjustment"] as const;

export function int(v: unknown, name: string, opts: { optional?: boolean; nullable?: boolean } = {}): number | null | undefined {
  if (v === undefined) {
    if (opts.optional) return undefined;
    throw bad(`${name} wajib diisi`);
  }
  if (v === null || v === "") {
    if (opts.nullable) return null;
    throw bad(`${name} wajib diisi`);
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw bad(`${name} harus angka bulat`);
  return n;
}

export function str(v: unknown, max = 200): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export function toDTO(t: typeof transactions.$inferSelect): TransactionDTO {
  return {
    id: t.id,
    type: t.type as TransactionDTO["type"],
    amount: t.amount,
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    categoryId: t.categoryId,
    merchant: t.merchant,
    description: t.description,
    occurredAt: t.occurredAt.toISOString(),
    source: t.source as TransactionDTO["source"],
    status: t.status as TransactionDTO["status"],
    emailId: t.emailId,
    rawMerchant: t.rawMerchant,
    excluded: t.excluded,
    splitGroupId: t.splitGroupId,
  };
}
