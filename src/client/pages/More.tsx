import { Link } from "../lib/router";
import { PageHeader } from "../components/ui";

const ITEMS = [
  { href: "/akun", icon: "▣", title: "Akun & saldo", desc: "Saldo tiap rekening dan e-wallet, sesuaikan saldo" },
  { href: "/anggaran", icon: "◔", title: "Anggaran", desc: "Batas pengeluaran total dan per kategori" },
  { href: "/target", icon: "🎯", title: "Target tabungan", desc: "Dana darurat, liburan, dan lainnya" },
  { href: "/notifikasi", icon: "🔔", title: "Notifikasi", desc: "Rekap mingguan, peringatan anggaran, tagihan" },
  { href: "/kategori", icon: "🏷️", title: "Kategori & aturan", desc: "Kategori, kata kunci otomatis, ganti nama merchant" },
  { href: "/impor", icon: "⇪", title: "Impor mutasi", desc: "PDF/CSV e-statement untuk biaya admin & transaksi tanpa email" },
  { href: "/pengaturan", icon: "⚙", title: "Pengaturan", desc: "PIN, notifikasi, ekspor CSV, koneksi Gmail" },
];

export function More() {
  return (
    <div>
      <PageHeader title="Lainnya" />
      <div className="space-y-2">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className="card flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-lg dark:bg-stone-800" aria-hidden>{i.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{i.title}</span>
              <span className="block text-sm text-stone-500">{i.desc}</span>
            </span>
            <span aria-hidden className="text-stone-400">›</span>
          </Link>
        ))}
        <a href="/api/export.csv" className="card flex items-center gap-3" download>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-lg dark:bg-stone-800" aria-hidden>⇩</span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Ekspor CSV</span>
            <span className="block text-sm text-stone-500">Unduh semua transaksi, bisa dibuka di Excel</span>
          </span>
        </a>
      </div>
    </div>
  );
}
