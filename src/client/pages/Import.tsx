import { useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { ErrorNote, PageHeader } from "../components/ui";
import { extractPdfItems, PdfPasswordError } from "../lib/pdf";
import { detectCsvMapping, guessYear, parseCsvText, parseStatementItems, rowsFromCsv } from "../../shared/statement";
import { formatRupiah } from "../../shared/money";
import type { ImportResultDTO, ImportRow } from "../../shared/types";

type PreviewRow = ImportRow & { include: boolean; guessed?: boolean };

export function Import() {
  const { accounts, bump } = useStore();
  const active = accounts.filter((a) => !a.archived && a.kind !== "cash");
  const [accountId, setAccountId] = useState<number | null>(active[0]?.id ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResultDTO | null>(null);

  async function read(f: File, pw?: string) {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
        const items = await extractPdfItems(f, pw || undefined);
        setNeedPassword(false);
        const r = parseStatementItems(items);
        setRows(r.rows.map((x) => ({ date: x.date, description: x.description, amount: x.amount, include: true, guessed: x.guessed })));
        setWarnings(r.warnings);
      } else {
        const text = await f.text();
        const table = parseCsvText(text);
        const map = detectCsvMapping(table);
        if (!map) throw new Error("Kolom tanggal & nominal tidak ditemukan. Pastikan baris judul kolom ada (Tanggal, Keterangan, Debet, Kredit).");
        const out = rowsFromCsv(table, map, guessYear(text));
        setRows(out.map((x) => ({ ...x, include: true })));
        setWarnings(out.length ? [] : ["Tidak ada baris yang terbaca."]);
      }
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setNeedPassword(true);
        setError(e.wrong ? "Password salah. Biasanya tanggal lahir (DDMMYYYY) atau sesuai info dari bank." : null);
      } else setError((e as Error).message);
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!rows || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<ImportResultDTO>("/import", {
        body: { accountId, filename: file?.name, rows: rows.filter((x) => x.include).map(({ date, description, amount }) => ({ date, description, amount })) },
      });
      setResult(r);
      setRows(null);
      bump();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const included = rows?.filter((r) => r.include) ?? [];
  const out = included.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const inc = included.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Impor mutasi" />
      <div className="card space-y-2 text-sm text-stone-600 dark:text-stone-300">
        <p>
          Gunakan untuk menangkap transaksi yang <b>tidak punya email</b>: biaya admin bulanan, bunga, potongan otomatis.
          Transaksi yang sudah tercatat dari email akan dicocokkan dan <b>tidak dobel</b>.
        </p>
        <p className="text-xs text-stone-500">File dibaca di browser kamu. Hanya baris transaksi yang dikirim ke server.</p>
      </div>

      <div className="card space-y-4">
        <div>
          <label className="label" htmlFor="imp-acc">Rekening</label>
          <select id="imp-acc" className="input" value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
            {active.length === 0 && <option value="">Tambah akun dulu di menu Akun</option>}
            {active.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="imp-file">File mutasi / e-statement (PDF atau CSV)</label>
          <input
            id="imp-file"
            type="file"
            accept=".pdf,.csv,.txt,application/pdf,text/csv"
            className="input file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-1 dark:file:bg-stone-800"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setRows(null);
              setNeedPassword(false);
              setPassword("");
              if (f) void read(f);
            }}
          />
          <p className="mt-1 text-xs text-stone-500">Punya file Excel? Simpan sebagai CSV dulu (File › Save As › CSV).</p>
        </div>
        {needPassword && file && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void read(file, password);
            }}
          >
            <input className="input" type="password" placeholder="Password PDF" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus aria-label="Password PDF" />
            <button className="btn-primary" disabled={!password || busy}>Buka</button>
          </form>
        )}
        {busy && <p className="text-sm text-stone-500">Memproses…</p>}
        <ErrorNote message={error} />
      </div>

      {result && (
        <div className="card text-sm">
          <p className="font-semibold">Impor selesai</p>
          <p className="mt-1">
            {result.inserted} transaksi baru · {result.matched} sudah tercatat dari email (dicocokkan) · {result.skipped} dilewati (sudah pernah diimpor)
          </p>
        </div>
      )}

      {rows && (
        <div className="space-y-3">
          {warnings.map((w) => (
            <p key={w} className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{w}</p>
          ))}
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="p-2"><span className="sr-only">Pilih</span></th>
                  <th className="p-2">Tanggal</th>
                  <th className="p-2">Keterangan</th>
                  <th className="p-2 text-right">Nominal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {rows.map((r, i) => (
                  <tr key={i} className={r.include ? "" : "opacity-40"}>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-700"
                        checked={r.include}
                        aria-label="Sertakan baris"
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                      />
                    </td>
                    <td className="p-2 whitespace-nowrap tabular">{r.date.slice(8)}/{r.date.slice(5, 7)}</td>
                    <td className="max-w-48 truncate p-2" title={r.description}>{r.description || "—"}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <button
                        className={`tabular ${r.amount < 0 ? "" : "text-emerald-700 dark:text-emerald-400"} ${r.guessed ? "underline decoration-amber-500 decoration-dotted" : ""}`}
                        title="Ketuk untuk membalik masuk/keluar"
                        onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, amount: -x.amount, guessed: false } : x)))}
                      >
                        {formatRupiah(r.amount, { sign: true })}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-500">Ketuk nominal untuk membalik arah masuk/keluar bila salah terbaca.</p>
          <div className="card flex items-center justify-between gap-3 text-sm">
            <span>
              {included.length} baris · keluar <b className="tabular">{formatRupiah(out)}</b> · masuk <b className="tabular">{formatRupiah(inc)}</b>
            </span>
            <button className="btn-primary" onClick={submit} disabled={busy || !included.length || !accountId}>
              Impor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
