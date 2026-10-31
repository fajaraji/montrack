import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { navigate, useLocation } from "../lib/router";
import { MonthSwitcher, Sheet, Spinner, Empty, ErrorNote, PageHeader } from "../components/ui";
import { TxForm, TxList, TYPE_LABEL } from "../components/tx";
import { formatRupiah } from "../../shared/money";
import { formatYm, parseYm } from "../../shared/time";
import type { TransactionDTO, TxType } from "../../shared/types";

export function Transactions() {
  const { search } = useLocation();
  const { accounts, categories, version } = useStore();
  const month = search.get("month") ?? formatYm(parseYm(null));
  const type = search.get("type") ?? "";
  const accountId = search.get("accountId") ?? "";
  const categoryId = search.get("categoryId") ?? "";
  const [q, setQ] = useState(search.get("q") ?? "");
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(location.search);
    if (v) p.set(k, v);
    else p.delete(k);
    if (!p.get("month")) p.set("month", month);
    navigate(`/transaksi?${p.toString()}`, { replace: true });
  };

  const params = new URLSearchParams({ month });
  if (type) params.set("type", type);
  if (accountId) params.set("accountId", accountId);
  if (categoryId) params.set("categoryId", categoryId);
  if (search.get("q")) params.set("q", search.get("q")!);
  const { data, error, loading } = useAsync(() => api<TransactionDTO[]>(`/transactions?${params}`), [params.toString(), version]);

  const expense = (data ?? []).filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const income = (data ?? []).filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const done = (msg?: string) => {
    setEditing(null);
    setAdding(false);
    if (msg) {
      setToast(msg);
      setTimeout(() => setToast(null), 3500);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Transaksi" right={<button className="btn-primary" onClick={() => setAdding(true)}>+ Catat</button>} />
      <MonthSwitcher month={month} onChange={(m) => setParam("month", m)} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setParam("q", q.trim());
        }}
      >
        <input className="input" placeholder="Cari merchant atau catatan" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari" />
        <button className="btn-outline">Cari</button>
      </form>
      <div className="grid grid-cols-3 gap-2">
        <select className="input px-2 text-sm" value={type} onChange={(e) => setParam("type", e.target.value)} aria-label="Jenis">
          <option value="">Semua jenis</option>
          {(Object.keys(TYPE_LABEL) as TxType[]).map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
        <select className="input px-2 text-sm" value={accountId} onChange={(e) => setParam("accountId", e.target.value)} aria-label="Akun">
          <option value="">Semua akun</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select className="input px-2 text-sm" value={categoryId} onChange={(e) => setParam("categoryId", e.target.value)} aria-label="Kategori">
          <option value="">Semua kategori</option>
          <option value="none">Belum dikategorikan</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
          ))}
        </select>
      </div>
      {toast && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{toast}</p>}
      <ErrorNote message={error} />
      {data && data.length > 0 && (
        <p className="text-sm text-stone-500">
          {data.length} transaksi · keluar <span className="tabular font-medium text-stone-800 dark:text-stone-200">{formatRupiah(expense)}</span>
          {income > 0 && <> · masuk <span className="tabular font-medium text-emerald-700 dark:text-emerald-400">{formatRupiah(income)}</span></>}
        </p>
      )}
      {loading && !data ? <Spinner /> : data && data.length === 0 ? <Empty title="Tidak ada transaksi" /> : data && <TxList items={data} onSelect={setEditing} />}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Ubah transaksi">
        {editing && <TxForm key={editing.id} initial={editing} onDone={done} />}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Catat transaksi">
        <TxForm onDone={done} />
      </Sheet>
    </div>
  );
}
