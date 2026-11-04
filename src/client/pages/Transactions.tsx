import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { navigate, useLocation } from "../lib/router";
import { MonthSwitcher, Sheet, Spinner, Empty, ErrorNote, useToast } from "../components/ui";
import { TxForm, TYPE_LABEL, undoAction } from "../components/tx";
import { TxTable } from "../components/TxTable";
import { Icon } from "../components/Icon";
import { formatRupiah, formatRupiahShort } from "../../shared/money";
import { MONTHS_ID, formatYm, parseYm } from "../../shared/time";
import type { TransactionDTO, TxType, UndoPayload } from "../../shared/types";

export function Transactions() {
  const { search } = useLocation();
  const { accounts, categories, account, category, version, bump } = useStore();
  const month = search.get("month") ?? formatYm(parseYm(null));
  const type = search.get("type") ?? "";
  const accountId = search.get("accountId") ?? "";
  const categoryId = search.get("categoryId") ?? "";
  const qParam = search.get("q") ?? "";
  const [q, setQ] = useState(qParam);
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const { toastEl, showToast } = useToast();

  const setParams = (patch: Record<string, string>) => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!p.get("month")) p.set("month", month);
    navigate(`/transaksi?${p.toString()}`, { replace: true });
  };

  const params = new URLSearchParams({ month });
  if (type) params.set("type", type);
  if (accountId) params.set("accountId", accountId);
  if (categoryId) params.set("categoryId", categoryId);
  if (qParam) params.set("q", qParam);
  const { data, error, loading } = useAsync(() => api<TransactionDTO[]>(`/transactions?${params}`), [params.toString(), version]);

  const counted = (data ?? []).filter((t) => !t.excluded);
  const expense = counted.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const income = counted.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const ym = parseYm(month);

  const active: { key: string; label: string }[] = [];
  if (type) active.push({ key: "type", label: TYPE_LABEL[type as TxType] ?? type });
  if (accountId) active.push({ key: "accountId", label: account(Number(accountId))?.name ?? "Akun" });
  if (categoryId) active.push({ key: "categoryId", label: categoryId === "none" ? "Belum dikategorikan" : `${category(Number(categoryId))?.icon ?? ""} ${category(Number(categoryId))?.name ?? "Kategori"}` });
  if (qParam) active.push({ key: "q", label: `“${qParam}”` });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Transaksi</h1>
          <p className="text-sm text-stone-500">
            {MONTHS_ID[ym.month - 1]} {ym.year}
          </p>
        </div>
        <div className="rounded-2xl bg-white px-1 dark:bg-white/[0.05] dark:backdrop-blur-xl">
          <MonthSwitcher month={month} onChange={(m) => setParams({ month: m })} />
        </div>
      </div>
      {toastEl}

      <div className="grid grid-cols-3 gap-3">
        <div className="card-accent p-4">
          <p className="text-xs font-medium text-white/85">Keluar</p>
          <p className="tabular mt-1 truncate text-base font-extrabold sm:text-xl" title={formatRupiah(expense)}>
            <span className="sm:hidden">{formatRupiahShort(expense)}</span>
            <span className="hidden sm:inline">{formatRupiah(expense)}</span>
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-stone-500">Masuk</p>
          <p className="tabular mt-1 truncate text-base font-extrabold text-emerald-600 sm:text-xl" title={formatRupiah(income)}>
            <span className="sm:hidden">{formatRupiahShort(income)}</span>
            <span className="hidden sm:inline">{formatRupiah(income)}</span>
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-stone-500">Transaksi</p>
          <p className="tabular mt-1 text-base font-extrabold sm:text-xl">{data?.length ?? "–"}</p>
        </div>
      </div>

      <section className="card">
        <div className="flex gap-2">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setParams({ q: q.trim() });
            }}
          >
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-stone-400" />
            <input className="input py-2 pl-10 text-sm" placeholder="Cari merchant atau catatan" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari" />
          </form>
          <button className="btn-outline relative py-2" onClick={() => setFilterOpen(true)}>
            Filter <Icon name="filter" className="size-4" />
            {active.filter((a) => a.key !== "q").length > 0 && (
              <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                {active.filter((a) => a.key !== "q").length}
              </span>
            )}
          </button>
        </div>
        {active.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {active.map((a) => (
              <button
                key={a.key}
                className="chip py-1 text-xs"
                onClick={() => {
                  if (a.key === "q") setQ("");
                  setParams({ [a.key]: "" });
                }}
                aria-label={`Hapus filter ${a.label}`}
              >
                {a.label} <span aria-hidden className="text-stone-400">✕</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-2">
          <ErrorNote message={error} />
          {loading && !data ? (
            <Spinner />
          ) : data && data.length === 0 ? (
            <Empty title="Tidak ada transaksi" />
          ) : (
            data && <TxTable items={data} onOpen={setEditing} grouped />
          )}
        </div>
      </section>

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter transaksi">
        <div className="space-y-4">
          <div>
            <span className="label">Jenis</span>
            <div className="flex flex-wrap gap-2">
              {[["", "Semua"], ...Object.entries(TYPE_LABEL)].map(([k, l]) => (
                <button key={k} className={`chip ${type === k ? "border-ink bg-ink text-white dark:border-white dark:bg-white dark:text-ink" : ""}`} onClick={() => setParams({ type: k })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="f-acc">Akun</label>
            <select id="f-acc" className="input" value={accountId} onChange={(e) => setParams({ accountId: e.target.value })}>
              <option value="">Semua akun</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-cat">Kategori</label>
            <select id="f-cat" className="input" value={categoryId} onChange={(e) => setParams({ categoryId: e.target.value })}>
              <option value="">Semua kategori</option>
              <option value="none">Belum dikategorikan</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn-outline flex-1" onClick={() => setParams({ type: "", accountId: "", categoryId: "" })}>
              Reset
            </button>
            <button className="btn-primary flex-1" onClick={() => setFilterOpen(false)}>
              Terapkan
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Ubah transaksi">
        {editing && (
          <TxForm
            key={editing.id}
            initial={editing}
            onDone={(msg?: string, undo?: UndoPayload) => {
              setEditing(null);
              if (msg) showToast(msg, undoAction(undo, bump));
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
