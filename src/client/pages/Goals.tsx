import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { Empty, ErrorNote, PageHeader, Sheet, Spinner } from "../components/ui";
import { formatRupiah, parseRupiah } from "../../shared/money";
import { MONTHS_ID } from "../../shared/time";
import type { GoalDTO } from "../../shared/types";

function GoalForm({ initial, onDone }: { initial?: GoalDTO; onDone: () => void }) {
  const { accounts, bump } = useStore();
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "🎯");
  const [target, setTarget] = useState(initial ? initial.target.toLocaleString("id-ID") : "");
  const [saved, setSaved] = useState(initial ? initial.saved.toLocaleString("id-ID") : "");
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? null);
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = { name, icon, target: parseRupiah(target) ?? 0, saved: parseRupiah(saved) ?? 0, accountId, deadline: deadline || null };
        try {
          if (initial) await api(`/goals/${initial.id}`, { method: "PATCH", body });
          else await api("/goals", { body });
          bump();
          onDone();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div className="grid grid-cols-[4.5rem_1fr] gap-2">
        <div>
          <label className="label" htmlFor="g-icon">Ikon</label>
          <input id="g-icon" className="input text-center" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="g-name">Nama target</label>
          <input id="g-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Dana darurat" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="g-target">Target</label>
          <input id="g-target" className="input tabular" inputMode="numeric" value={target} onChange={(e) => setTarget(parseRupiah(e.target.value)?.toLocaleString("id-ID") ?? "")} required />
        </div>
        <div>
          <label className="label" htmlFor="g-deadline">Tenggat (opsional)</label>
          <input id="g-deadline" type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="g-acc">Hitung dari</label>
        <select id="g-acc" className="input" value={accountId ?? ""} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Setoran manual</option>
          {accounts.filter((a) => !a.archived).map((a) => (
            <option key={a.id} value={a.id}>Saldo akun {a.name}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">Pilih akun tabungan khusus agar progres mengikuti saldonya secara otomatis.</p>
      </div>
      {accountId == null && (
        <div>
          <label className="label" htmlFor="g-saved">Sudah terkumpul</label>
          <input id="g-saved" className="input tabular" inputMode="numeric" value={saved} onChange={(e) => setSaved(parseRupiah(e.target.value)?.toLocaleString("id-ID") ?? "")} />
        </div>
      )}
      <ErrorNote message={error} />
      <div className="flex gap-2">
        {initial && (
          <button
            type="button"
            className="btn-outline text-rose-700"
            onClick={async () => {
              if (!confirm("Hapus target ini?")) return;
              await api(`/goals/${initial.id}`, { method: "DELETE" });
              bump();
              onDone();
            }}
          >
            Hapus
          </button>
        )}
        <button className="btn-primary flex-1">Simpan</button>
      </div>
    </form>
  );
}

function Deposit({ g, onDone }: { g: GoalDTO; onDone: () => void }) {
  const { bump } = useStore();
  const [v, setV] = useState("");
  const [take, setTake] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = parseRupiah(v) ?? 0;
        if (!n) return;
        await api(`/goals/${g.id}/deposit`, { body: { amount: take ? -n : n } });
        bump();
        onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1 text-sm dark:bg-stone-800">
        {[false, true].map((t) => (
          <button type="button" key={String(t)} onClick={() => setTake(t)} className={`rounded-lg py-1.5 ${take === t ? "bg-white font-semibold shadow-sm dark:bg-stone-950" : ""}`}>
            {t ? "Ambil" : "Setor"}
          </button>
        ))}
      </div>
      <input className="input tabular text-lg" inputMode="numeric" autoFocus value={v} onChange={(e) => setV(parseRupiah(e.target.value)?.toLocaleString("id-ID") ?? "")} aria-label="Nominal" placeholder="0" />
      <button className="btn-primary w-full">Simpan</button>
    </form>
  );
}

export function Goals() {
  const { version } = useStore();
  const goals = useAsync(() => api<GoalDTO[]>("/goals"), [version]);
  const [editing, setEditing] = useState<GoalDTO | "new" | null>(null);
  const [depositing, setDepositing] = useState<GoalDTO | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Target tabungan" right={<button className="btn-primary" onClick={() => setEditing("new")}>+ Target</button>} />
      {!goals.data ? (
        <Spinner />
      ) : goals.data.length === 0 ? (
        <Empty title="Belum ada target">Misalnya dana darurat 3× pengeluaran bulanan, atau liburan akhir tahun.</Empty>
      ) : (
        <div className="space-y-3">
          {goals.data.map((g) => (
            <div key={g.id} className="card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <button className="min-w-0 text-left" onClick={() => setEditing(g)}>
                  <p className="font-semibold">{g.icon} {g.name}</p>
                  <p className="text-xs text-stone-500">
                    {g.accountName ? `Dari saldo ${g.accountName}` : "Setoran manual"}
                    {g.deadline && ` · tenggat ${Number(g.deadline.slice(8))} ${MONTHS_ID[Number(g.deadline.slice(5, 7)) - 1]} ${g.deadline.slice(0, 4)}`}
                  </p>
                </button>
                {g.accountId == null && (
                  <button className="btn-outline shrink-0 px-3 py-1.5 text-xs" onClick={() => setDepositing(g)}>Setor</button>
                )}
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                <div className={`h-full rounded-full ${g.pct >= 100 ? "bg-emerald-500" : "bg-brand-600"}`} style={{ width: `${g.pct}%` }} />
              </div>
              <p className="text-sm">
                <span className="tabular font-semibold">{formatRupiah(g.progress)}</span> dari <span className="tabular">{formatRupiah(g.target)}</span> · {g.pct}%
              </p>
              {g.pct < 100 && g.perMonth != null && (
                <p className="text-xs text-stone-500">
                  Perlu <span className="tabular font-medium">{formatRupiah(g.perMonth)}</span>/bulan selama {g.monthsLeft} bulan lagi.
                </p>
              )}
              {g.pct >= 100 && <p className="text-xs text-emerald-700 dark:text-emerald-400">Tercapai 🎉</p>}
            </div>
          ))}
        </div>
      )}
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Target baru" : "Ubah target"}>
        {editing !== null && <GoalForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={!!depositing} onClose={() => setDepositing(null)} title={`Setoran ${depositing?.name ?? ""}`}>
        {depositing && <Deposit g={depositing} onDone={() => setDepositing(null)} />}
      </Sheet>
    </div>
  );
}
