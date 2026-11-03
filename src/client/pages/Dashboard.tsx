import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { Link, navigate } from "../lib/router";
import { Money, MonthSwitcher, Spinner, ErrorNote, Sheet, useToast } from "../components/ui";
import { TxForm } from "../components/tx";
import { formatRupiah, formatRupiahShort } from "../../shared/money";
import { MONTHS_ID, parseYm, formatYm } from "../../shared/time";
import type { MonthSummaryDTO } from "../../shared/types";

function Comparison({ s }: { s: MonthSummaryDTO }) {
  if (s.dayOfMonth === 0) return null;
  const prevName = MONTHS_ID[(parseYm(s.month).month + 10) % 12];
  const diff = s.expense - s.prevExpenseSamePeriod;
  if (s.prevExpenseSamePeriod === 0 && s.prevExpenseTotal === 0) {
    return <p className="text-sm text-stone-500">Belum ada data {prevName} untuk dibandingkan.</p>;
  }
  const near = Math.abs(diff) <= Math.max(25000, s.prevExpenseSamePeriod * 0.05);
  const period = s.isCurrentMonth ? `sampai tanggal ${s.dayOfMonth}` : "";
  if (near) return <p className="text-sm text-stone-500">Hampir sama dengan {prevName} {period}.</p>;
  return (
    <p className="text-sm text-stone-500">
      <span className={diff > 0 ? "font-medium text-rose-700 dark:text-rose-400" : "font-medium text-emerald-700 dark:text-emerald-400"}>
        {formatRupiah(Math.abs(diff))} {diff > 0 ? "lebih banyak" : "lebih hemat"}
      </span>{" "}
      dari {prevName} {period}.
    </p>
  );
}

