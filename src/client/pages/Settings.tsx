import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { ErrorNote, PageHeader } from "../components/ui";
import { parseRupiah } from "../../shared/money";
import { providerLabel, type InboxEmailDTO, type SettingsDTO } from "../../shared/types";

const STATUS_LABEL: Record<string, string> = {
  parsed: "tercatat",
  merged: "digabung",
  ignored: "diabaikan",
  unparsed: "belum terbaca",
};

export function Settings({ onLogout }: { onLogout: () => void }) {
  const { version, bump } = useStore();
  const settings = useAsync(() => api<SettingsDTO>("/settings"), [version]);
  const inbox = useAsync(() => api<InboxEmailDTO[]>("/inbox"), [version]);
  const [budget, setBudget] = useState("");
  const [owners, setOwners] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setBudget(settings.data.monthlyBudget ? settings.data.monthlyBudget.toLocaleString("id-ID") : "");
    setOwners(settings.data.ownerNames.join(", "));
  }, [settings.data]);

  const origin = typeof location !== "undefined" ? location.origin : "";

  return (
    <div className="space-y-6">
      <PageHeader title="Pengaturan" />
      <form
        className="card space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api("/settings", {
              method: "PATCH",
              body: {
                monthlyBudget: parseRupiah(budget) || null,
                ownerNames: owners.split(",").map((s) => s.trim()).filter(Boolean),
              },
            });
            bump();
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div>
          <label className="label" htmlFor="budget">Anggaran pengeluaran per bulan</label>
          <input id="budget" className="input tabular" inputMode="numeric" placeholder="kosongkan jika tidak pakai" value={budget} onChange={(e) => setBudget(String(parseRupiah(e.target.value)?.toLocaleString("id-ID") ?? ""))} />
          <p className="mt-1 text-xs text-stone-500">Dipakai untuk menghitung “aman dipakai per hari” di Beranda.</p>
        </div>
        <div>
          <label className="label" htmlFor="owners">Nama pemilik rekening</label>
          <input id="owners" className="input" placeholder="mis. Budi Santoso, BUDI S" value={owners} onChange={(e) => setOwners(e.target.value)} />
          <p className="mt-1 text-xs text-stone-500">
            Transfer ke/dari nama ini dianggap pindah uang antar rekening sendiri (bukan pengeluaran). Pisahkan dengan koma.
          </p>
        </div>
        <ErrorNote message={error} />
        <button className="btn-primary">{saved ? "Tersimpan ✓" : "Simpan"}</button>
      </form>

      <section className="card space-y-3 text-sm">
        <h2 className="text-base font-semibold">Pencatatan otomatis dari Gmail</h2>
        <ol className="list-decimal space-y-2 pl-5 text-stone-600 dark:text-stone-300">
          <li>
            Pastikan notifikasi email aktif di aplikasi BRImo / wondr BNI / BSI Mobile dan e-wallet (GoPay, DANA, OVO, ShopeePay).
          </li>
          <li>
            Buka <a className="text-brand-700 underline dark:text-brand-500" href="https://script.google.com" target="_blank" rel="noreferrer">script.google.com</a> →
            New project → tempel isi file <code>apps-script/Code.gs</code> dari repo.
          </li>
          <li>
            Project Settings → Script Properties: <code>MONTRACK_URL</code> = <code className="break-all">{origin}</code>, dan{" "}
            <code>MONTRACK_SECRET</code> = nilai <code>INGEST_SECRET</code>.
          </li>
          <li>Jalankan fungsi <code>setup</code> sekali dan izinkan aksesnya. Selesai: email dicek tiap 5 menit.</li>
        </ol>
      </section>

      <section className="card space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Email masuk terakhir</h2>
          <button
            className="text-brand-700 dark:text-brand-500"
            onClick={async () => {
              // Server memproses beberapa email per panggilan; ulangi sampai habis.
              let after = 0;
              for (let i = 0; i < 200; i++) {
                const r = await api<{ remaining: number; lastId: number }>(`/inbox/reprocess-all?after=${after}`, { method: "POST" });
                after = r.lastId;
                if (!r.remaining) break;
              }
              bump();
            }}
          >
            Baca ulang yang gagal
          </button>
        </div>
        {inbox.data?.length ? (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {inbox.data.slice(0, 30).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate">{e.subject}</span>
                  <span className="block truncate text-xs text-stone-500">
                    {providerLabel(e.provider) || e.fromAddr} · {new Date(e.receivedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" })}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${e.status === "unparsed" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"}`}>
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-stone-500">Belum ada email yang diterima.</p>
        )}
      </section>

      <button
        className="btn-outline w-full"
        onClick={async () => {
          await api("/auth/logout", { method: "POST" });
          onLogout();
        }}
      >
        Keluar
      </button>
    </div>
  );
}
