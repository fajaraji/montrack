import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { Empty, ErrorNote, PageHeader, Sheet, Spinner, useToast } from "../components/ui";
import { CategoryGrid, TxAmount, TxForm, txTitle, undoAction } from "../components/tx";
import { wibParts, MONTHS_ID } from "../../shared/time";
import { providerLabel, type InboxEmailDTO, type ReviewItemDTO, type SettingsDTO, type UndoPayload } from "../../shared/types";

function ReviewCard({
  t,
  selected,
  onSelect,
  onDone,
  onEdit,
}: {
  t: ReviewItemDTO;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onDone: (msg: string, undo?: UndoPayload) => void;
  onEdit: () => void;
}) {
  const { account, category, bump } = useStore();
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = wibParts(new Date(t.occurredAt));
  const kind = t.type === "income" ? "income" : "expense";
  const isBankTransfer = t.description === "Transfer keluar" || t.description === "Transfer masuk";

  async function pick(categoryId: number, categoryName?: string) {
    setBusy(true);
    try {
      const r = await api<{ learned: number; undo: UndoPayload }>(`/transactions/${t.id}`, {
        method: "PATCH",
        body: { categoryId, status: "ok", remember: remember && !!(t.merchant || t.description) },
      });
      bump();
      const name = categoryName ?? category(categoryId)?.name ?? "kategori";
      onDone(r.learned > 0 ? `Masuk ${name}, ${r.learned} transaksi serupa ikut.` : `Masuk ${name}.`, r.undo);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  /** Transfer ke/dari rekening sendiri: jadikan transfer & ingat nama pemiliknya. */
  async function markOwn() {
    setBusy(true);
    try {
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
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className={`card space-y-3 ${selected ? "ring-2 ring-brand-600" : ""}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-brand-700"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Pilih ${txTitle(t, (id) => account(id)?.name ?? "?")}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{txTitle(t, (id) => account(id)?.name ?? "?")}</p>
          <p className="text-xs text-stone-500">
            {p.day} {MONTHS_ID[p.month - 1]} {String(p.hour).padStart(2, "0")}.{String(p.minute).padStart(2, "0")} · {account(t.accountId)?.name ?? "?"}
            {t.description && ` · ${t.description}`}
          </p>
        </div>
        <TxAmount t={t} />
      </div>
      {isBankTransfer && (t.type === "expense" || t.type === "income") && (
        <button className="btn-outline w-full" onClick={markOwn} disabled={busy}>
          ⇄ Ini rekening saya sendiri (bukan {t.type === "expense" ? "pengeluaran" : "pemasukan"})
        </button>
      )}
      {t.type === "expense" || t.type === "income" ? (
        <>
          <div className={busy ? "pointer-events-none opacity-50" : ""}>
            <CategoryGrid kind={kind} value={t.categoryId} suggested={t.suggestions} collapsed onPick={(c) => pick(c.id, c.name)} />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-brand-700" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Ingat untuk merchant ini
            </label>
            <button className="text-brand-700 dark:text-brand-500" onClick={onEdit}>
              Ubah detail
            </button>
          </div>
        </>
      ) : (
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onEdit}>Ubah</button>
          <button
            className="btn-primary"
            onClick={async () => {
              const r = await api<{ undo: UndoPayload }>(`/transactions/${t.id}`, { method: "PATCH", body: { status: "ok" } });
              bump();
              onDone("Ditandai sudah benar.", r.undo);
            }}
          >
            Sudah benar
          </button>
        </div>
      )}
      <ErrorNote message={error} />
    </div>
  );
}

function EmailItem({ e, onChanged }: { e: InboxEmailDTO; onChanged: (msg: string) => void }) {
  const { bump } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <div className="card space-y-2 text-sm">
      <div className="flex justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{e.subject || "(tanpa subjek)"}</p>
          <p className="truncate text-xs text-stone-500">{providerLabel(e.provider) || e.fromAddr} · {e.note}</p>
        </div>
        <button className="text-xs text-brand-700 dark:text-brand-500" onClick={() => setOpen(!open)}>
          {open ? "Tutup" : "Lihat"}
        </button>
      </div>
      {open && <p className="rounded-xl bg-stone-50 p-2 text-xs whitespace-pre-wrap text-stone-600 dark:bg-stone-800 dark:text-stone-300">{e.snippet}</p>}
      <div className="flex gap-2">
        <button
          className="btn-outline py-1.5"
          onClick={async () => {
            const r = await api<{ status: string }>(`/inbox/${e.id}/reprocess`, { method: "POST" });
            bump();
            onChanged(r.status === "parsed" || r.status === "merged" ? "Berhasil dibaca." : "Masih belum terbaca.");
          }}
        >
          Baca ulang
        </button>
        <button
          className="btn-ghost py-1.5"
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
  );
}

/** Pilih kategori untuk banyak transaksi sekaligus. */
function BulkCategory({ items, onDone }: { items: ReviewItemDTO[]; onDone: (msg: string, undo?: UndoPayload) => void }) {
  const { bump } = useStore();
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const kinds = new Set(items.map((t) => (t.type === "income" ? "income" : "expense")));
  const kind = kinds.size === 1 ? [...kinds][0] : null;
  if (!kind) return <p className="text-sm text-stone-500">Pilihan berisi pengeluaran dan pemasukan sekaligus. Pilih salah satu jenis saja.</p>;
  // Saran gabungan: kategori yang paling sering disarankan untuk pilihan ini.
  const score = new Map<number, number>();
  for (const t of items) t.suggestions.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 3 - i));
  const suggested = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  return (
    <div className="space-y-3">
      <CategoryGrid
        kind={kind}
        value={null}
        suggested={suggested}
        onPick={async (c) => {
          try {
            const r = await api<{ learned: number; undo: UndoPayload }>("/transactions/bulk", {
              body: { ids: items.map((t) => t.id), categoryId: c.id, remember },
            });
            bump();
            onDone(`${items.length} transaksi masuk ${c.name}${r.learned ? `, ${r.learned} serupa ikut` : ""}.`, r.undo);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-brand-700" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Ingat untuk merchant-merchant ini
      </label>
      <ErrorNote message={error} />
    </div>
  );
}

export function Review() {
  const { version, bump } = useStore();
  const [editing, setEditing] = useState<ReviewItemDTO | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const { toastEl, showToast } = useToast();
  const txs = useAsync(() => api<ReviewItemDTO[]>("/review"), [version]);
  const emails = useAsync(() => api<InboxEmailDTO[]>("/inbox?status=unparsed"), [version]);
  const say = (m: string, undo?: UndoPayload) => {
    setSelected(new Set());
    showToast(m, undoAction(undo, bump));
  };
  const list = txs.data ?? [];
  const chosen = list.filter((t) => selected.has(t.id));

  async function bulk(body: Record<string, unknown>, msg: string) {
    const r = await api<{ undo: UndoPayload }>("/transactions/bulk", { body: { ids: [...selected], ...body } });
    bump();
    say(msg, r.undo);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Perlu ditinjau" />
      <p className="text-sm text-stone-500">
        Ketuk kategori yang disarankan, atau centang beberapa sekaligus. Salah pilih? Ketuk <b>Batalkan</b> di notifikasi bawah, atau ubah kapan saja di menu <b>Transaksi</b>.
      </p>
      {toastEl}
      <ErrorNote message={txs.error} />
      {list.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-brand-700"
            checked={selected.size === list.length}
            onChange={(e) => setSelected(e.target.checked ? new Set(list.map((t) => t.id)) : new Set())}
          />
          Pilih semua ({list.length})
        </label>
      )}
      {txs.loading && !txs.data ? (
        <Spinner />
      ) : list.length ? (
        <div className="space-y-3">
          {list.map((t) => (
            <ReviewCard
              key={t.id}
              t={t}
              selected={selected.has(t.id)}
              onSelect={(v) => {
                const next = new Set(selected);
                if (v) next.add(t.id);
                else next.delete(t.id);
                setSelected(next);
              }}
              onDone={say}
              onEdit={() => setEditing(t)}
            />
          ))}
        </div>
      ) : (
        <Empty title="Semua sudah rapi 🎉">Tidak ada transaksi yang perlu ditinjau.</Empty>
      )}

      {emails.data && emails.data.length > 0 && (
        <section className="space-y-3 pt-4">
          <h2 className="font-semibold">Email yang belum terbaca ({emails.data.length})</h2>
          <p className="text-sm text-stone-500">Format email ini belum dikenali. Catat manual, atau kirim contohnya agar parser bisa ditambah.</p>
          {emails.data.map((e) => (
            <EmailItem key={e.id} e={e} onChanged={(m) => say(m)} />
          ))}
        </section>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-4 md:bottom-4">
          <div className="mx-auto flex max-w-lg flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-xl ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700">
            <span className="flex-1 text-sm font-medium">{selected.size} dipilih</span>
            <button className="btn-primary py-2" onClick={() => setBulkOpen(true)}>Pilih kategori</button>
            <button className="btn-outline py-2" onClick={() => bulk({ status: "ok" }, `${selected.size} ditandai benar.`)}>Tandai benar</button>
            <button className="btn-ghost py-2" onClick={() => bulk({ excluded: true, status: "ok" }, `${selected.size} tidak dihitung di laporan.`)}>
              Abaikan
            </button>
          </div>
        </div>
      )}

      <Sheet open={bulkOpen} onClose={() => setBulkOpen(false)} title={`Kategori untuk ${chosen.length} transaksi`}>
        {bulkOpen && (
          <BulkCategory
            items={chosen}
            onDone={(m, undo) => {
              setBulkOpen(false);
              say(m, undo);
            }}
          />
        )}
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
