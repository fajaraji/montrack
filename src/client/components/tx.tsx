import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { Money, ErrorNote } from "./ui";
import { formatRupiah, parseRupiah } from "../../shared/money";
import { wibDateKey, wibParts, fromWib, MONTHS_ID } from "../../shared/time";
import type { CategoryDTO, TransactionDTO, TxType } from "../../shared/types";

export const TYPE_LABEL: Record<TxType, string> = {
  expense: "Pengeluaran",
  income: "Pemasukan",
  transfer: "Transfer",
  adjustment: "Penyesuaian",
};

export function txTitle(t: TransactionDTO, accName: (id: number | null) => string): string {
  if (t.merchant) return t.merchant;
  if (t.type === "transfer") return `${accName(t.accountId)} → ${accName(t.toAccountId)}`;
  return t.description ?? TYPE_LABEL[t.type];
}

/** Tampilan nominal: pengeluaran negatif, pemasukan positif, transfer netral. */
export function TxAmount({ t }: { t: TransactionDTO }) {
  if (t.type === "expense") return <Money value={-t.amount} className="font-medium" />;
  if (t.type === "income") return <Money value={t.amount} sign className="font-medium text-emerald-700 dark:text-emerald-400" />;
  if (t.type === "adjustment") return <Money value={t.amount} sign className="text-stone-500" />;
  return <span className="tabular text-stone-500">{formatRupiah(t.amount)}</span>;
}

export function TxRow({ t, onClick }: { t: TransactionDTO; onClick?: () => void }) {
  const { category, account } = useStore();
  const cat = category(t.categoryId);
  const accName = (id: number | null) => (id == null ? "?" : account(id)?.name ?? "?");
  const p = wibParts(new Date(t.occurredAt));
  const meta =
    t.type === "transfer"
      ? `Transfer · ${accName(t.accountId)} → ${accName(t.toAccountId)}`
      : t.type === "adjustment"
        ? `Penyesuaian saldo · ${accName(t.accountId)}`
        : `${cat?.name ?? "Belum dikategorikan"} · ${accName(t.accountId)}`;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50 rounded-xl">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-lg dark:bg-stone-800" aria-hidden>
        {t.type === "transfer" ? "⇄" : t.type === "adjustment" ? "±" : cat?.icon ?? "?"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{txTitle(t, accName)}</span>
        <span className="block truncate text-xs text-stone-500">
          {meta} · {String(p.hour).padStart(2, "0")}.{String(p.minute).padStart(2, "0")}
          {t.status === "review" && <span className="ml-1 text-amber-600">· perlu ditinjau</span>}
        </span>
      </span>
      <TxAmount t={t} />
    </button>
  );
}

export function dayLabel(key: string): string {
  const today = wibDateKey(new Date());
  const yesterday = wibDateKey(new Date(Date.now() - 86400_000));
  if (key === today) return "Hari ini";
  if (key === yesterday) return "Kemarin";
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  return `${days[dow]}, ${d} ${MONTHS_ID[m - 1]}`;
}

