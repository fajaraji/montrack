import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { ErrorNote, Money, MonthSwitcher, PageHeader, Spinner } from "../components/ui";
import { formatRupiah, formatRupiahShort } from "../../shared/money";
import { MONTHS_ID, formatYm, parseYm } from "../../shared/time";
import type { RecurringDTO, ReportsDTO, WeeklyRecapDTO } from "../../shared/types";

function shortMonth(ym: string) {
  return MONTHS_ID[Number(ym.slice(5)) - 1].slice(0, 3);
}

function fmtDate(key: string) {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS_ID[m - 1].slice(0, 3)}`;
}

function Trend({ r }: { r: ReportsDTO }) {
  const max = Math.max(1, ...r.trend.flatMap((t) => [t.expense, t.income]));
  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">Tren 6 bulan</h2>
      <div className="flex h-40 items-end gap-3" role="img" aria-label="Grafik pengeluaran dan pemasukan 6 bulan">
        {r.trend.map((t) => (
          <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-32 w-full items-end justify-center gap-0.5">
              <div className="w-1/2 rounded-t-md bg-ink dark:bg-white" style={{ height: `${Math.max(2, (t.expense / max) * 100)}%` }} title={`Keluar ${formatRupiah(t.expense)}`} />
              <div className="w-1/2 rounded-t-md bg-[#4f7cff]" style={{ height: `${Math.max(2, (t.income / max) * 100)}%` }} title={`Masuk ${formatRupiah(t.income)}`} />
            </div>
            <span className={`text-[11px] ${t.month === r.month ? "font-semibold" : "text-stone-500"}`}>{shortMonth(t.month)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-stone-500">
        <span><span className="mr-1 inline-block size-2 rounded-full bg-ink dark:bg-white" />Pengeluaran</span>
        <span><span className="mr-1 inline-block size-2 rounded-full bg-[#4f7cff]" />Pemasukan</span>
      </div>
      <table className="mt-3 w-full text-sm">
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {[...r.trend].reverse().map((t) => (
            <tr key={t.month}>
              <td className="py-1.5">{MONTHS_ID[Number(t.month.slice(5)) - 1]} {t.month.slice(0, 4)}</td>
              <td className="tabular py-1.5 text-right">{formatRupiah(t.expense)}</td>
              <td className="tabular py-1.5 text-right text-emerald-700 dark:text-emerald-400">{t.income ? `+${formatRupiah(t.income)}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Recap({ r }: { r: WeeklyRecapDTO }) {
  const { category } = useStore();
  const diff = r.total - r.prevTotal;
  return (
    <section className="card">
      <h2 className="font-semibold">Rekap minggu lalu</h2>
      <p className="text-xs text-stone-500">{fmtDate(r.weekStart)} – {fmtDate(r.weekEnd)}</p>
      {r.count === 0 ? (
        <p className="mt-2 text-sm text-stone-500">Tidak ada pengeluaran tercatat.</p>
      ) : (
        <>
          <p className="tabular mt-2 text-2xl font-bold">{formatRupiah(r.total)}</p>
          <p className="text-sm text-stone-500">
            {r.count} transaksi
            {r.prevTotal > 0 && (
              <>
                {" · "}
                <span className={diff > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}>
                  {formatRupiah(Math.abs(diff))} {diff > 0 ? "lebih banyak" : "lebih hemat"}
                </span>{" "}
                dari minggu sebelumnya
              </>
            )}
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {r.topCategories.map((c) => (
              <li key={c.categoryId ?? "none"} className="flex justify-between">
                <span>{category(c.categoryId)?.icon ?? "?"} {category(c.categoryId)?.name ?? "Belum dikategorikan"}</span>
                <Money value={c.amount} />
              </li>
            ))}
          </ul>
          {r.biggest && (
            <p className="mt-2 text-xs text-stone-500">
              Terbesar: {r.biggest.merchant ?? "—"} <span className="tabular">{formatRupiah(r.biggest.amount)}</span> ({fmtDate(r.biggest.date)})
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function Recurring({ items, compact = false }: { items: RecurringDTO[]; compact?: boolean }) {
  const { category } = useStore();
  const list = compact ? items.filter((r) => r.daysUntil >= -3 && r.daysUntil <= 7) : items;
  if (!list.length) return compact ? null : <p className="text-sm text-stone-500">Belum ada pola tagihan bulanan (butuh minimal 3 bulan riwayat).</p>;
  return (
    <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
      {list.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-2 py-2">
          <span className="min-w-0">
            <span className="block truncate font-medium">{category(r.categoryId)?.icon ?? "🔁"} {r.name}</span>
            <span className="block text-xs text-stone-500">
              {r.daysUntil < 0 ? `Lewat ${-r.daysUntil} hari` : r.daysUntil === 0 ? "Hari ini" : r.daysUntil === 1 ? "Besok" : `${fmtDate(r.nextDate)} · ${r.daysUntil} hari lagi`}
              {!compact && ` · ${r.occurrences}× tercatat`}
            </span>
          </span>
          <Money value={r.amount} className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export function Reports() {
  const { category } = useStore();
  const [month, setMonth] = useState(formatYm(parseYm(null)));
  const reports = useAsync(() => api<ReportsDTO>(`/reports?month=${month}`), [month]);
  const recap = useAsync(() => api<WeeklyRecapDTO>("/recap"), []);
  const recurring = useAsync(() => api<RecurringDTO[]>("/recurring"), []);
  const r = reports.data;

  return (
    <div className="space-y-4">
      <PageHeader title="Laporan" right={<MonthSwitcher month={month} onChange={setMonth} />} />
      <ErrorNote message={reports.error} />
      {!r ? (
        <Spinner />
      ) : (
        <>
          <Trend r={r} />
          {recap.data && <Recap r={recap.data} />}

          <section className="card">
            <h2 className="mb-1 font-semibold">Per kategori</h2>
            <p className="mb-3 text-xs text-stone-500">Bulan ini dibanding rata-rata 5 bulan sebelumnya.</p>
            {r.categories.filter((c) => c.current || c.average).length === 0 ? (
              <p className="text-sm text-stone-500">Belum ada pengeluaran.</p>
            ) : (
              <ul className="space-y-3">
                {r.categories
                  .filter((c) => c.current || c.average)
                  .map((c) => {
                    const cat = category(c.categoryId);
                    const max = Math.max(1, ...c.perMonth);
                    const up = c.average > 0 && c.current > c.average * 1.15;
                    return (
                      <li key={c.categoryId ?? "none"}>
                        <button
                          className="w-full text-left"
                          onClick={() => navigate(`/transaksi?month=${month}&type=expense&categoryId=${c.categoryId ?? "none"}`)}
                        >
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate">{cat?.icon ?? "?"} {cat?.name ?? "Belum dikategorikan"}</span>
                            <span className="shrink-0 text-right">
                              <Money value={c.current} className={`font-medium ${up ? "text-rose-700 dark:text-rose-400" : ""}`} />
                              <span className="tabular block text-xs text-stone-500">rata-rata {formatRupiahShort(c.average)}</span>
                            </span>
                          </div>
                          <div className="mt-1 flex h-6 items-end gap-0.5" aria-hidden>
                            {c.perMonth.map((v, i) => (
                              <div
                                key={i}
                                className={`flex-1 rounded-sm ${i === c.perMonth.length - 1 ? "bg-brand-500" : "bg-stone-200 dark:bg-white/10"}`}
                                style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
                              />
                            ))}
                          </div>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="mb-3 font-semibold">Merchant terbesar bulan ini</h2>
            {r.topMerchants.length === 0 ? (
              <p className="text-sm text-stone-500">Belum ada pengeluaran.</p>
            ) : (
              <ol className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
                {r.topMerchants.map((m, i) => (
                  <li key={m.name} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0 truncate">
                      <span className="mr-2 text-stone-400">{i + 1}.</span>
                      {category(m.categoryId)?.icon} {m.name} <span className="text-xs text-stone-400">{m.count}×</span>
                    </span>
                    <Money value={m.total} className="shrink-0 font-medium" />
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="card">
            <h2 className="mb-1 font-semibold">Tagihan & langganan rutin</h2>
            <p className="mb-2 text-xs text-stone-500">Terdeteksi otomatis dari transaksi yang berulang tiap bulan dengan nominal mirip.</p>
            {recurring.data ? <Recurring items={recurring.data} /> : <Spinner />}
          </section>
        </>
      )}
    </div>
  );
}
