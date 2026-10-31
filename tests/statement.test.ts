import { describe, it, expect } from "vitest";
import { detectCsvMapping, parseCsvText, parseDateLoose, parseStatementItems, rowsFromCsv, type TextItem } from "../src/shared/statement";

describe("parseDateLoose", () => {
  it.each([
    ["31/10/2026 xx", "2026-10-31"],
    ["31-10-26", "2026-10-31"],
    ["2026-10-31", "2026-10-31"],
    ["31 Okt 2026", "2026-10-31"],
    ["05 Oct", "2026-10-05"],
    ["05/10 TRSF", "2026-10-05"],
  ])("%s", (s, v) => {
    expect(parseDateLoose(s, 2026)?.[0]).toBe(v);
  });
});

describe("CSV", () => {
  it("debit/kredit terpisah, delimiter titik koma", () => {
    const csv = `Laporan Mutasi;;;;\nTanggal;Keterangan;Debet;Kredit;Saldo\n01/10/2026;QRIS KOPI SENJA;25.000,00;;975.000,00\n02/10/2026;GAJI;;9.500.000,00;10.475.000,00\n03/10/2026;BIAYA ADM;12.500,00;;10.462.500,00`;
    const t = parseCsvText(csv);
    const m = detectCsvMapping(t)!;
    expect(m).toMatchObject({ headerRow: 1, date: 0, description: 1, debit: 2, credit: 3 });
    expect(rowsFromCsv(t, m, 2026)).toEqual([
      { date: "2026-10-01", description: "QRIS KOPI SENJA", amount: -25000 },
      { date: "2026-10-02", description: "GAJI", amount: 9500000 },
      { date: "2026-10-03", description: "BIAYA ADM", amount: -12500 },
    ]);
  });
  it("satu kolom nominal dengan DB/CR", () => {
    const csv = `Date,Description,Amount,Balance\n"05/10/2026","TRSF E-BANKING DB","150,000.00 DB","1,000,000.00"\n06/10/2026,BUNGA,"1,234.00 CR",1001234`;
    const t = parseCsvText(csv);
    const m = detectCsvMapping(t)!;
    expect(rowsFromCsv(t, m, 2026).map((r) => r.amount)).toEqual([-150000, 1234]);
  });
});

function line(y: number, parts: [number, string][], page = 1): TextItem[] {
  return parts.map(([x, str]) => ({ x, y, str, page }));
}

describe("PDF", () => {
  it("memakai posisi kolom header debit/kredit & baris lanjutan deskripsi", () => {
    const items = [
      ...line(800, [[50, "Periode: 01/10/2026 - 31/10/2026"]]),
      ...line(760, [[50, "Tanggal"], [130, "Uraian Transaksi"], [380, "Debet"], [460, "Kredit"], [540, "Saldo"]]),
      ...line(740, [[50, "01/10/2026"], [130, "QRIS KOPI SENJA"], [380, "25.000,00"], [540, "975.000,00"]]),
      ...line(728, [[130, "JAKARTA SELATAN"]]),
      ...line(710, [[50, "02/10/2026"], [130, "TRANSFER MASUK GAJI"], [460, "9.500.000,00"], [540, "10.475.000,00"]]),
      ...line(690, [[50, "31/10/2026"], [130, "BIAYA ADM"], [380, "12.500,00"], [540, "10.462.500,00"]]),
      ...line(670, [[50, "Saldo Akhir"], [540, "10.462.500,00"]]),
    ];
    const r = parseStatementItems(items);
    expect(r.rows.map(({ date, description, amount }) => ({ date, description, amount }))).toEqual([
      { date: "2026-10-01", description: "QRIS KOPI SENJA JAKARTA SELATAN", amount: -25000 },
      { date: "2026-10-02", description: "TRANSFER MASUK GAJI", amount: 9500000 },
      { date: "2026-10-31", description: "BIAYA ADM", amount: -12500 },
    ]);
    expect(r.warnings).toEqual([]);
  });
  it("tanpa header: pakai akhiran DB/CR dan perubahan saldo", () => {
    const items = [
      ...line(740, [[50, "01/10"], [100, "TRSF E-BANKING"], [300, "50.000,00 DB"], [400, "950.000,00"]]),
      ...line(720, [[50, "02/10"], [100, "SETORAN"], [300, "100.000,00"], [400, "1.050.000,00"]]),
    ];
    const r = parseStatementItems(items, 2026);
    expect(r.rows.map((x) => x.amount)).toEqual([-50000, 100000]);
  });
});
