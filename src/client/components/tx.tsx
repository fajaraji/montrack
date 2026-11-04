import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { ErrorNote, type ToastAction } from "./ui";
import { formatRupiah, parseRupiah } from "../../shared/money";
import { wibDateKey, wibParts, fromWib, MONTHS_ID } from "../../shared/time";
import type { CategoryDTO, TransactionDTO, TxType, UndoPayload } from "../../shared/types";

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

/**
 * Pemilih kategori: saran di depan, daftar lengkap bisa dicari, dan "+ Kategori baru".
 * `collapsed` = tampilkan hanya saran + tombol "Kategori lain…" (dipakai di Tinjau).
 */
export function CategoryGrid({
  kind,
  value,
  onPick,
  suggested = [],
  collapsed = false,
}: {
  kind: "expense" | "income";
  value: number | null;
  onPick: (c: CategoryDTO) => void;
  suggested?: number[];
  collapsed?: boolean;
}) {
  const { categories, refresh } = useStore();
  const all = categories.filter((c) => c.kind === kind && !c.archived);
  const sugg = suggested.map((id) => all.find((c) => c.id === id)).filter((c): c is CategoryDTO => !!c);
  const [expanded, setExpanded] = useState(!collapsed);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🏷️");
  const [error, setError] = useState<string | null>(null);

  const rest = all.filter((c) => !sugg.includes(c) && c.name.toLowerCase().includes(q.trim().toLowerCase()));

  async function create() {
    setError(null);
    try {
      const c = await api<CategoryDTO>("/categories", { body: { name, icon, kind } });
      await refresh();
      setAdding(false);
      setName("");
      onPick(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const chip = (c: CategoryDTO, hint = false) => (
    <button
      type="button"
      key={c.id}
      onClick={() => onPick(c)}
      className={`chip ${
        value === c.id
          ? "border-brand-600 bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
          : hint
            ? "border-brand-200 bg-brand-50/60 dark:border-brand-900 dark:bg-brand-900/20"
            : ""
      }`}
    >
      <span aria-hidden>{c.icon}</span>
      {c.name}
    </button>
  );

  return (
    <div className="space-y-2">
      {sugg.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sugg.map((c) => chip(c, true))}
          {!expanded && (
            <button type="button" className="chip text-stone-600 dark:text-stone-300" onClick={() => setExpanded(true)}>
              Kategori lain…
            </button>
          )}
        </div>
      )}
      {expanded && (
        <>
          {all.length > 10 && (
            <input className="input py-2 text-sm" placeholder="Cari kategori" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari kategori" />
          )}
          <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto">
            {rest.map((c) => chip(c))}
            {!adding && (
              <button
                type="button"
                className="chip border-dashed text-brand-700 dark:text-brand-500"
                onClick={() => {
                  setAdding(true);
                  setName(q.trim());
                }}
              >
                + Kategori baru
              </button>
            )}
          </div>
        </>
      )}
      {adding && (
        <div className="flex gap-2">
          <input className="input w-16 text-center" value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="Ikon kategori" />
          <input
            className="input"
            placeholder={kind === "expense" ? "mis. Kursus, AI, Hewan Peliharaan" : "mis. Jualan Online"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (name.trim()) void create();
              }
            }}
            aria-label="Nama kategori baru"
            autoFocus
          />
          <button type="button" className="btn-primary" disabled={!name.trim()} onClick={create}>
            Tambah
          </button>
          <button type="button" className="btn-ghost px-2" onClick={() => setAdding(false)} aria-label="Batal tambah kategori">
            ✕
          </button>
        </div>
      )}
      <ErrorNote message={error} />
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

interface MerchantSuggestion {
  merchant: string;
  categoryId: number | null;
  accountId: number | null;
  amount: number;
  n: number;
}

/** Ganti nama merchant: berlaku untuk transaksi lama & email berikutnya. */
function RenameMerchant({ t, onDone }: { t: TransactionDTO; onDone: (msg: string) => void }) {
  const { bump } = useStore();
  const raw = t.rawMerchant ?? t.merchant ?? "";
  const [name, setName] = useState(t.merchant ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-xl bg-stone-50 p-3 dark:bg-stone-800/60">
      <p className="text-xs text-stone-500">
        Nama asli: <span className="font-mono">{raw}</span>. Semua transaksi dari merchant ini (termasuk email berikutnya) akan memakai nama baru.
      </p>
      <div className="flex gap-2">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nama merchant baru" autoFocus />
        <button
          type="button"
          className="btn-primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const r = await api<{ applied: number }>("/renames", { body: { raw, name } });
              bump();
              onDone(`Nama diganti menjadi “${name.trim()}” di ${r.applied} transaksi.`);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Simpan
        </button>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

/** Bagi satu transaksi ke beberapa kategori (total tetap sama). */
function SplitEditor({ t, onDone }: { t: TransactionDTO; onDone: (msg: string) => void }) {
  const { bump, categories } = useStore();
  const kind = t.type === "income" ? "income" : "expense";
  const cats = categories.filter((c) => c.kind === kind && !c.archived);
  const [group, setGroup] = useState<TransactionDTO[] | null>(null);
  const [parts, setParts] = useState<{ amount: string; categoryId: number | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const rootId = t.splitGroupId ?? t.id;

  useEffect(() => {
    api<TransactionDTO[]>(`/transactions/${t.id}/split`).then((g) => {
      setGroup(g);
      const total = g.reduce((s, x) => s + x.amount, 0);
      setParts(
        g.length > 1
          ? g.map((x) => ({ amount: x.amount.toLocaleString("id-ID"), categoryId: x.categoryId }))
          : [
              { amount: Math.ceil(total / 2).toLocaleString("id-ID"), categoryId: t.categoryId },
              { amount: Math.floor(total / 2).toLocaleString("id-ID"), categoryId: null },
            ],
      );
    });
  }, [t.id, t.categoryId]);

  if (!group) return <p className="text-sm text-stone-500">Memuat…</p>;
  const total = group.reduce((s, x) => s + x.amount, 0);
  const sum = parts.reduce((s, p) => s + (parseRupiah(p.amount) ?? 0), 0);
  const left = total - sum;

  return (
    <div className="space-y-2 rounded-xl bg-stone-50 p-3 dark:bg-stone-800/60">
      <p className="text-xs text-stone-500">Total {formatRupiah(total)} dibagi ke beberapa kategori. Saldo akun tidak berubah.</p>
      {parts.map((p, i) => (
        <div key={i} className="flex gap-2">
          <input
            className="input tabular w-32"
            inputMode="numeric"
            value={p.amount}
            aria-label={`Nominal bagian ${i + 1}`}
            onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: parseRupiah(e.target.value)?.toLocaleString("id-ID") ?? "" } : x)))}
          />
          <select
            className="input"
            value={p.categoryId ?? ""}
            aria-label={`Kategori bagian ${i + 1}`}
            onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, categoryId: e.target.value ? Number(e.target.value) : null } : x)))}
          >
            <option value="">Pilih kategori</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
          {parts.length > 2 && (
            <button type="button" className="btn-ghost px-2" aria-label={`Hapus bagian ${i + 1}`} onClick={() => setParts(parts.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="text-brand-700 dark:text-brand-500" onClick={() => setParts([...parts, { amount: left > 0 ? left.toLocaleString("id-ID") : "", categoryId: null }])}>
          + Bagian
        </button>
        <span className={left === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}>
          {left === 0 ? "Pas ✓" : `Sisa ${formatRupiah(left)}`}
        </span>
      </div>
      <ErrorNote message={error} />
      <div className="flex gap-2">
        {group.length > 1 && (
          <button
            type="button"
            className="btn-outline"
            onClick={async () => {
              await api(`/transactions/${rootId}/unsplit`, { method: "POST" });
              bump();
              onDone("Transaksi digabung kembali.");
            }}
          >
            Gabungkan lagi
          </button>
        )}
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={left !== 0}
          onClick={async () => {
            try {
              await api(`/transactions/${rootId}/split`, {
                body: { parts: parts.map((p) => ({ amount: parseRupiah(p.amount) ?? 0, categoryId: p.categoryId })) },
              });
              bump();
              onDone(`Dibagi menjadi ${parts.length} bagian.`);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Simpan pembagian
        </button>
      </div>
    </div>
  );
}

/** Form tambah/ubah transaksi. `quick` = tampilkan saran merchant yang sering dipakai. */
export function TxForm({
  initial,
  onDone,
  quick = false,
  initialType,
}: {
  initial?: TransactionDTO;
  onDone: (msg?: string, undo?: UndoPayload) => void;
  quick?: boolean;
  initialType?: TxType;
}) {
  const { accounts, bump } = useStore();
  const active = accounts.filter((a) => !a.archived);
  const [type, setType] = useState<TxType>(initial?.type ?? initialType ?? "expense");
  const [amount, setAmount] = useState(initial ? Math.abs(initial.amount).toLocaleString("id-ID") : "");
  const [negative, setNegative] = useState(initial ? initial.amount < 0 : false);
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? active[0]?.id ?? null);
  const [toAccountId, setToAccountId] = useState<number | null>(initial?.toAccountId ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? null);
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [when, setWhen] = useState(toLocalInput(initial?.occurredAt ?? new Date().toISOString()));
  const [excluded, setExcluded] = useState(initial?.excluded ?? false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"none" | "rename" | "split">("none");
  const [suggestions, setSuggestions] = useState<MerchantSuggestion[]>([]);

  useEffect(() => {
    if (!quick || initial || initialType) return;
    api<MerchantSuggestion[]>("/suggestions/merchants").then(setSuggestions).catch(() => {});
  }, [quick, initial]);

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
        excluded,
        remember: remember && categoryChanged && !!merchant.trim(),
      };
      const r = initial
        ? await api<{ learned: number; undo?: UndoPayload }>(`/transactions/${initial.id}`, { method: "PATCH", body })
        : await api<{ learned: number; undo?: UndoPayload }>("/transactions", { body });
      bump();
      onDone(r.learned > 0 ? `Tersimpan. Kategori juga diterapkan ke ${r.learned} transaksi serupa.` : "Tersimpan.", r.undo);
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
      {suggestions.length > 0 && (
        <div>
          <span className="label">Sering dicatat</span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {suggestions.map((s) => (
              <button
                type="button"
                key={s.merchant}
                className="chip shrink-0"
                onClick={() => {
                  setType("expense");
                  setMerchant(s.merchant);
                  setCategoryId(s.categoryId);
                  if (s.accountId) setAccountId(s.accountId);
                  setAmount(s.amount.toLocaleString("id-ID"));
                }}
              >
                {s.merchant} <span className="tabular text-xs text-stone-500">{formatRupiah(s.amount)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="tx-merchant">{type === "income" ? "Dari" : "Merchant / keterangan"}</label>
          {initial?.merchant && (
            <button type="button" className="text-xs text-brand-700 dark:text-brand-500" onClick={() => setPanel(panel === "rename" ? "none" : "rename")}>
              Ganti nama merchant
            </button>
          )}
        </div>
        <input id="tx-merchant" className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="mis. Kopi Senja" />
      </div>
      {panel === "rename" && initial && <RenameMerchant t={initial} onDone={(m) => onDone(m)} />}

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

      {(type === "expense" || type === "income") && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-brand-700" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
          <span>
            Jangan hitung di laporan
            <span className="block text-xs text-stone-500">Untuk reimburse kantor, titipan, atau uang orang lain. Saldo akun tetap dihitung.</span>
          </span>
        </label>
      )}

      {initial && (initial.type === "expense" || initial.type === "income") && (
        <div>
          <button type="button" className="text-sm text-brand-700 dark:text-brand-500" onClick={() => setPanel(panel === "split" ? "none" : "split")}>
            {initial.splitGroupId != null ? "Ubah pembagian kategori" : "Bagi ke beberapa kategori"}
          </button>
          {panel === "split" && (
            <div className="mt-2">
              <SplitEditor t={initial} onDone={(m) => onDone(m)} />
            </div>
          )}
        </div>
      )}

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

/** Aksi "Batalkan" untuk toast, mengembalikan perubahan lewat POST /api/undo. */
export function undoAction(undo: UndoPayload | undefined, after: () => void): ToastAction | undefined {
  if (!undo || (!undo.transactions.length && !undo.deleteIds?.length)) return undefined;
  return {
    label: "Batalkan",
    run: async () => {
      await api("/undo", { body: undo });
      after();
    },
  };
}
