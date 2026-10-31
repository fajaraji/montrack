import { useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { ErrorNote, Money, PageHeader, Sheet, Empty } from "../components/ui";
import { formatRupiah, parseRupiah } from "../../shared/money";
import { PROVIDERS, type AccountDTO } from "../../shared/types";

function AccountForm({ initial, onDone }: { initial?: AccountDTO; onDone: () => void }) {
  const { bump } = useStore();
  const [provider, setProvider] = useState(initial?.provider ?? "bri");
  const [name, setName] = useState(initial?.name ?? "BRI");
  const [last4, setLast4] = useState(initial?.last4 ?? "");
  const [opening, setOpening] = useState(initial ? initial.openingBalance.toLocaleString("id-ID") : "0");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const kind = PROVIDERS.find((p) => p.id === provider)?.kind ?? "other";
        const body = { name, provider, kind, last4: last4 || null, openingBalance: parseRupiah(opening) ?? 0 };
        try {
          if (initial) await api(`/accounts/${initial.id}`, { method: "PATCH", body });
          else await api("/accounts", { body });
          bump();
          onDone();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="acc-provider">Jenis</label>
        <select
          id="acc-provider"
          className="input"
          value={provider}
          onChange={(e) => {
            const p = PROVIDERS.find((x) => x.id === e.target.value);
            if (!initial && (!name || PROVIDERS.some((x) => x.label === name))) setName(p?.label ?? "");
            setProvider(e.target.value);
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">Email dari bank/e-wallet ini otomatis masuk ke akun ini.</p>
      </div>
      <div>
        <label className="label" htmlFor="acc-name">Nama</label>
        <input id="acc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="acc-last4">4 digit terakhir</label>
          <input id="acc-last4" className="input" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} placeholder="opsional" />
        </div>
        <div>
          <label className="label" htmlFor="acc-opening">Saldo awal</label>
          <input id="acc-opening" className="input tabular" inputMode="numeric" value={opening} onChange={(e) => setOpening(String(parseRupiah(e.target.value)?.toLocaleString("id-ID") ?? ""))} />
        </div>
      </div>
      <p className="text-xs text-stone-500">4 digit terakhir hanya perlu kalau kamu punya lebih dari satu rekening di bank yang sama.</p>
      <ErrorNote message={error} />
      <div className="flex gap-2">
        {initial && (
          <button
            type="button"
            className="btn-outline"
            onClick={async () => {
              await api(`/accounts/${initial.id}`, { method: "PATCH", body: { archived: !initial.archived } });
              bump();
              onDone();
            }}
          >
            {initial.archived ? "Aktifkan" : "Arsipkan"}
          </button>
        )}
        <button className="btn-primary flex-1">Simpan</button>
      </div>
    </form>
  );
}

function AdjustForm({ account, onDone }: { account: AccountDTO; onDone: (msg: string) => void }) {
  const { bump } = useStore();
  const [actual, setActual] = useState(account.balance.toLocaleString("id-ID"));
  const [error, setError] = useState<string | null>(null);
  const n = parseRupiah(actual) ?? 0;
  const delta = n - account.balance;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/accounts/${account.id}/adjust`, { body: { actualBalance: n } });
          bump();
          onDone(delta === 0 ? "Saldo sudah sesuai." : `Saldo ${account.name} disesuaikan ${formatRupiah(delta, { sign: true })}.`);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <p className="text-sm text-stone-500">
        Lihat saldo asli di aplikasi {account.name}, lalu isi di sini. Selisihnya dicatat sebagai <b>penyesuaian</b> dan tidak dihitung sebagai pengeluaran.
      </p>
      <div>
        <label className="label" htmlFor="adj">Saldo sebenarnya</label>
        <input id="adj" className="input tabular text-lg" inputMode="numeric" value={actual} onChange={(e) => setActual(String(parseRupiah(e.target.value.replace(/^-/, ""))?.toLocaleString("id-ID") ?? ""))} autoFocus />
      </div>
      <p className="text-sm">
        Tercatat <Money value={account.balance} /> · selisih <Money value={delta} sign className="font-semibold" />
      </p>
      <ErrorNote message={error} />
      <button className="btn-primary w-full">Simpan penyesuaian</button>
    </form>
  );
}

export function Accounts() {
  const { accounts } = useStore();
  const [editing, setEditing] = useState<AccountDTO | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<AccountDTO | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const total = active.reduce((s, a) => s + a.balance, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Akun & saldo" right={<button className="btn-primary" onClick={() => setEditing("new")}>+ Akun</button>} />
      <div className="card">
        <p className="text-sm text-stone-500">Total saldo</p>
        <p className="tabular text-3xl font-bold">{formatRupiah(total)}</p>
      </div>
      {toast && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{toast}</p>}
      {active.length === 0 && <Empty title="Belum ada akun">Akun BRI/BNI/GoPay dst. dibuat otomatis saat email pertama masuk.</Empty>}
      <div className="space-y-2">
        {[...active, ...archived].map((a) => (
          <div key={a.id} className={`card flex items-center gap-3 ${a.archived ? "opacity-60" : ""}`}>
            <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/transaksi?accountId=${a.id}`)}>
              <p className="font-medium">{a.name}{a.last4 && <span className="text-stone-400"> ·{a.last4}</span>}</p>
              <Money value={a.balance} className="text-lg font-semibold" />
            </button>
            <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => setAdjusting(a)}>Sesuaikan</button>
            <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => setEditing(a)} aria-label={`Ubah ${a.name}`}>Ubah</button>
          </div>
        ))}
      </div>
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Tambah akun" : "Ubah akun"}>
        {editing !== null && <AccountForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={!!adjusting} onClose={() => setAdjusting(null)} title={`Sesuaikan saldo ${adjusting?.name ?? ""}`}>
        {adjusting && (
          <AdjustForm
            account={adjusting}
            onDone={(m) => {
              setAdjusting(null);
              setToast(m);
              setTimeout(() => setToast(null), 3500);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
