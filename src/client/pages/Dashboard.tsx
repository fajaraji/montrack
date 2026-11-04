import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { Link, navigate } from "../lib/router";
import { Money, MonthSwitcher, Spinner, ErrorNote, Sheet, useToast } from "../components/ui";
import { Icon } from "../components/Icon";
import { LineChart } from "../components/charts";
import { openAdd } from "../components/Layout";
import { TxForm, undoAction } from "../components/tx";
import { STATUS, TxTable } from "../components/TxTable";
import { Recurring } from "./Reports";
import { formatRupiah, formatRupiahShort } from "../../shared/money";
import { MONTHS_ID, parseYm, formatYm } from "../../shared/time";
import { providerLabel, type MonthSummaryDTO, type RecurringDTO, type ReportsDTO, type TransactionDTO } from "../../shared/types";

interface ChecklistDTO {
  dismissed: boolean;
  items: { id: string; label: string; done: boolean; href: string; hint: string }[];
}

function Checklist({ c, onDismiss }: { c: ChecklistDTO; onDismiss: () => void }) {
  const done = c.items.filter((i) => i.done).length;
  if (c.dismissed || done === c.items.length) return null;
  return (
    <section className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">Siapkan Montrack</h2>
          <p className="text-xs text-stone-500">{done} dari {c.items.length} langkah selesai</p>
        </div>
        <button className="text-xs text-stone-400 hover:text-stone-600" onClick={onDismiss}>Tutup</button>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-white/10">
        <div className="bar-striped h-full rounded-full bg-brand-500" style={{ width: `${(done / c.items.length) * 100}%` }} />
      </div>
      <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-5">
        {c.items.map((i) => (
          <li key={i.id}>
            <Link href={i.href} className="flex items-start gap-3 rounded-2xl px-2 py-2 hover:bg-stone-50 dark:hover:bg-white/5">
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${i.done ? "bg-ink text-white dark:bg-white dark:text-ink" : "border border-stone-300 dark:border-stone-600"}`}
                aria-hidden
              >
                {i.done ? "✓" : ""}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm ${i.done ? "text-stone-400 line-through" : "font-semibold"}`}>{i.label}</span>
                {!i.done && <span className="block text-xs text-stone-500">{i.hint}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Persentase perubahan dengan panah, gaya "↗ 5% dari bulan lalu". */
function Delta({ now, prev, invert = false, light = false, suffix = "dari bulan lalu" }: { now: number; prev: number; invert?: boolean; light?: boolean; suffix?: string }) {
  if (!prev) return <p className={`text-xs ${light ? "text-white/80" : "text-stone-400"}`}>Belum ada pembanding</p>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const up = pct > 0;
  // Pengeluaran naik = buruk (merah); pemasukan naik = baik (hijau).
  const good = invert ? !up : up;
  const color = light ? "text-white" : pct === 0 ? "text-stone-500" : good ? "text-emerald-600" : "text-rose-600";
  return (
    <p className={`flex flex-wrap items-center gap-1 text-xs ${light ? "text-white/80" : "text-stone-400"}`}>
      <span className={`inline-flex items-center gap-0.5 font-semibold ${color}`}>
        <Icon name={up ? "up" : "down"} className="size-3.5" />
        {Math.abs(pct)}%
      </span>
      {suffix}
    </p>
  );
}

function StatTile({ label, icon, value, accent = false, children }: { label: string; icon: string; value: number; accent?: boolean; children?: ReactNode }) {
  return (
    <div className={`${accent ? "card-accent" : "card"} flex min-h-40 flex-col justify-between gap-4`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm leading-tight font-medium ${accent ? "text-white/90" : "text-stone-500"}`}>{label}</p>
        <span className={accent ? "flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white" : "icon-tile"}>
          <Icon name={icon} />
        </span>
      </div>
      <div>
        <p className="tabular text-xl leading-tight font-bold tracking-tight whitespace-nowrap sm:text-[1.65rem]">{formatRupiahShort(value)}</p>
        {children}
      </div>
    </div>
  );
}

function Activities({ items, onOpen }: { items: TransactionDTO[]; onOpen: (t: TransactionDTO) => void }) {
  const [q, setQ] = useState("");
  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-lg font-bold">Aktivitas terbaru</h2>
        <form
          className="relative flex-1 sm:w-56 sm:flex-none"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/transaksi?q=${encodeURIComponent(q.trim())}`);
          }}
        >
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-stone-400" />
          <input className="input py-2 pl-10 text-sm" placeholder="Cari" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari transaksi" />
        </form>
        <Link href="/transaksi" className="btn-outline py-2">
          Filter <Icon name="filter" className="size-4" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-500">Belum ada transaksi.</p>
      ) : (
        <>
          <TxTable items={items} onOpen={onOpen} />
          <Link href="/transaksi" className="mt-3 block text-center text-sm font-semibold text-brand-700 dark:text-brand-500">
            Lihat semua transaksi
          </Link>
        </>
      )}
    </section>
  );
}

export function Dashboard() {
  const { accounts, category, version, bump } = useStore();
  const [month, setMonth] = useState(formatYm(parseYm(null)));
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const { toastEl, showToast } = useToast();
  const { data: s, error, loading } = useAsync(() => api<MonthSummaryDTO>(`/summary?month=${month}`), [month, version]);
  const reports = useAsync(() => api<ReportsDTO>(`/reports?month=${month}`), [month, version]);
  const recent = useAsync(() => api<TransactionDTO[]>("/transactions?limit=8"), [version]);
  const checklist = useAsync(() => api<ChecklistDTO>("/checklist"), [version]);
  const recurring = useAsync(() => api<RecurringDTO[]>("/recurring"), [version]);
  const active = accounts.filter((a) => !a.archived);
  const totalBalance = active.reduce((sum, a) => sum + a.balance, 0);
  const ym = parseYm(month);
  const trend = reports.data?.trend ?? [];
  const prevIncome = trend.length >= 2 ? trend[trend.length - 2].income : 0;
  const prevMonthName = MONTHS_ID[(ym.month + 10) % 12];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#ff9a6a]/30 bg-[#ff7a4a]/10 px-3 py-1 text-xs font-medium text-[#ffc9a8]">
            <span className="size-1.5 rounded-full bg-[#ff9a6a] shadow-[0_0_8px_#ff9a6a]" />
            {MONTHS_ID[ym.month - 1]} {ym.year} · tersinkron dari email
          </span>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Keuanganmu, <span className="text-gradient">sekilas.</span>
          </h1>
        </div>
        <div className="rounded-2xl bg-white px-1 dark:bg-white/[0.05] dark:backdrop-blur-xl">
          <MonthSwitcher month={month} onChange={setMonth} />
        </div>
      </div>
      {toastEl}
      <ErrorNote message={error} />
      {checklist.data && (
        <Checklist
          c={checklist.data}
          onDismiss={async () => {
            await api("/settings", { method: "PATCH", body: { checklistDismissed: true } });
            bump();
          }}
        />
      )}
      {s && (s.reviewCount > 0 || s.unparsedEmailCount > 0) && (
        <Link href="/tinjau" className="flex items-center justify-between gap-3 rounded-3xl bg-brand-50 px-5 py-3.5 text-sm font-medium text-brand-900 dark:bg-brand-500/10 dark:text-brand-900">
          <span className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white">
              <Icon name="check" className="size-4" />
            </span>
            <span>
              {s.reviewCount > 0 && <>{s.reviewCount} transaksi perlu dikategorikan</>}
              {s.reviewCount > 0 && s.unparsedEmailCount > 0 && " · "}
              {s.unparsedEmailCount > 0 && <>{s.unparsedEmailCount} email belum terbaca</>}
            </span>
          </span>
          <span aria-hidden>›</span>
        </Link>
      )}
      {loading && !s && <Spinner />}

      {s && (
        <div className="grid gap-5 lg:grid-cols-12 [&>*]:min-w-0">
          {/* Saldo + akun */}
          <section className="card flex flex-col gap-5 lg:col-span-5">
            <div>
              <p className="text-sm font-medium text-stone-500">Total saldo</p>
              <p className="tabular text-gradient mt-1 text-[2.1rem] leading-tight font-bold tracking-tight">{formatRupiah(totalBalance)}</p>
              <p className="mt-1 text-xs text-stone-400">
                Selisih bulan ini <Money value={s.net} sign className={`font-semibold ${s.net >= 0 ? "text-emerald-600" : "text-rose-600"}`} />
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-primary py-3" onClick={() => openAdd("expense")}>
                <Icon name="plus" className="size-4" /> Catat
              </button>
              <button className="btn-outline py-3" onClick={() => openAdd("transfer")}>
                <Icon name="swap" className="size-4" /> Transfer
              </button>
            </div>
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm">
                <span className="text-stone-400">Akun</span>
                <span className="text-stone-300">|</span>
                <span className="font-semibold">Total {active.length} akun</span>
                <Link href="/akun" className="ml-auto text-xs font-semibold text-brand-700 dark:text-brand-500">
                  Kelola
                </Link>
              </div>
              {active.length === 0 ? (
                <p className="text-sm text-stone-500">Akun dibuat otomatis saat email pertama masuk.</p>
              ) : (
                <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                  {active.map((a) => (
                    <Link
                      key={a.id}
                      href={`/transaksi?accountId=${a.id}`}
                      className={`min-w-36 shrink-0 rounded-2xl border p-3 ${
                        a.balance < 0 ? "border-brand-200 bg-brand-50/50 dark:border-brand-500/30 dark:bg-brand-500/5" : "border-stone-100 bg-stone-50 dark:border-white/5 dark:bg-white/5"
                      }`}
                    >
                      <p className="text-xs font-semibold text-stone-500">{a.name}</p>
                      <p className="tabular mt-1 text-sm font-bold">{formatRupiah(a.balance)}</p>
                      <p className="text-[11px] text-stone-400">
                        {providerLabel(a.provider)}
                        {a.last4 ? ` ·${a.last4}` : ""}
                      </p>
                      <span className={`badge mt-2 text-[10px] tracking-wide uppercase ${a.balance < 0 ? STATUS.review.cls : STATUS.ok.cls}`}>
                        {a.balance < 0 ? "Sesuaikan" : a.kind === "ewallet" ? "E-wallet" : a.kind === "cash" ? "Tunai" : "Bank"}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 4 kotak statistik */}
          <div className="grid grid-cols-2 gap-4 lg:col-span-7">
            <StatTile label={`Pengeluaran ${MONTHS_ID[ym.month - 1]}`} icon="wallet" value={s.expense} accent>
              <Delta now={s.expense} prev={s.prevExpenseSamePeriod} invert light suffix={s.isCurrentMonth ? `vs ${prevMonthName.slice(0, 3)} tgl ${s.dayOfMonth}` : `vs ${prevMonthName}`} />
            </StatTile>
            <StatTile label="Pemasukan" icon="down" value={s.income}>
              <Delta now={s.income} prev={prevIncome} />
            </StatTile>
            <StatTile label="Selisih" icon="pie" value={s.net}>
              <p className="text-xs text-stone-400">masuk − keluar</p>
            </StatTile>
            <StatTile label="Transfer antar akun" icon="swap" value={s.transferTotal}>
              <p className="text-xs text-stone-400">tidak dihitung keluar</p>
            </StatTile>
          </div>

          {/* Grafik arus kas */}
          <section className="card lg:col-span-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Arus kas</h2>
                <p className="text-xs text-stone-400">Pemasukan dan pengeluaran 6 bulan terakhir</p>
              </div>
              <div className="flex gap-3 text-xs text-stone-500">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-[#ffb38a]" />
                  Pemasukan
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-ink dark:bg-white" />
                  Pengeluaran
                </span>
              </div>
            </div>
            <div className="mt-4">
              {trend.length ? (
                <LineChart
                  labels={trend.map((t) => MONTHS_ID[Number(t.month.slice(5)) - 1].slice(0, 3))}
                  series={[
                    { name: "Pemasukan", color: "#ffb38a", values: trend.map((t) => t.income) },
                    { name: "Pengeluaran", color: "#f4f4f5", values: trend.map((t) => t.expense) },
                  ]}
                />
              ) : (
                <Spinner />
              )}
            </div>
          </section>

          {/* Kolom kiri bawah */}
          <div className="space-y-5 lg:col-span-5">
            <section className="card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-bold">Per kategori</h2>
                <Link href={`/transaksi?month=${month}&type=expense`} className="text-xs font-semibold text-brand-700 dark:text-brand-500">
                  Semua
                </Link>
              </div>
              {s.byCategory.length === 0 ? (
                <p className="text-sm text-stone-500">Belum ada pengeluaran bulan ini.</p>
              ) : (
                <ul className="space-y-4">
                  {s.byCategory.slice(0, 6).map((g) => {
                    const c = category(g.categoryId);
                    const pct = s.expense ? (g.total / s.expense) * 100 : 0;
                    return (
                      <li key={g.categoryId ?? "none"}>
                        <button className="w-full text-left" onClick={() => navigate(`/transaksi?month=${month}&type=expense&categoryId=${g.categoryId ?? "none"}`)}>
                          <div className="flex items-center gap-3 text-sm">
                            <span className="icon-tile size-9 text-base">{c?.icon ?? "?"}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold">{c?.name ?? "Belum dikategorikan"}</span>
                              <span className="block text-xs text-stone-400">
                                {g.count} transaksi · {Math.round(pct)}%
                              </span>
                            </span>
                            <Money value={g.total} className="font-bold" />
                          </div>
                          <div className="mt-2">
                            <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-white/10">
                              <div className={`h-full rounded-full ${c ? "bg-ink dark:bg-white" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {s.isCurrentMonth && recurring.data && recurring.data.some((r) => r.daysUntil >= -3 && r.daysUntil <= 7) && (
              <section className="card">
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="font-bold">Tagihan 7 hari ke depan</h2>
                  <Link href="/laporan" className="text-xs font-semibold text-brand-700 dark:text-brand-500">
                    Semua
                  </Link>
                </div>
                <Recurring items={recurring.data} compact />
              </section>
            )}
          </div>

          {/* Aktivitas terbaru */}
          <div className="lg:col-span-12">{recent.data ? <Activities items={recent.data} onOpen={setEditing} /> : <Spinner />}</div>
        </div>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Ubah transaksi">
        {editing && (
          <TxForm
            key={editing.id}
            initial={editing}
            onDone={(m, undo) => {
              setEditing(null);
              showToast(m ?? "Tersimpan.", undoAction(undo, bump));
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
