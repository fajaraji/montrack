import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { ErrorNote, PageHeader, Spinner } from "../components/ui";
import { formatRupiah, parseRupiah } from "../../shared/money";
import { MONTHS_ID, parseYm } from "../../shared/time";
import type { CategoryDTO, MonthSummaryDTO, SettingsDTO } from "../../shared/types";

export function BudgetBar({ used, budget }: { used: number; budget: number }) {
  const pct = budget > 0 ? (used / budget) * 100 : 0;
  const color = pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-brand-600";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function BudgetRow({ c, spent }: { c: CategoryDTO; spent: number }) {
  const { bump } = useStore();
  const [value, setValue] = useState(c.monthlyBudget ? c.monthlyBudget.toLocaleString("id-ID") : "");
  const [saved, setSaved] = useState(false);
  const save = async () => {
    const n = parseRupiah(value);
    if ((n ?? null) === (c.monthlyBudget ?? null)) return;
    await api(`/categories/${c.id}`, { method: "PATCH", body: { monthlyBudget: n || null } });
    bump();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const budget = c.monthlyBudget ?? 0;
  return (
    <li className="space-y-1.5 py-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{c.icon} {c.name}</span>
        <input
          className="input tabular w-36 py-1.5 text-right text-sm"
          inputMode="numeric"
          placeholder="tanpa batas"
          value={value}
          aria-label={`Anggaran ${c.name}`}
          onChange={(e) => setValue(parseRupiah(e.target.value)?.toLocaleString("id-ID") ?? "")}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <span className="w-4 text-xs text-emerald-600">{saved ? "✓" : ""}</span>
      </div>
      {budget > 0 && (
        <>
          <BudgetBar used={spent} budget={budget} />
          <p className="text-xs text-stone-500">
            <span className="tabular">{formatRupiah(spent)}</span> dari <span className="tabular">{formatRupiah(budget)}</span>
            {spent <= budget ? <> · sisa <span className="tabular">{formatRupiah(budget - spent)}</span></> : <span className="text-rose-600"> · lewat <span className="tabular">{formatRupiah(spent - budget)}</span></span>}
          </p>
        </>
      )}
      {budget === 0 && spent > 0 && <p className="text-xs text-stone-400">Bulan ini <span className="tabular">{formatRupiah(spent)}</span></p>}
    </li>
  );
}

export function Budgets() {
  const { categories, version, bump } = useStore();
  const summary = useAsync(() => api<MonthSummaryDTO>("/summary"), [version]);
  const settings = useAsync(() => api<SettingsDTO>("/settings"), [version]);
  const [total, setTotal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ym = parseYm(null);
  if (!summary.data || !settings.data) return <Spinner />;
  const spent = new Map(summary.data.byCategory.map((g) => [g.categoryId, g.total]));
  const expenseCats = categories.filter((c) => c.kind === "expense" && !c.archived);
  const totalValue = total ?? (settings.data.monthlyBudget ? settings.data.monthlyBudget.toLocaleString("id-ID") : "");
  const sumCats = expenseCats.reduce((s, c) => s + (c.monthlyBudget ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Anggaran" />
      <p className="text-sm text-stone-500">
        Bulan {MONTHS_ID[ym.month - 1]}. Kamu akan diberi notifikasi saat pemakaian mencapai 80% dan 100%.
      </p>
      <section className="card space-y-2">
        <label className="label" htmlFor="total-budget">Total pengeluaran per bulan</label>
        <div className="flex gap-2">
          <input
            id="total-budget"
            className="input tabular"
            inputMode="numeric"
            placeholder="kosongkan jika tidak pakai"
            value={totalValue}
            onChange={(e) => setTotal(parseRupiah(e.target.value)?.toLocaleString("id-ID") ?? "")}
          />
          <button
            className="btn-primary"
            onClick={async () => {
              try {
                await api("/settings", { method: "PATCH", body: { monthlyBudget: parseRupiah(totalValue) || null } });
                setTotal(null);
                bump();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Simpan
          </button>
        </div>
        {settings.data.monthlyBudget ? (
          <>
            <BudgetBar used={summary.data.expense} budget={settings.data.monthlyBudget} />
            <p className="text-xs text-stone-500">
              <span className="tabular">{formatRupiah(summary.data.expense)}</span> terpakai
              {summary.data.safePerDay != null && <> · aman <span className="tabular">{formatRupiah(summary.data.safePerDay)}</span>/hari</>}
            </p>
          </>
        ) : null}
        {sumCats > 0 && <p className="text-xs text-stone-500">Jumlah anggaran per kategori: <span className="tabular">{formatRupiah(sumCats)}</span></p>}
        <ErrorNote message={error} />
      </section>
      <section className="card">
        <h2 className="font-semibold">Per kategori</h2>
        <p className="text-xs text-stone-500">Isi nominal lalu ketuk di luar kolom untuk menyimpan. Kosongkan untuk menghapus batas.</p>
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {expenseCats
            .sort((a, b) => (spent.get(b.id) ?? 0) - (spent.get(a.id) ?? 0))
            .map((c) => (
              <BudgetRow key={`${c.id}-${c.monthlyBudget}`} c={c} spent={spent.get(c.id) ?? 0} />
            ))}
        </ul>
      </section>
    </div>
  );
}
