import { useMemo } from "react";
import { useStore } from "../lib/store";
import { Money } from "./ui";
import { dayLabel, txTitle } from "./tx";
import { formatRupiah } from "../../shared/money";
import { MONTHS_ID, wibDateKey, wibParts } from "../../shared/time";
import type { TransactionDTO } from "../../shared/types";

export const STATUS = {
  ok: { label: "Tercatat", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" },
  review: { label: "Perlu ditinjau", cls: "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200" },
  transfer: { label: "Transfer", cls: "bg-stone-100 text-stone-600 dark:bg-white/10 dark:text-stone-300" },
  excluded: { label: "Tidak dihitung", cls: "bg-stone-100 text-stone-500 dark:bg-white/10 dark:text-stone-400" },
};

export function txStatus(t: TransactionDTO) {
  if (t.type === "transfer" || t.type === "adjustment") return STATUS.transfer;
  if (t.status === "review") return STATUS.review;
  if (t.excluded) return STATUS.excluded;
  return STATUS.ok;
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * Daftar transaksi berupa baris ringkas (sama di HP dan desktop).
 * `grouped` = di HP dikelompokkan per hari dengan total harian.
 */
export function TxTable({ items, onOpen, grouped = false }: { items: TransactionDTO[]; onOpen: (t: TransactionDTO) => void; grouped?: boolean }) {
  const { category, account } = useStore();
  const accName = (id: number | null) => (id == null ? "?" : account(id)?.name ?? "?");
  const icon = (t: TransactionDTO) => (t.type === "transfer" ? "⇄" : t.type === "adjustment" ? "±" : category(t.categoryId)?.icon ?? "?");
  const sign = (t: TransactionDTO) => (t.type === "expense" ? -t.amount : t.amount);
  const amountCls = (t: TransactionDTO) =>
    `font-semibold ${t.type === "income" ? "text-emerald-600" : t.type === "transfer" || t.type === "adjustment" ? "text-stone-500" : ""} ${t.excluded ? "opacity-50 line-through" : ""}`;
  const groups = useMemo(() => {
    const m = new Map<string, TransactionDTO[]>();
    for (const t of items) {
      const k = wibDateKey(new Date(t.occurredAt));
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [items]);

  const row = (t: TransactionDTO, showDate: boolean) => {
    const p = wibParts(new Date(t.occurredAt));
    const c = category(t.categoryId);
    const st = txStatus(t);
    const meta =
      t.type === "transfer"
        ? `${accName(t.accountId)} → ${accName(t.toAccountId)}`
        : `${t.type === "adjustment" ? "Penyesuaian" : c?.name ?? "Belum dikategorikan"} · ${accName(t.accountId)}`;
    return (
      <li key={t.id}>
        <button className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-white/[0.04] active:bg-white/[0.06] md:py-3" onClick={() => onOpen(t)}>
          <span className="icon-tile size-9 text-base">{icon(t)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{txTitle(t, accName)}</span>
            <span className="block truncate text-xs text-stone-400">
              {showDate ? `${p.day} ${MONTHS_ID[p.month - 1].slice(0, 3)} · ` : `${two(p.hour)}.${two(p.minute)} · `}
              {meta}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <Money value={sign(t)} sign={t.type === "income"} className={`block text-sm ${amountCls(t)}`} />
            {st !== STATUS.ok && <span className={`badge mt-0.5 px-2 text-[10px] ${st.cls}`}>{st.label}</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <>
      <div>
        {grouped ? (
          groups.map(([day, list]) => {
            const counted = list.filter((t) => !t.excluded);
            const out = counted.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
            const inc = counted.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
            return (
              <section key={day}>
                <header className="flex items-center justify-between pt-4 pb-1 text-xs">
                  <span className="font-bold tracking-wide text-stone-500 uppercase">{dayLabel(day)}</span>
                  <span className="tabular text-stone-400">
                    {inc > 0 && <span className="mr-2 text-emerald-600">+{formatRupiah(inc)}</span>}
                    {out > 0 && <span>−{formatRupiah(out)}</span>}
                  </span>
                </header>
                <ul className="divide-y divide-stone-100 dark:divide-white/5">{list.map((t) => row(t, false))}</ul>
              </section>
            );
          })
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-white/5">{items.map((t) => row(t, true))}</ul>
        )}
      </div>
    </>
  );
}
