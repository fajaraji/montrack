import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { Empty, ErrorNote, PageHeader, Sheet, Spinner, useToast } from "../components/ui";
import { CategoryGrid, TxAmount, TxForm, txTitle, undoAction } from "../components/tx";
import { wibParts, MONTHS_ID } from "../../shared/time";
import { providerLabel, type InboxEmailDTO, type SettingsDTO, type TransactionDTO, type UndoPayload } from "../../shared/types";

function ReviewCard({
  t,
  onDone,
  onEdit,
}: {
  t: TransactionDTO;
  onDone: (msg: string, undo?: UndoPayload) => void;
  onEdit: () => void;
}) {
  const { account, category, bump } = useStore();
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = wibParts(new Date(t.occurredAt));
  const kind = t.type === "income" ? "income" : "expense";

  async function pick(categoryId: number, categoryName?: string) {
    setBusy(true);
    try {
      const r = await api<{ learned: number; undo: UndoPayload }>(`/transactions/${t.id}`, {
        method: "PATCH",
        body: { categoryId, status: "ok", remember: remember && !!(t.merchant || t.description) },
      });
      bump();
      const name = categoryName ?? category(categoryId)?.name ?? "kategori";
      onDone(
        r.learned > 0 ? `Masuk ${name}, ${r.learned} transaksi serupa ikut.` : `Masuk ${name}.`,
        r.undo,
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const isBankTransfer = t.description === "Transfer keluar" || t.description === "Transfer masuk";

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
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
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
            <CategoryGrid kind={kind} value={t.categoryId} onPick={(c) => pick(c.id, c.name)} />
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

export function Review() {
  const { version, bump } = useStore();
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const { toastEl, showToast } = useToast();
  const txs = useAsync(() => api<TransactionDTO[]>("/transactions?status=review&limit=200"), [version]);
  const emails = useAsync(() => api<InboxEmailDTO[]>("/inbox?status=unparsed"), [version]);
  const say = (m: string, undo?: UndoPayload) => showToast(m, undoAction(undo, bump));

  return (
    <div className="space-y-4">
      <PageHeader title="Perlu ditinjau" />
      <p className="text-sm text-stone-500">
        Pilih kategori sekali, Montrack akan mengingatnya untuk merchant yang sama berikutnya. Salah pilih? Ketuk{" "}
        <b>Batalkan</b> di notifikasi bawah, atau ubah kapan saja lewat menu <b>Transaksi</b>.
      </p>
      {toastEl}
      <ErrorNote message={txs.error} />
      {txs.loading && !txs.data ? (
        <Spinner />
      ) : txs.data?.length ? (
        <div className="space-y-3">
          {txs.data.map((t) => (
            <ReviewCard key={t.id} t={t} onDone={say} onEdit={() => setEditing(t)} />
          ))}
        </div>
      ) : (
        <Empty title="Semua sudah rapi 🎉">Tidak ada transaksi yang perlu ditinjau.</Empty>
      )}

      {emails.data && emails.data.length > 0 && (
        <section className="space-y-3 pt-4">
          <h2 className="font-semibold">Email yang belum terbaca ({emails.data.length})</h2>
          <p className="text-sm text-stone-500">
            Format email ini belum dikenali. Catat manual, atau kirim contohnya agar parser bisa ditambah.
          </p>
          {emails.data.map((e) => (
            <EmailItem key={e.id} e={e} onChanged={say} />
          ))}
        </section>
      )}

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
