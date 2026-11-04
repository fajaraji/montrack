import { and, asc, gte, lt } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, categories, transactions } from "../db/schema";
import { wibParts } from "../../shared/time";

const TYPE_LABEL: Record<string, string> = {
  expense: "Pengeluaran",
  income: "Pemasukan",
  transfer: "Transfer",
  adjustment: "Penyesuaian",
};

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV (pemisah koma, UTF-8 + BOM agar Excel membaca huruf dengan benar). */
export async function exportTransactionsCsv(db: DB, range: { from?: Date; to?: Date } = {}): Promise<string> {
  const [rows, accs, cats] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(
        and(
          range.from ? gte(transactions.occurredAt, range.from) : undefined,
          range.to ? lt(transactions.occurredAt, range.to) : undefined,
        ),
      )
      .orderBy(asc(transactions.occurredAt), asc(transactions.id)),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts),
    db.select({ id: categories.id, name: categories.name }).from(categories),
  ]);
  const acc = new Map(accs.map((a) => [a.id, a.name]));
  const cat = new Map(cats.map((c) => [c.id, c.name]));
  const header = ["Tanggal", "Jam", "Jenis", "Nominal", "Akun", "Ke akun", "Kategori", "Merchant", "Merchant asli", "Catatan", "Sumber", "Status", "Diabaikan dari laporan"];
  const lines = [header.join(",")];
  for (const t of rows) {
    const p = wibParts(t.occurredAt);
    const z = (n: number) => String(n).padStart(2, "0");
    const signed = t.type === "expense" ? -t.amount : t.amount;
    lines.push(
      [
        `${p.year}-${z(p.month)}-${z(p.day)}`,
        `${z(p.hour)}:${z(p.minute)}`,
        TYPE_LABEL[t.type] ?? t.type,
        signed,
        t.accountId != null ? acc.get(t.accountId) : "",
        t.toAccountId != null ? acc.get(t.toAccountId) : "",
        t.categoryId != null ? cat.get(t.categoryId) : "",
        t.merchant,
        t.rawMerchant,
        t.description,
        t.source,
        t.status === "review" ? "Perlu ditinjau" : "OK",
        t.excluded ? "Ya" : "",
      ]
        .map(cell)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
