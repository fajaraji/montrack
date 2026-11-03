import { useState } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { ErrorNote, PageHeader, Sheet } from "../components/ui";
import type { CategoryDTO, RuleDTO } from "../../shared/types";

function CategoryEdit({ c, onDone }: { c: CategoryDTO; onDone: () => void }) {
  const { bump } = useStore();
  const [name, setName] = useState(c.name);
  const [icon, setIcon] = useState(c.icon);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Partial<CategoryDTO>) => {
    try {
      await api(`/categories/${c.id}`, { method: "PATCH", body: patch });
      bump();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ name, icon });
      }}
    >
      <div className="grid grid-cols-[4.5rem_1fr] gap-2">
        <div>
          <label className="label" htmlFor="cat-icon">Ikon</label>
          <input id="cat-icon" className="input text-center" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="cat-name">Nama</label>
          <input id="cat-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
      </div>
      <p className="text-xs text-stone-500">Mengganti nama tidak mengubah transaksi; semuanya tetap di kategori ini.</p>
      <ErrorNote message={error} />
      <div className="flex gap-2">
        <button type="button" className="btn-outline" onClick={() => save({ archived: !c.archived })}>
          {c.archived ? "Tampilkan lagi" : "Sembunyikan"}
        </button>
        <button className="btn-primary flex-1" disabled={!name.trim()}>Simpan</button>
      </div>
    </form>
  );
}

export function Categories() {
  const { categories, category, bump, version } = useStore();
  const rules = useAsync(() => api<RuleDTO[]>("/rules"), [version]);
  const [pattern, setPattern] = useState("");
  const [ruleCat, setRuleCat] = useState<number | "">("");
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("🏷️");
  const [newKind, setNewKind] = useState<"expense" | "income">("expense");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CategoryDTO | null>(null);

  const learned = (rules.data ?? []).filter((r) => r.origin !== "seed");
  const shown = (rules.data ?? []).filter((r) => !filter || r.pattern.includes(filter.toLowerCase()) || category(r.categoryId)?.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader title="Kategori & aturan" />
      <ErrorNote message={error} />

      <section className="card space-y-3">
        <h2 className="font-semibold">Kategori</h2>
        <form
          className="grid grid-cols-[4rem_1fr_auto_auto] gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api("/categories", { body: { name: newName, icon: newIcon, kind: newKind } });
              setNewName("");
              bump();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <input className="input text-center" value={newIcon} onChange={(e) => setNewIcon(e.target.value)} aria-label="Ikon" />
          <input className="input" placeholder="Kategori baru, mis. Kursus, AI" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Nama kategori" />
          <select className="input" value={newKind} onChange={(e) => setNewKind(e.target.value as "expense" | "income")} aria-label="Jenis kategori">
            <option value="expense">Keluar</option>
            <option value="income">Masuk</option>
          </select>
          <button className="btn-primary" disabled={!newName}>Tambah</button>
        </form>
        {(["expense", "income"] as const).map((k) => (
          <div key={k}>
            <p className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">{k === "expense" ? "Pengeluaran" : "Pemasukan"}</p>
            <div className="flex flex-wrap gap-2">
              {categories.filter((c) => c.kind === k).map((c) => (
                <button
                  key={c.id}
                  className={`chip ${c.archived ? "line-through opacity-50" : ""}`}
                  onClick={() => setEditing(c)}
                >
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-stone-500">Ketuk kategori untuk mengganti nama, ikon, atau menyembunyikannya.</p>
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Aturan otomatis</h2>
        <p className="text-sm text-stone-500">
          Jika merchant/keterangan mengandung kata kunci, kategorinya diisi otomatis. Aturan juga terbentuk sendiri setiap kamu
          memilih kategori dengan “Ingat untuk merchant ini” ({learned.length} aturan dari kamu).
        </p>
        <form
          className="grid grid-cols-[1fr_1fr_auto] gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api("/rules", { body: { pattern, categoryId: ruleCat } });
              setPattern("");
              bump();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <input className="input" placeholder="kata kunci, mis. warkop" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Kata kunci" />
          <select className="input" value={ruleCat} onChange={(e) => setRuleCat(e.target.value ? Number(e.target.value) : "")} aria-label="Kategori">
            <option value="">Kategori…</option>
            {categories.filter((c) => !c.archived).map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
          <button className="btn-primary" disabled={!pattern || !ruleCat}>Tambah</button>
        </form>
        <input className="input" placeholder="Cari aturan" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Cari aturan" />
        <ul className="max-h-96 divide-y divide-stone-100 overflow-y-auto text-sm dark:divide-stone-800">
          {shown.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">
                <code className="rounded bg-stone-100 px-1.5 py-0.5 dark:bg-stone-800">{r.pattern.trim()}</code>
                <span className="mx-2 text-stone-400">→</span>
                {category(r.categoryId)?.icon} {category(r.categoryId)?.name}
                {r.origin === "learned" && <span className="ml-2 text-xs text-brand-700 dark:text-brand-500">dipelajari</span>}
              </span>
              <button
                className="text-xs text-stone-400 hover:text-rose-600"
                aria-label={`Hapus aturan ${r.pattern}`}
                onClick={async () => {
                  await api(`/rules/${r.id}`, { method: "DELETE" });
                  bump();
                }}
              >
                Hapus
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Ubah kategori">
        {editing && <CategoryEdit key={editing.id} c={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
