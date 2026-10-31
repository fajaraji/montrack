import { Link } from "../lib/router";
import { PageHeader } from "../components/ui";

const ITEMS = [
  { href: "/impor", title: "Impor mutasi", desc: "PDF/CSV e-statement untuk biaya admin & transaksi tanpa email" },
  { href: "/kategori", title: "Kategori & aturan", desc: "Atur kata kunci kategorisasi otomatis" },
  { href: "/pengaturan", title: "Pengaturan", desc: "Anggaran, nama pemilik rekening, koneksi Gmail" },
];

export function More() {
  return (
    <div>
      <PageHeader title="Lainnya" />
      <div className="space-y-2">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className="card flex items-center justify-between gap-3">
            <span>
              <span className="block font-medium">{i.title}</span>
              <span className="block text-sm text-stone-500">{i.desc}</span>
            </span>
            <span aria-hidden className="text-stone-400">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
