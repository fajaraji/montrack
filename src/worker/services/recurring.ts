import { and, eq, gte } from "drizzle-orm";
import type { DB } from "../db/client";
import { transactions } from "../db/schema";
import { merchantKey } from "./categorize";
import { fromWib, wibDateKey, wibParts } from "../../shared/time";
import type { RecurringDTO } from "../../shared/types";

const DAY = 86400_000;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Deteksi tagihan/langganan: merchant yang sama, nominal mirip (±15%), muncul minimal
 * 3 kali di bulan berbeda dengan jarak ±1 bulan. Hanya membaca riwayat (1 query).
 */
export async function detectRecurring(db: DB, now = new Date()): Promise<RecurringDTO[]> {
  const rows = await db
    .select({
      merchant: transactions.merchant,
      rawMerchant: transactions.rawMerchant,
      description: transactions.description,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(and(eq(transactions.type, "expense"), eq(transactions.excluded, false), gte(transactions.occurredAt, new Date(now.getTime() - 200 * DAY))));

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = merchantKey(r.rawMerchant ?? r.merchant ?? r.description);
    if (key.length < 3) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const out: RecurringDTO[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const amt = median(list.map((r) => r.amount));
    const similar = list.filter((r) => Math.abs(r.amount - amt) <= amt * 0.15).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const months = new Set(similar.map((r) => { const p = wibParts(r.occurredAt); return `${p.year}-${p.month}`; }));
    if (similar.length < 3 || months.size < 3) continue;
    // satu kejadian per bulan (ambil yang terakhir di bulan itu)
    const perMonth = new Map<string, (typeof similar)[number]>();
    for (const r of similar) { const p = wibParts(r.occurredAt); perMonth.set(`${p.year}-${p.month}`, r); }
    const seq = [...perMonth.values()].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const gaps = seq.slice(1).map((r, i) => (r.occurredAt.getTime() - seq[i].occurredAt.getTime()) / DAY);
    const interval = median(gaps);
    if (interval < 25 || interval > 35) continue;
    const last = seq[seq.length - 1];
    // Jadwal berikutnya: tanggal yang sama bulan depan (tagihan biasanya bertanggal tetap).
    const lp = wibParts(last.occurredAt);
    const nm = lp.month === 12 ? { y: lp.year + 1, m: 1 } : { y: lp.year, m: lp.month + 1 };
    const dim = new Date(Date.UTC(nm.y, nm.m, 0)).getUTCDate();
    const next = fromWib(nm.y, nm.m, Math.min(lp.day, dim), lp.hour, lp.minute);
    // Berhenti berlangganan? Lewat > 20 hari dari jadwal tanpa transaksi baru → abaikan.
    if (now.getTime() - next.getTime() > 20 * DAY) continue;
    out.push({
      key,
      name: last.merchant ?? key,
      amount: median(seq.map((r) => r.amount)),
      categoryId: last.categoryId,
      accountId: last.accountId,
      lastDate: wibDateKey(last.occurredAt),
      nextDate: wibDateKey(next),
      occurrences: seq.length,
      daysUntil: Math.round((next.getTime() - now.getTime()) / DAY),
    });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}
