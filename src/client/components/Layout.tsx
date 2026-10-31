import type { ReactNode } from "react";
import { Link, useLocation } from "../lib/router";

const NAV = [
  { href: "/", label: "Beranda", icon: "◉" },
  { href: "/transaksi", label: "Transaksi", icon: "≡" },
  { href: "/tinjau", label: "Tinjau", icon: "✓" },
  { href: "/akun", label: "Akun", icon: "▣" },
  { href: "/lainnya", label: "Lainnya", icon: "⋯" },
];

export function Layout({ children, reviewCount }: { children: ReactNode; reviewCount: number }) {
  const { path } = useLocation();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="mx-auto min-h-screen max-w-3xl md:flex md:gap-6 md:px-6">
      <nav className="hidden w-48 shrink-0 py-6 md:block" aria-label="Navigasi utama">
        <div className="mb-6 px-3 text-lg font-bold text-brand-700 dark:text-brand-500">Montrack</div>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`mb-1 flex items-center justify-between rounded-xl px-3 py-2 text-sm ${
              active(n.href) ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-100" : "hover:bg-stone-100 dark:hover:bg-stone-900"
            }`}
          >
            {n.label}
            {n.href === "/tinjau" && reviewCount > 0 && (
              <span className="rounded-full bg-amber-500 px-2 text-xs text-white">{reviewCount}</span>
            )}
          </Link>
        ))}
      </nav>
      <main className="min-w-0 flex-1 px-4 pt-5 pb-28 md:py-6">{children}</main>
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
                <span className="absolute top-1 right-[22%] min-w-4 rounded-full bg-amber-500 px-1 text-[10px] leading-4 text-white">
                  {reviewCount}
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
