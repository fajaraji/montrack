import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { Empty, ErrorNote, Sheet, Spinner, useToast } from "../components/ui";
import { Icon } from "../components/Icon";
import { formatRupiah, parseRupiah } from "../../shared/money";
import { MONTHS_ID } from "../../shared/time";
import type { FeeDTO } from "../../shared/types";

function FeeForm({ initial, onDone }: { initial?: FeeDTO; onDone: (msg: string) => void }) {
  const { accounts, categories, bump } = useStore();
  const active = accounts.filter((a) => !a.archived);
  const expenseCats = categories.filter((c) => c.kind === "expense" && !c.archived);
  const adminCat = expenseCats.find((c) => c.name === "Biaya Bank & Admin");
  const [name, setName] = useState(initial?.name ?? "Biaya admin bulanan");
  const [amount, setAmount] = useState(initial ? initial.amount.toLocaleString("id-ID") : "");
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? active[0]?.id ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(initial ? initial.categoryId : adminCat?.id ?? null);
  const [day, setDay] = useState(String(initial?.dayOfMonth ?? 1));
  const [startNextMonth, setStartNextMonth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const body = { name, amount: parseRupiah(amount) ?? 0, accountId, categoryId, dayOfMonth: Number(day), startNextMonth };
        try {
          if (initial) {
            await api(`/fees/${initial.id}`, { method: "PATCH", body });
            bump();
            onDone("Tersimpan. Perubahan berlaku mulai pencatatan berikutnya.");
          } else {
            const r = await api<{ recorded: number }>("/fees", { body });
            bump();
            onDone(r.recorded ? `Ditambahkan, dan ${r.recorded} catatan bulan ini sudah dibuat.` : "Ditambahkan. Akan tercatat otomatis saat jatuh tempo.");
          }
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="fee-name">Nama</label>
        <input id="fee-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Admin BNI Taplus" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="fee-amount">Nominal</label>
          <input
            id="fee-amount"
            className="input tabular"
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(parseRupiah(e.target.value)?.toLocaleString("id-ID") ?? "")}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="fee-day">Setiap tanggal</label>
          <select id="fee-day" className="input" value={day} onChange={(e) => setDay(e.target.value)}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d === 31 ? "31 / akhir bulan" : d}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="fee-acc">Dari akun</label>
          <select id="fee-acc" className="input" value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="fee-cat">Kategori</label>
          <select id="fee-cat" className="input" value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {expenseCats.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
        </div>
      </div>
      {!initial && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-[#ff9a6a]" checked={startNextMonth} onChange={(e) => setStartNextMonth(e.target.checked)} />
          <span>
            Mulai bulan depan
            <span className="block text-xs text-white/45">Kosongkan untuk ikut mencatat bulan ini bila tanggalnya sudah lewat.</span>
          </span>
        </label>
      )}
      {initial && <p className="text-xs text-white/45">Mengubah nominal/tanggal tidak mengubah catatan bulan-bulan yang sudah lewat.</p>}
      <ErrorNote message={error} />
      <div className="flex gap-2">
        {initial && (
          <button
            type="button"
            className="btn-outline text-rose-300"
            onClick={async () => {
              if (!confirm("Hapus biaya rutin ini? Catatan yang sudah ada tetap tersimpan.")) return;
              await api(`/fees/${initial.id}`, { method: "DELETE" });
              bump();
              onDone("Biaya rutin dihapus.");
            }}
          >
            Hapus
          </button>
        )}
        <button className="btn-primary flex-1" disabled={!accountId}>
          Simpan
        </button>
      </div>
    </form>
  );
}

export function Fees() {
  const { version, account, category, bump } = useStore();
  const fees = useAsync(() => api<FeeDTO[]>("/fees"), [version]);
  const [editing, setEditing] = useState<FeeDTO | "new" | null>(null);
  const { toastEl, showToast } = useToast();
  const total = (fees.data ?? []).filter((f) => f.active).reduce((s, f) => s + f.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Biaya <span className="text-gradient">rutin.</span>
          </h1>
          <p className="mt-1 text-sm text-white/50">Potongan tetap tiap bulan yang tidak ada emailnya, misalnya admin rekening. Dicatat otomatis saat jatuh tempo.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing("new")}>
          <Icon name="plus" className="size-4" /> Tambah
        </button>
      </div>
      {toastEl}
      {!fees.data ? (
        <Spinner />
      ) : fees.data.length === 0 ? (
        <Empty title="Belum ada biaya rutin">Contoh: admin BNI Taplus setiap tanggal 1. Nominal bisa diubah kapan saja kalau naik.</Empty>
      ) : (
        <>
          <p className="kbd">Total aktif {formatRupiah(total)}/bulan</p>
          <ul className="space-y-3">
            {fees.data.map((f) => (
              <li key={f.id} className={`card flex items-center gap-3 p-4 ${f.active ? "" : "opacity-50"}`}>
                <span className="icon-tile">{category(f.categoryId)?.icon ?? <Icon name="repeat" className="size-4" />}</span>
                <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(f)}>
                  <span className="block truncate font-semibold">{f.name}</span>
                  <span className="block text-xs text-white/45">
                    Tgl {f.dayOfMonth} · {account(f.accountId)?.name ?? "?"} · mulai {MONTHS_ID[Number(f.startMonth.slice(5)) - 1]} {f.startMonth.slice(0, 4)}
                  </span>
                </button>
                <span className="tabular shrink-0 font-bold">{formatRupiah(f.amount)}</span>
                <label className="relative ml-1 inline-flex cursor-pointer items-center" title={f.active ? "Aktif" : "Nonaktif"}>
                  <input
                    type="checkbox"
                    role="switch"
                    className="peer sr-only"
                    checked={f.active}
                    aria-label={`${f.active ? "Nonaktifkan" : "Aktifkan"} ${f.name}`}
                    onChange={async (e) => {
                      await api(`/fees/${f.id}`, { method: "PATCH", body: { active: e.target.checked } });
                      bump();
                    }}
                  />
                  <span className="relative h-6 w-10 rounded-full bg-white/15 transition peer-checked:bg-[#ff9a6a] after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Biaya rutin baru" : "Ubah biaya rutin"}>
        {editing !== null && (
          <FeeForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? undefined : editing}
            onDone={(m) => {
              setEditing(null);
              showToast(m);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