export function TxList({ items, onSelect }: { items: TransactionDTO[]; onSelect: (t: TransactionDTO) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, TransactionDTO[]>();
    for (const t of items) {
      const k = wibDateKey(new Date(t.occurredAt));
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [items]);
  return (
    <div className="space-y-4">
      {groups.map(([day, list]) => {
        const out = list.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
        const inc = list.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
        return (
          <section key={day} className="card px-3 py-2">
            <header className="flex items-center justify-between px-1 py-1.5 text-sm">
              <span className="font-semibold">{dayLabel(day)}</span>
              <span className="tabular text-stone-500">
                {inc > 0 && <span className="mr-2 text-emerald-700 dark:text-emerald-400">+{formatRupiah(inc)}</span>}
                {out > 0 && <span>−{formatRupiah(out)}</span>}
              </span>
            </header>
            <div className="divide-y divide-stone-100 dark:divide-stone-800">
              {list.map((t) => (
                <TxRow key={t.id} t={t} onClick={() => onSelect(t)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function CategoryGrid({
  kind,
  value,
  onPick,
}: {
  kind: "expense" | "income";
  value: number | null;
  onPick: (c: CategoryDTO) => void;
}) {
  const { categories } = useStore();
  const list = categories.filter((c) => c.kind === kind && !c.archived);
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((c) => (
        <button
          type="button"
          key={c.id}
          onClick={() => onPick(c)}
          className={`chip ${value === c.id ? "border-brand-600 bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100" : ""}`}
        >
          <span aria-hidden>{c.icon}</span>
          {c.name}
        </button>
      ))}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const p = wibParts(new Date(iso));
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}
function fromLocalInput(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date().toISOString();
  return fromWib(+m[1], +m[2], +m[3], +m[4], +m[5]).toISOString();
}

/** Form tambah/ubah transaksi. */
export function TxForm({ initial, onDone }: { initial?: TransactionDTO; onDone: (msg?: string) => void }) {
  const { accounts, bump } = useStore();
  const active = accounts.filter((a) => !a.archived);
  const [type, setType] = useState<TxType>(initial?.type ?? "expense");
  const [amount, setAmount] = useState(initial ? String(Math.abs(initial.amount)) : "");
  const [negative, setNegative] = useState(initial ? initial.amount < 0 : false);
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? active[0]?.id ?? null);
  const [toAccountId, setToAccountId] = useState<number | null>(initial?.toAccountId ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? null);
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [when, setWhen] = useState(toLocalInput(initial?.occurredAt ?? new Date().toISOString()));
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categoryChanged = categoryId !== (initial?.categoryId ?? null);

  async function save() {
    setError(null);
    const n = parseRupiah(amount);
    if (!n || n <= 0) return setError("Isi nominal");
    setBusy(true);
    try {
      const body = {
        type,
        amount: type === "adjustment" && negative ? -n : n,
        accountId,
        toAccountId: type === "transfer" ? toAccountId : null,
        categoryId: type === "expense" || type === "income" ? categoryId : null,
        merchant,
        description,
        occurredAt: fromLocalInput(when),
        remember: remember && categoryChanged && !!merchant.trim(),
      };
      const r = initial
        ? await api<{ learned: number }>(`/transactions/${initial.id}`, { method: "PATCH", body })
        : await api<{ learned: number }>("/transactions", { body });
      bump();
      onDone(r.learned > 0 ? `Kategori juga diterapkan ke ${r.learned} transaksi lain.` : undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || !confirm("Hapus transaksi ini?")) return;
    setBusy(true);
    try {
      await api(`/transactions/${initial.id}`, { method: "DELETE" });
      bump();
      onDone("Transaksi dihapus.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-stone-100 p-1 text-sm dark:bg-stone-800">
        {(["expense", "income", "transfer", "adjustment"] as TxType[]).map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => {
              setType(t);
              if (t !== type) setCategoryId(null);
            }}
            className={`rounded-lg py-1.5 ${type === t ? "bg-white font-semibold shadow-sm dark:bg-stone-950" : "text-stone-600 dark:text-stone-400"}`}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      {type === "transfer" && (
        <p className="text-xs text-stone-500">Transfer = pindah uang antar akunmu sendiri (mis. top-up GoPay). Tidak dihitung sebagai pengeluaran.</p>
      )}
      {type === "adjustment" && (
        <p className="text-xs text-stone-500">Penyesuaian hanya mengoreksi saldo akun, tidak dihitung sebagai pengeluaran/pemasukan.</p>
      )}

      <div>
        <label className="label" htmlFor="tx-amount">Nominal</label>
        <div className="flex gap-2">
          {type === "adjustment" && (
            <button type="button" className="btn-outline w-12" onClick={() => setNegative(!negative)}>
              {negative ? "−" : "+"}
            </button>
          )}
          <input
            id="tx-amount"
            className="input tabular text-lg"
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              const n = parseRupiah(e.target.value);
              setAmount(n == null ? "" : n.toLocaleString("id-ID"));
            }}
            autoFocus={!initial}
          />
        </div>
      </div>

      <div className={type === "transfer" ? "grid grid-cols-2 gap-3" : ""}>
        <div>
          <label className="label" htmlFor="tx-account">{type === "transfer" ? "Dari akun" : "Akun"}</label>
          <select id="tx-account" className="input" value={accountId ?? ""} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
            {type === "transfer" && <option value="">(tidak diketahui)</option>}
            {active.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        {type === "transfer" && (
          <div>
            <label className="label" htmlFor="tx-to">Ke akun</label>
            <select id="tx-to" className="input" value={toAccountId ?? ""} onChange={(e) => setToAccountId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">(tidak diketahui)</option>
              {active.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {(type === "expense" || type === "income") && (
        <div>
          <span className="label">Kategori</span>
          <CategoryGrid kind={type} value={categoryId} onPick={(c) => setCategoryId(c.id === categoryId ? null : c.id)} />
        </div>
      )}

      <div>
        <label className="label" htmlFor="tx-merchant">{type === "income" ? "Dari" : "Merchant / keterangan"}</label>
        <input id="tx-merchant" className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="mis. Kopi Senja" />
      </div>

      {(type === "expense" || type === "income") && categoryChanged && merchant.trim() && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-brand-700" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Ingat kategori ini untuk “{merchant.trim()}” berikutnya</span>
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tx-when">Waktu</label>
          <input id="tx-when" type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="tx-note">Catatan</label>
          <input id="tx-note" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {initial && initial.source !== "manual" && (
        <p className="text-xs text-stone-500">Sumber: {initial.source === "email" ? "email otomatis" : "impor mutasi"}</p>
      )}
      <ErrorNote message={error} />
      <div className="flex gap-2">
        {initial && (
          <button type="button" className="btn-outline text-rose-700" onClick={remove} disabled={busy}>
            Hapus
          </button>
        )}
        <button type="submit" className="btn-primary flex-1" disabled={busy}>
          {busy ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </form>
  );
}
