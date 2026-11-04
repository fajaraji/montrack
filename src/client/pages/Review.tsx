import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { getPref, setPref } from "../lib/prefs";
import { Empty, ErrorNote, Money, Sheet, Spinner, useToast } from "../components/ui";
import { CategoryGrid, TxForm, txTitle, undoAction } from "../components/tx";
import { Icon } from "../components/Icon";
import { MONTHS_ID, wibParts } from "../../shared/time";
import { providerLabel, type CategoryDTO, type InboxEmailDTO, type ReviewItemDTO, type SettingsDTO, type UndoPayload } from "../../shared/types";

const two = (n: number) => String(n).padStart(2, "0");

function ReviewRow({
  t,
  remember,
  selected,
  onSelect,
  onDone,
  onMore,
  onEdit,
}: {
  t: ReviewItemDTO;
  remember: boolean;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onDone: (msg: string, undo?: UndoPayload) => void;
  onMore: () => void;
  onEdit: () => void;
}) {
  const { account, category, bump } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = wibParts(new Date(t.occurredAt));
  const accName = (id: number | null) => (id == null ? "?" : account(id)?.name ?? "?");
  const isCat = t.type === "expense" || t.type === "income";
  const isBankTransfer = isCat && (t.description === "Transfer keluar" || t.description === "Transfer masuk");
  const sugg = t.suggestions.map((id) => category(id)).filter((c): c is CategoryDTO => !!c && !c.archived);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const pick = (c: CategoryDTO) =>
    run(async () => {
      const r = await api<{ learned: number; undo: UndoPayload }>(`/transactions/${t.id}`, {
        method: "PATCH",
        body: { categoryId: c.id, status: "ok", remember: remember && !!(t.merchant || t.description) },
      });
      bump();
      onDone(r.learned > 0 ? `Masuk ${c.name}, ${r.learned} transaksi serupa ikut.` : `Masuk ${c.name}.`, r.undo);
    });

  /** Transfer ke/dari rekening sendiri: jadikan transfer & ingat nama pemiliknya. */
  const markOwn = () =>
    run(async () => {
      const out = t.type === "expense";
      const r = await api<{ undo: UndoPayload }>(`/transactions/${t.id}`, {
        method: "PATCH",
        body: {
          type: "transfer",
          categoryId: null,
          accountId: out ? t.accountId : null,
          toAccountId: out ? null : t.accountId,
          description: out ? "Transfer ke rekening sendiri" : "Transfer dari rekening sendiri",
          status: "ok",
        },
      });
      if (t.merchant) {
        const s = await api<SettingsDTO>("/settings");
        if (!s.ownerNames.some((n) => n.toLowerCase() === t.merchant!.toLowerCase())) {
          await api("/settings", { method: "PATCH", body: { ownerNames: [...s.ownerNames, t.merchant] } });
        }
      }
      bump();
      onDone("Dicatat sebagai transfer antar rekeningmu.", r.undo);
    });

  const markOk = () =>
    run(async () => {
      const r = await api<{ undo: UndoPayload }>(`/transactions/${t.id}`, { method: "PATCH", body: { status: "ok" } });
      bump();
      onDone("Ditandai sudah benar.", r.undo);
    });

  return (
    <li className={`py-3 ${selected ? "-mx-3 rounded-2xl bg-brand-50/60 px-3 dark:bg-brand-500/10" : ""}`}>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          className="size-5 shrink-0 accent-[#111114]"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Pilih ${txTitle(t, accName)}`}
        />
        <button className="min-w-0 flex-1 text-left" onClick={onEdit}>
          <span className="block truncate text-sm font-semibold">{txTitle(t, accName)}</span>
          <span className="block truncate text-xs text-stone-400">
            {p.day} {MONTHS_ID[p.month - 1].slice(0, 3)} {two(p.hour)}.{two(p.minute)} · {accName(t.accountId)}
            {t.description && ` · ${t.description}`}
          </span>
        </button>
        <Money value={t.type === "expense" ? -t.amount : t.amount} sign={t.type === "income"} className={`shrink-0 text-sm font-bold ${t.type === "income" ? "text-emerald-600" : ""}`} />
      </div>
      <div className={`mt-2 -mr-5 flex gap-2 overflow-x-auto pr-5 pb-0.5 pl-8 [scrollbar-width:none] ${busy ? "pointer-events-none opacity-50" : ""}`}>
        {isBankTransfer && (
          <button className="chip shrink-0 border-ink bg-ink py-1 text-xs font-semibold text-white dark:border-white dark:bg-white dark:text-ink" onClick={markOwn}>
            <Icon name="swap" className="size-3.5" /> Rekening sendiri
          </button>
        )}
        {isCat &&
          sugg.map((c) => (
            <button key={c.id} className="chip shrink-0 py-1 text-xs" onClick={() => pick(c)}>
              <span aria-hidden>{c.icon}</span>
              {c.name}
            </button>
          ))}
        {isCat ? (
          <button className="chip shrink-0 py-1 text-xs text-stone-500" onClick={onMore}>
            Lainnya…
          </button>
        ) : (
          <>
            <button className="chip shrink-0 border-ink bg-ink py-1 text-xs font-semibold text-white dark:border-white dark:bg-white dark:text-ink" onClick={markOk}>
              ✓ Sudah benar
            </button>
            <button className="chip shrink-0 py-1 text-xs" onClick={onEdit}>
              Ubah
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-1 pl-8 text-xs text-rose-600">{error}</p>}
    </li>
  );
}

function EmailItem({ e, onChanged }: { e: InboxEmailDTO; onChanged: (msg: string) => void }) {
  const { bump } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3 text-sm">
      <div className="flex items-start gap-3">
        <span className="icon-tile size-9">
          <Icon name="bell" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{e.subject || "(tanpa subjek)"}</p>
          <p className="truncate text-xs text-stone-400">
            {providerLabel(e.provider) || e.fromAddr} · {e.note}
          </p>
          {open && <p className="mt-2 rounded-2xl bg-stone-50 p-3 text-xs whitespace-pre-wrap text-stone-600 dark:bg-white/5 dark:text-stone-300">{e.snippet}</p>}
          <div className="mt-2 flex gap-2">
            <button className="chip py-1 text-xs" onClick={() => setOpen(!open)}>{open ? "Tutup" : "Lihat isi"}</button>
            <button
              className="chip py-1 text-xs"
              onClick={async () => {
                const r = await api<{ status: string }>(`/inbox/${e.id}/reprocess`, { method: "POST" });
                bump();
                onChanged(r.status === "parsed" || r.status === "merged" ? "Berhasil dibaca." : "Masih belum terbaca.");
              }}
            >
              Baca ulang
            </button>
            <button
              className="chip py-1 text-xs text-stone-500"
              onClick={async () => {
                await api(`/inbox/${e.id}/ignore`, { method: "POST" });
                bump();
                onChanged("Email diabaikan.");
              }}
            >
              Abaikan
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

export function Review() {
  const { version, bump } = useStore();
  const [editing, setEditing] = useState<ReviewItemDTO | null>(null);
  const [picking, setPicking] = useState<ReviewItemDTO[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [remember, setRemember] = useState(getPref("rememberReview") !== "0");
  const [pickError, setPickError] = useState<string | null>(null);
  const { toastEl, showToast } = useToast();
  const txs = useAsync(() => api<ReviewItemDTO[]>("/review"), [version]);
  const emails = useAsync(() => api<InboxEmailDTO[]>("/inbox?status=unparsed"), [version]);
  const list = txs.data ?? [];
  const say = (m: string, undo?: UndoPayload) => {
    setSelected(new Set());
    showToast(m, undoAction(undo, bump));
  };

  async function bulk(body: Record<string, unknown>, msg: string) {
    const r = await api<{ undo: UndoPayload }>("/transactions/bulk", { body: { ids: [...selected], ...body } });
    bump();
    say(msg, r.undo);
  }

  // Panel kategori lengkap untuk satu atau beberapa transaksi.
  const pickKind = picking && new Set(picking.map((t) => (t.type === "income" ? "income" : "expense"))).size === 1 ? (picking[0].type === "income" ? "income" : "expense") : null;
  const pickSuggested = (() => {
    if (!picking) return [];
    const score = new Map<number, number>();
    for (const t of picking) t.suggestions.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 3 - i));
    return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  })();

  async function applyPick(c: CategoryDTO) {
    if (!picking) return;
    setPickError(null);
    try {
      if (picking.length === 1) {
        const t = picking[0];
        const r = await api<{ learned: number; undo: UndoPayload }>(`/transactions/${t.id}`, {
          method: "PATCH",
          body: { categoryId: c.id, status: "ok", remember: remember && !!(t.merchant || t.description) },
        });
        bump();
        setPicking(null);
        say(r.learned > 0 ? `Masuk ${c.name}, ${r.learned} transaksi serupa ikut.` : `Masuk ${c.name}.`, r.undo);
      } else {
        const r = await api<{ learned: number; undo: UndoPayload }>("/transactions/bulk", {
          body: { ids: picking.map((t) => t.id), categoryId: c.id, remember },
        });
        bump();
        setPicking(null);
        say(`${picking.length} transaksi masuk ${c.name}${r.learned ? `, ${r.learned} serupa ikut` : ""}.`, r.undo);
      }
    } catch (e) {
      setPickError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Tinjau</h1>
          <p className="text-sm text-stone-500">
            {list.length ? `${list.length} transaksi menunggu kategori` : "Ketuk kategori yang disarankan; salah pilih bisa dibatalkan."}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm dark:bg-[#18181b]">
          <span className="text-stone-600 dark:text-stone-300">Ingat untuk merchant sama</span>
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked);
              setPref("rememberReview", e.target.checked ? null : "0");
            }}
          />
          <span className="relative h-6 w-10 rounded-full bg-stone-300 transition peer-checked:bg-ink peer-focus-visible:ring-4 peer-focus-visible:ring-stone-900/10 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4 dark:peer-checked:bg-brand-500" />
        </label>
      </div>
      {toastEl}
      <ErrorNote message={txs.error} />

      {txs.loading && !txs.data ? (
        <Spinner />
      ) : list.length ? (
        <section className="card py-2">
          <label className="flex items-center gap-3 border-b border-stone-100 py-2 text-xs font-semibold tracking-wide text-stone-400 uppercase dark:border-white/5">
            <input
              type="checkbox"
              className="size-5 accent-[#111114]"
              checked={selected.size === list.length && list.length > 0}
              onChange={(e) => setSelected(e.target.checked ? new Set(list.map((t) => t.id)) : new Set())}
            />
            Pilih semua
          </label>
          <ul className="divide-y divide-stone-100 dark:divide-white/5">
            {list.map((t) => (
              <ReviewRow
                key={t.id}
                t={t}
                remember={remember}
                selected={selected.has(t.id)}
                onSelect={(v) => {
                  const next = new Set(selected);
                  if (v) next.add(t.id);
                  else next.delete(t.id);
                  setSelected(next);
                }}
                onDone={say}
                onMore={() => setPicking([t])}
                onEdit={() => setEditing(t)}
              />
            ))}
          </ul>
        </section>
      ) : (
        <Empty title="Semua sudah rapi 🎉">Tidak ada transaksi yang perlu ditinjau.</Empty>
      )}

      {emails.data && emails.data.length > 0 && (
        <section className="card py-3">
          <h2 className="font-bold">Email belum terbaca ({emails.data.length})</h2>
          <p className="text-xs text-stone-500">Formatnya belum dikenali. Catat manual, atau kirim contohnya agar bisa ditambahkan.</p>
          <ul className="divide-y divide-stone-100 dark:divide-white/5">
            {emails.data.map((e) => (
              <EmailItem key={e.id} e={e} onChanged={(m) => say(m)} />
            ))}
          </ul>
        </section>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-4 md:bottom-6">
          <div className="mx-auto flex max-w-lg items-center gap-2 rounded-3xl bg-ink p-2 pl-4 text-white shadow-2xl dark:bg-white dark:text-ink">
            <span className="flex-1 text-sm font-semibold">{selected.size} dipilih</span>
            <button className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-ink dark:bg-ink dark:text-white" onClick={() => setPicking(list.filter((t) => selected.has(t.id)))}>
              Kategori
            </button>
            <button className="rounded-2xl px-3 py-2 text-sm font-medium hover:bg-white/10" onClick={() => bulk({ status: "ok" }, `${selected.size} ditandai benar.`)}>
              Benar
            </button>
            <button className="rounded-2xl px-3 py-2 text-sm font-medium hover:bg-white/10" onClick={() => bulk({ excluded: true, status: "ok" }, `${selected.size} tidak dihitung di laporan.`)}>
              Abaikan
            </button>
          </div>
        </div>
      )}

      <Sheet open={!!picking} onClose={() => setPicking(null)} title={picking && picking.length > 1 ? `Kategori untuk ${picking.length} transaksi` : "Pilih kategori"}>
        {picking &&
          (pickKind ? (
            <div className="space-y-3">
              <CategoryGrid kind={pickKind} value={null} suggested={pickSuggested} onPick={applyPick} />
              <ErrorNote message={pickError} />
            </div>
          ) : (
            <p className="text-sm text-stone-500">Pilihan berisi pengeluaran dan pemasukan sekaligus. Pilih salah satu jenis saja.</p>
          ))}
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Ubah transaksi">
        {editing && (
          <TxForm
            key={editing.id}
            initial={editing}
            onDone={(m, undo) => {
              setEditing(null);
              say(m ?? "Tersimpan.", undo);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