function DailyBars({ s }: { s: MonthSummaryDTO }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...s.daily);
  const avg = s.dayOfMonth > 0 ? Math.round(s.expense / s.dayOfMonth) : 0;
  const shown = sel ?? (s.isCurrentMonth ? s.dayOfMonth - 1 : null);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium">Per hari</span>
        <span className="text-stone-500">
          {shown != null ? (
            <>
              Tgl {shown + 1}: <span className="tabular font-medium text-stone-800 dark:text-stone-200">{formatRupiah(s.daily[shown] ?? 0)}</span>
            </>
          ) : (
            <>Rata-rata {formatRupiahShort(avg)}/hari</>
          )}
        </span>
      </div>
      <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="Grafik pengeluaran per hari">
        {s.daily.map((v, i) => {
          const future = s.isCurrentMonth && i + 1 > s.dayOfMonth;
          return (
            <button
              key={i}
              onClick={() => setSel(i === sel ? null : i)}
              aria-label={`Tanggal ${i + 1}: ${formatRupiah(v)}`}
              className={`flex-1 rounded-t ${future ? "bg-stone-100 dark:bg-stone-800/50" : i === shown ? "bg-brand-700" : "bg-brand-500/60 hover:bg-brand-600"}`}
              style={{ height: `${future ? 4 : Math.max(3, (v / max) * 100)}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-stone-400">
        <span>1</span>
        <span>{Math.ceil(s.daysInMonth / 2)}</span>
        <span>{s.daysInMonth}</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { accounts, category, version, bump } = useStore();
  const [month, setMonth] = useState(formatYm(parseYm(null)));
  const [adding, setAdding] = useState(false);
  const { toastEl, showToast } = useToast();
  const { data: s, error, loading } = useAsync(() => api<MonthSummaryDTO>(`/summary?month=${month}`), [month, version]);
  const active = accounts.filter((a) => !a.archived);
  const totalBalance = active.reduce((sum, a) => sum + a.balance, 0);
  const ym = parseYm(month);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <MonthSwitcher month={month} onChange={setMonth} />
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + Catat
        </button>
      </div>
      {toastEl}
      <ErrorNote message={error} />
      {loading && !s && <Spinner />}
      {s && (
        <>
          {(s.reviewCount > 0 || s.unparsedEmailCount > 0) && (
            <Link href="/tinjau" className="flex items-center justify-between rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <span>
                {s.reviewCount > 0 && <>{s.reviewCount} transaksi perlu dikategorikan</>}
                {s.reviewCount > 0 && s.unparsedEmailCount > 0 && " · "}
                {s.unparsedEmailCount > 0 && <>{s.unparsedEmailCount} email belum terbaca</>}
              </span>
              <span aria-hidden>›</span>
            </Link>
          )}

          <section className="card" aria-labelledby="pengeluaran">
            <p id="pengeluaran" className="text-sm text-stone-500">
              Pengeluaran {MONTHS_ID[ym.month - 1]}
            </p>
            <p className="tabular my-1 text-4xl font-bold tracking-tight">{formatRupiah(s.expense)}</p>
            <Comparison s={s} />
            {s.budget != null && (
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                  <div
                    className={`h-full rounded-full ${s.expense > s.budget ? "bg-rose-500" : "bg-brand-600"}`}
                    style={{ width: `${Math.min(100, (s.expense / s.budget) * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-sm">
                  {s.budgetRemaining! >= 0 ? (
                    <>
                      Sisa anggaran <Money value={s.budgetRemaining!} className="font-medium" />
                      {s.safePerDay != null && (
                        <>
                          {" "}· aman <Money value={s.safePerDay} className="font-semibold text-brand-700 dark:text-brand-500" />/hari
                        </>
                      )}
                    </>
                  ) : (
                    <span className="text-rose-700 dark:text-rose-400">
                      Lewat anggaran <Money value={-s.budgetRemaining!} className="font-medium" />
                    </span>
                  )}
                </p>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-stone-100 pt-3 text-sm dark:border-stone-800">
              <div>
                <p className="text-stone-500">Pemasukan</p>
                <Money value={s.income} className="font-semibold text-emerald-700 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-stone-500">Selisih</p>
                <Money value={s.net} sign className="font-semibold" />
              </div>
            </div>
            {s.transferTotal > 0 && (
              <p className="mt-3 text-xs text-stone-500">
                Transfer antar akunmu {formatRupiah(s.transferTotal)} tidak dihitung sebagai pengeluaran.
              </p>
            )}
          </section>

          {s.expense > 0 && (
            <section className="card">
              <DailyBars s={s} />
            </section>
          )}

          <section className="card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Per kategori</h2>
              <Link href={`/transaksi?month=${month}&type=expense`} className="text-sm text-brand-700 dark:text-brand-500">
                Lihat semua
              </Link>
            </div>
            {s.byCategory.length === 0 ? (
              <p className="text-sm text-stone-500">Belum ada pengeluaran bulan ini.</p>
            ) : (
              <ul className="space-y-3">
                {s.byCategory.map((g) => {
                  const c = category(g.categoryId);
                  const pct = s.expense ? (g.total / s.expense) * 100 : 0;
                  return (
                    <li key={g.categoryId ?? "none"}>
                      <button
                        className="w-full text-left"
                        onClick={() => navigate(`/transaksi?month=${month}&type=expense&categoryId=${g.categoryId ?? "none"}`)}
                      >
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <span aria-hidden>{c?.icon ?? "?"}</span>
                            {c?.name ?? "Belum dikategorikan"}
                            <span className="text-xs text-stone-400">{g.count}×</span>
                          </span>
                          <Money value={g.total} className="font-medium" />
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                          <div className={`h-full rounded-full ${c ? "bg-brand-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Saldo</h2>
          <Link href="/akun" className="text-sm text-brand-700 dark:text-brand-500">
            Kelola
          </Link>
        </div>
        <p className="text-xs text-stone-500">Saldo terpisah dari pengeluaran, sekarang</p>
        <p className="tabular mt-1 mb-3 text-2xl font-semibold">{formatRupiah(totalBalance)}</p>
        {active.length === 0 ? (
          <p className="text-sm text-stone-500">
            Belum ada akun. Akun dibuat otomatis saat email pertama masuk, atau <Link href="/akun" className="underline">tambah sendiri</Link>.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
            {active.map((a) => (
              <li key={a.id} className="flex justify-between py-2">
                <span>{a.name}</span>
                <Money value={a.balance} />
              </li>
            ))}
          </ul>
        )}
        {active.some((a) => a.balance < 0 && a.kind !== "other") && (
          <p className="mt-3 text-xs text-stone-500">
            Ada saldo minus? Akun yang dibuat otomatis belum tahu saldo awalnya. Buka{" "}
            <Link href="/akun" className="underline">Akun › Sesuaikan</Link> dan isi saldo sebenarnya.
          </p>
        )}
      </section>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Catat transaksi">
        <TxForm
          onDone={(msg) => {
            setAdding(false);
            bump();
            showToast(msg ?? "Tersimpan.");
          }}
        />
      </Sheet>
    </div>
  );
}
