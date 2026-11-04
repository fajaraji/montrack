import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { ErrorNote, Money, MonthSwitcher, Spinner } from "../components/ui";
import { Icon } from "../components/Icon";
import { LineChart } from "../components/charts";
import { formatRupiah, formatRupiahShort } from "../../shared/money";
import { MONTHS_ID, formatYm, parseYm } from "../../shared/time";
import type { RecurringDTO, ReportsDTO, WeeklyRecapDTO } from "../../shared/types";

function fmtDate(key: string) {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS_ID[m - 1].slice(0, 3)}`;
}

/** Daftar tagihan rutin (dipakai juga di Beranda). */
export function Recurring({ items, compact = false }: { items: RecurringDTO[]; compact?: boolean }) {
  const { category } = useStore();
  const list = compact ? items.filter((r) => r.daysUntil >= -3 && r.daysUntil <= 7) : items;
  if (!list.length) return compact ? null : <p className="py-4 text-sm text-white/50">Belum ada pola tagihan bulanan. Butuh minimal 3 bulan riwayat.</p>;
  return (
    <ul className="space-y-2">
      {list.map((r) => (
        <li key={r.key} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
          <span className="icon-tile size-9 text-base">{category(r.categoryId)?.icon ?? <Icon name="repeat" className="size-4" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{r.name}</span>
            <span className="block text-xs text-white/45">
              {r.daysUntil < 0 ? `Lewat ${-r.daysUntil} hari` : r.daysUntil === 0 ? "Hari ini" : r.daysUntil === 1 ? "Besok" : `${fmtDate(r.nextDate)} · ${r.daysUntil} hari lagi`}
            </span>
          </span>
          <Money value={r.amount} className="shrink-0 text-sm font-bold" />
        </li>
      ))}
    </ul>
  );
}

const TABS = [
  { id: "ringkasan", label: "Ringkasan" },
  { id: "kategori", label: "Kategori" },
  { id: "merchant", label: "Merchant" },
  { id: "tagihan", label: "Tagihan" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function Overview({ r, recap }: { r: ReportsDTO; recap: WeeklyRecapDTO | null }) {
  const { category } = useStore();
  const cur = r.trend[r.trend.length - 1];
  const full = r.trend.slice(0, -1).filter((t) => t.expense > 0);
  const avg = full.length ? Math.round(full.reduce((s, t) => s + t.expense, 0) / full.length) : 0;
  const diff = recap ? recap.total - recap.prevTotal : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="card-accent p-3.5">
          <p className="text-xs text-white/80">Keluar</p>
          <p className="tabular mt-1 text-base font-bold whitespace-nowrap sm:text-lg">{formatRupiahShort(cur.expense)}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-xs text-white/50">Masuk</p>
          <p className="tabular mt-1 text-base font-bold whitespace-nowrap sm:text-lg text-emerald-400">{formatRupiahShort(cur.income)}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-xs text-white/50">Rata-rata</p>
          <p className="tabular mt-1 text-base font-bold whitespace-nowrap sm:text-lg">{formatRupiahShort(avg)}</p>
        </div>
      </div>

      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-bold">Arus kas 6 bulan</h2>
            <p className="text-xs text-white/45">Ketuk titik untuk melihat angka</p>
          </div>
          <div className="flex gap-3 text-xs text-white/55">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#ffb38a]" />Masuk</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-white" />Keluar</span>
          </div>
        </div>
        <div className="mt-3">
          <LineChart
            labels={r.trend.map((t) => MONTHS_ID[Number(t.month.slice(5)) - 1].slice(0, 3))}
            series={[
              { name: "Masuk", color: "#ffb38a", values: r.trend.map((t) => t.income) },
              { name: "Keluar", color: "#f4f4f5", values: r.trend.map((t) => t.expense) },
            ]}
          />
        </div>
      </section>

      {recap && recap.count > 0 && (
        <section className="card">
          <p className="kbd mb-3">Minggu lalu · {fmtDate(recap.weekStart)}–{fmtDate(recap.weekEnd)}</p>
          <p className="tabular text-gradient text-3xl font-bold">{formatRupiah(recap.total)}</p>
          <p className="mt-1 text-sm text-white/55">
            dari {recap.count} transaksi
            {recap.prevTotal > 0 && (
              <>
                {", "}
                <span className={diff > 0 ? "text-rose-400" : "text-emerald-400"}>
                  {formatRupiah(Math.abs(diff))} {diff > 0 ? "lebih banyak" : "lebih hemat"}
                </span>{" "}
                dari minggu sebelumnya
              </>
            )}
            .
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {recap.topCategories.map((c) => (
              <span key={c.categoryId ?? "none"} className="chip py-1 text-xs">
                {category(c.categoryId)?.icon ?? "?"} {category(c.categoryId)?.name ?? "Lainnya"} · <span className="tabular">{formatRupiahShort(c.amount)}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Categories({ r, month }: { r: ReportsDTO; month: string }) {
  const { category } = useStore();
  const list = r.categories.filter((c) => c.current || c.average);
  const max = Math.max(1, ...list.map((c) => Math.max(c.current, c.average)));
  if (!list.length) return <p className="card text-sm text-white/50">Belum ada pengeluaran.</p>;
  return (
    <section className="card">
      <p className="mb-3 text-xs text-white/45">Bulan ini dibanding rata-rata 5 bulan sebelumnya. Garis tipis = rata-rata.</p>
      <ul className="space-y-1">
        {list.map((c) => {
          const cat = category(c.categoryId);
          const change = c.average ? Math.round(((c.current - c.average) / c.average) * 100) : null;
          return (
            <li key={c.categoryId ?? "none"}>
              <button
                className="-mx-2 w-[calc(100%+1rem)] rounded-2xl px-2 py-2.5 text-left transition hover:bg-white/[0.04]"
                onClick={() => navigate(`/transaksi?month=${month}&type=expense&categoryId=${c.categoryId ?? "none"}`)}
              >
                <div className="flex items-center gap-3">
                  <span className="icon-tile size-9 text-base">{cat?.icon ?? "?"}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{cat?.name ?? "Belum dikategorikan"}</span>
                  {change != null && change !== 0 && (
                    <span className={`badge ${change > 15 ? "bg-rose-500/10 text-rose-400" : change < -15 ? "bg-emerald-500/10 text-emerald-400" : "bg-white/[0.06] text-white/55"}`}>
                      {change > 0 ? "▲" : "▼"} {Math.abs(change)}%
                    </span>
                  )}
                  <Money value={c.current} className="w-24 shrink-0 text-right text-sm font-bold" />
                </div>
                <div className="relative mt-2 ml-12 h-1.5 rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,#ffb38a,#ff7a59)]" style={{ width: `${(c.current / max) * 100}%` }} />
                  {c.average > 0 && <div className="absolute -top-1 h-3.5 w-0.5 rounded bg-white/70" style={{ left: `${(c.average / max) * 100}%` }} title={`Rata-rata ${formatRupiah(c.average)}`} />}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Merchants({ r }: { r: ReportsDTO }) {
  const { category } = useStore();
  if (!r.topMerchants.length) return <p className="card text-sm text-white/50">Belum ada pengeluaran bulan ini.</p>;
  const [first, ...rest] = r.topMerchants;
  return (
    <div className="space-y-3">
      <section className="card-accent">
        <p className="text-xs text-white/80">Paling banyak bulan ini</p>
        <p className="mt-1 truncate text-xl font-bold">{category(first.categoryId)?.icon} {first.name}</p>
        <p className="tabular mt-1 text-sm text-white/85">
          {formatRupiah(first.total)} · {first.count}× transaksi
        </p>
      </section>
      <section className="card">
        <ul className="space-y-1">
          {rest.map((m, i) => (
            <li key={m.name} className="flex items-center gap-3 py-2">
              <span className="kbd w-7 justify-center">{i + 2}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {category(m.categoryId)?.icon} {m.name}
              </span>
              <span className="text-xs text-white/40">{m.count}×</span>
              <Money value={m.total} className="w-24 shrink-0 text-right text-sm font-bold" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function Reports() {
  const [month, setMonth] = useState(formatYm(parseYm(null)));
  const [tab, setTab] = useState<Tab>("ringkasan");
  const reports = useAsync(() => api<ReportsDTO>(`/reports?month=${month}`), [month]);
  const recap = useAsync(() => api<WeeklyRecapDTO>("/recap"), []);
  const recurring = useAsync(() => api<RecurringDTO[]>("/recurring"), []);
  const r = reports.data;
  const ym = parseYm(month);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#ff9a6a]/30 bg-[#ff7a4a]/10 px-3 py-1 text-xs font-medium text-[#ffc9a8]">
            <span className="size-1.5 rounded-full bg-[#ff9a6a] shadow-[0_0_8px_#ff9a6a]" />
            {MONTHS_ID[ym.month - 1]} {ym.year}
          </span>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Laporan <span className="text-gradient">bulanan.</span>
          </h1>
        </div>
        <div className="glass rounded-full px-1">
          <MonthSwitcher month={month} onChange={setMonth} />
        </div>
      </div>

      <div className="glass flex gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none]" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`flex-1 rounded-full px-2.5 py-2 text-[13px] whitespace-nowrap transition sm:px-4 sm:text-sm ${tab === t.id ? "bg-white font-semibold text-black" : "text-white/60 hover:text-white"}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorNote message={reports.error} />
      {!r ? (
        <Spinner />
      ) : tab === "ringkasan" ? (
        <Overview r={r} recap={recap.data} />
      ) : tab === "kategori" ? (
        <Categories r={r} month={month} />
      ) : tab === "merchant" ? (
        <Merchants r={r} />
      ) : (
        <section className="card">
          <p className="mb-3 text-xs text-white/45">Terdeteksi otomatis dari transaksi yang berulang tiap bulan dengan nominal mirip.</p>
          {recurring.data ? <Recurring items={recurring.data} /> : <Spinner />}
        </section>
      )}
    </div>
  );
}
