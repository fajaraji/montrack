import { useState, type ReactNode } from "react";
import { Link, useLocation } from "../lib/router";
import { useStore } from "../lib/store";
import { applyPrivacy, privacyOn } from "../lib/prefs";
import { Sheet, useToast } from "./ui";
import { TxForm, undoAction } from "./tx";

const NAV = [
  { href: "/", label: "Beranda", icon: "◉" },
  { href: "/transaksi", label: "Transaksi", icon: "≡" },
  { href: "/tinjau", label: "Tinjau", icon: "✓" },
  { href: "/laporan", label: "Laporan", icon: "▤" },
  { href: "/lainnya", label: "Lainnya", icon: "⋯" },
];

/** Halaman yang termasuk menu "Lainnya" (agar tab Lainnya tetap aktif). */
const MORE = ["/lainnya", "/akun", "/anggaran", "/target", "/impor", "/kategori", "/pengaturan", "/notifikasi"];

export function Layout({ children, reviewCount, unread }: { children: ReactNode; reviewCount: number; unread: number }) {
  const { path } = useLocation();
  const { bump } = useStore();
  const [adding, setAdding] = useState(false);
  const [privacy, setPrivacy] = useState(privacyOn());
  const { toastEl, showToast } = useToast();
  const active = (href: string) =>
    href === "/" ? path === "/" : href === "/lainnya" ? MORE.some((m) => path.startsWith(m)) : path.startsWith(href);

  const tools = (
    <div className="flex items-center gap-1">
      <button
        className="btn-ghost size-10 p-0 text-lg"
        onClick={() => {
          applyPrivacy(!privacy);
          setPrivacy(!privacy);
        }}
        aria-label={privacy ? "Tampilkan nominal" : "Sembunyikan nominal"}
        aria-pressed={privacy}
        title={privacy ? "Tampilkan nominal" : "Sembunyikan nominal"}
      >
        {privacy ? "🙈" : "👁"}
      </button>
      <Link href="/notifikasi" className="btn-ghost relative size-10 p-0 text-lg" aria-label={`Notifikasi${unread ? `, ${unread} belum dibaca` : ""}`}>
        🔔
        {unread > 0 && <span className="absolute top-1 right-1 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] leading-4 text-white">{unread}</span>}
      </Link>
    </div>
  );

  return (
    <div className="mx-auto min-h-screen max-w-3xl md:flex md:gap-6 md:px-6">
      <nav className="hidden w-48 shrink-0 py-6 md:block" aria-label="Navigasi utama">
        <div className="mb-4 flex items-center justify-between px-3">
          <span className="text-lg font-bold text-brand-700 dark:text-brand-500">Montrack</span>
        </div>
        <div className="mb-4 px-2">{tools}</div>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`mb-1 flex items-center justify-between rounded-xl px-3 py-2 text-sm ${
              active(n.href) ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-100" : "hover:bg-stone-100 dark:hover:bg-stone-900"
            }`}
          >
            {n.label}
            {n.href === "/tinjau" && reviewCount > 0 && <span className="rounded-full bg-amber-500 px-2 text-xs text-white">{reviewCount}</span>}
          </Link>
        ))}
        <button className="btn-primary mt-4 w-full" onClick={() => setAdding(true)}>
          + Catat
        </button>
      </nav>
      <main className="min-w-0 flex-1 px-4 pt-3 pb-32 md:py-6">
        <div className="-mr-2 mb-1 flex justify-end md:hidden">{tools}</div>
        {children}
      </main>

      <button
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex size-14 items-center justify-center rounded-full bg-brand-700 text-3xl leading-none text-white shadow-lg active:scale-95 md:hidden"
        onClick={() => setAdding(true)}
        aria-label="Catat transaksi"
      >
        +
      </button>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-950/95"
        aria-label="Navigasi utama"
      >
        <div className="mx-auto flex max-w-lg">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                active(n.href) ? "font-semibold text-brand-700 dark:text-brand-500" : "text-stone-500"
              }`}
            >
              <span className="text-lg leading-none" aria-hidden>
                {n.icon}
              </span>
              {n.label}
              {n.href === "/tinjau" && reviewCount > 0 && (
                <span className="absolute top-1 right-[22%] min-w-4 rounded-full bg-amber-500 px-1 text-[10px] leading-4 text-white">{reviewCount}</span>
              )}
            </Link>
          ))}
        </div>
      </nav>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Catat transaksi">
        <TxForm
          quick
          onDone={(msg, undo) => {
            setAdding(false);
            bump();
            showToast(msg ?? "Tersimpan.", undoAction(undo, bump));
          }}
        />
      </Sheet>
      {toastEl}
    </div>
  );
}
