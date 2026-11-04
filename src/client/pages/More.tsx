import { Link } from "../lib/router";
import { useStore } from "../lib/store";
import { Icon } from "../components/Icon";
import { formatRupiahShort } from "../../shared/money";

const GROUPS = [
  {
    title: "Kelola uang",
    items: [
      { href: "/akun", icon: "wallet", title: "Akun & saldo", desc: "Rekening & e-wallet" },
      { href: "/biaya-rutin", icon: "repeat", title: "Biaya rutin", desc: "Admin bulanan otomatis" },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/kategori", icon: "tag", title: "Kategori", desc: "Aturan & ganti nama" },
      { href: "/impor", icon: "upload", title: "Impor mutasi", desc: "PDF / CSV bank" },
      { href: "/api/export.csv", icon: "download", title: "Ekspor CSV", desc: "Unduh semua data", download: true },
      { href: "/pengaturan", icon: "gear", title: "Pengaturan", desc: "Nama pemilik, Gmail" },
    ],
  },
];

export function More() {
  const { accounts } = useStore();
  const total = accounts.filter((a) => !a.archived).reduce((s, a) => s + a.balance, 0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Semua <span className="text-gradient">menu.</span>
        </h1>
        <p className="mt-1 text-sm text-white/50">
          {accounts.length} akun · saldo <span className="tabular">{formatRupiahShort(total)}</span>
        </p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h2 className="mb-3 font-mono text-xs tracking-widest text-white/40 uppercase">{g.title}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {g.items.map((i) => {
              const body = (
                <>
                  <span className="icon-tile size-11 text-[#ffb38a]">
                    <Icon name={i.icon} />
                  </span>
                  <span className="mt-4 block font-semibold">{i.title}</span>
                  <span className="block text-xs text-white/45">{i.desc}</span>
                </>
              );
              const cls = "card block p-4 transition hover:border-white/20 hover:bg-white/[0.06] active:scale-[0.98]";
              return "download" in i ? (
                <a key={i.href} href={i.href} download className={cls}>
                  {body}
                </a>
              ) : (
                <Link key={i.href} href={i.href} className={cls}>
                  {body}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
