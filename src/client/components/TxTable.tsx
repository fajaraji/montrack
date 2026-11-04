import { useMemo } from "react";
import { useStore } from "../lib/store";
import { Money } from "./ui";
import { Icon } from "./Icon";
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
 * Daftar transaksi: tabel di layar lebar, baris ringkas di HP.
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
        <button className="flex w-full items-center gap-3 py-2.5 text-left active:bg-stone-50 dark:active:bg-white/5" onClick={() => onOpen(t)}>
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
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="text-left text-[11px] tracking-wider text-stone-400 uppercase">
            <th className="pb-3 font-semibold">Aktivitas</th>
            <th className="pb-3 font-semibold">Kategori</th>
            <th className="pb-3 text-right font-semibold">Nominal</th>
            <th className="pb-3 pl-6 font-semibold">Status</th>
            <th className="pb-3 font-semibold">Tanggal</th>
            <th className="pb-3 text-right font-semibold">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-white/5">
          {items.map((t) => {
            const st = txStatus(t);
            const p = wibParts(new Date(t.occurredAt));
            return (
              <tr key={t.id} className="cursor-pointer hover:bg-stone-50/70 dark:hover:bg-white/5" onClick={() => onOpen(t)}>
                <td className="py-3 pr-3">
                  <span className="flex items-center gap-3">
                    <span className="icon-tile text-base">{icon(t)}</span>
                    <span className="min-w-0">
                      <span className="block max-w-64 truncate font-semibold">{txTitle(t, accName)}</span>
                      <span className="block text-xs text-stone-400">
                        {t.type === "transfer" ? `${accName(t.accountId)} → ${accName(t.toAccountId)}` : accName(t.accountId)}
                        {t.splitGroupId != null && " · dibagi"}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="py-3 pr-3 text-stone-500">{t.type === "transfer" ? "Transfer" : t.type === "adjustment" ? "Penyesuaian" : category(t.categoryId)?.name ?? "—"}</td>
                <td className="py-3 text-right whitespace-nowrap">
                  <Money value={sign(t)} sign={t.type === "income"} className={amountCls(t)} />
                </td>
                <td className="py-3 pl-6">
                  <span className={`badge whitespace-nowrap ${st.cls}`}>
                    <span className="size-1.5 rounded-full bg-current" />
                    {st.label}
                  </span>
                </td>
                <td className="py-3 whitespace-nowrap text-stone-500">
                  {p.day} {MONTHS_ID[p.month - 1].slice(0, 3)} {p.year}, {two(p.hour)}.{two(p.minute)}
                </td>
                <td className="py-3 text-right text-stone-400">
                  <span className="inline-flex">
                    <Icon name="more" />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="md:hidden">
        {grouped ? (
          groups.map(([day, list]) => {
            const counted = list.filter((t) => !t.excluded);
            const out = counted.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
            const inc = counted.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
            return (
              <section key={day}>
                <header className="sticky top-0 z-10 -mx-5 flex items-center justify-between bg-white/95 px-5 pt-3 pb-1 text-xs backdrop-blur dark:bg-[#0f0f11]/80">
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
