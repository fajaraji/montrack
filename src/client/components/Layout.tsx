import { useEffect, useState, type ReactNode } from "react";
import type { TxType } from "../../shared/types";

/** Buka form catat dari halaman mana pun: openAdd("transfer"). */
export function openAdd(type?: TxType) {
  window.dispatchEvent(new CustomEvent("montrack:add", { detail: { type } }));
}
import { Link, useLocation } from "../lib/router";
import { useStore } from "../lib/store";
import { applyPrivacy, privacyOn } from "../lib/prefs";
import { Sheet, useToast } from "./ui";
import { TxForm, undoAction } from "./tx";
import { Icon } from "./Icon";

const NAV = [
  { href: "/", label: "Beranda", icon: "home" },
  { href: "/transaksi", label: "Transaksi", icon: "list" },
  { href: "/tinjau", label: "Tinjau", icon: "check" },
  { href: "/laporan", label: "Laporan", icon: "chart" },
  { href: "/lainnya", label: "Lainnya", icon: "more" },
];

/** Halaman yang termasuk menu "Lainnya" (agar tab Lainnya tetap aktif). */
const MORE = ["/lainnya", "/akun", "/anggaran", "/target", "/impor", "/kategori", "/pengaturan", "/notifikasi"];

export function Layout({
  children,
  reviewCount,
  unread,
  wide = false,
}: {
  children: ReactNode;
  reviewCount: number;
  unread: number;
  /** halaman dasbor memakai lebar penuh; halaman lain dibatasi agar form tetap nyaman */
  wide?: boolean;
}) {
  const { path } = useLocation();
  const { bump } = useStore();
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<TxType | undefined>(undefined);
  useEffect(() => {
    const on = (e: Event) => {
      setAddType((e as CustomEvent<{ type?: TxType }>).detail?.type);
      setAdding(true);
    };
    window.addEventListener("montrack:add", on);
    return () => window.removeEventListener("montrack:add", on);
  }, []);
  const [privacy, setPrivacy] = useState(privacyOn());
  const { toastEl, showToast } = useToast();
  const active = (href: string) =>
    href === "/" ? path === "/" : href === "/lainnya" ? MORE.some((m) => path.startsWith(m)) : path.startsWith(href);

  const tools = (
    <div className="flex items-center gap-1">
      <button
        className="flex size-10 items-center justify-center rounded-full bg-white text-stone-700 shadow-[0_1px_2px_rgba(16,16,20,0.06)] hover:bg-stone-50 dark:bg-[#18181b] dark:text-stone-200"
        onClick={() => {
          applyPrivacy(!privacy);
          setPrivacy(!privacy);
        }}
        aria-label={privacy ? "Tampilkan nominal" : "Sembunyikan nominal"}
        aria-pressed={privacy}
        title={privacy ? "Tampilkan nominal" : "Sembunyikan nominal"}
      >
        <Icon name={privacy ? "eyeOff" : "eye"} />
      </button>
      <Link
        href="/notifikasi"
        className="relative flex size-10 items-center justify-center rounded-full bg-white text-stone-700 shadow-[0_1px_2px_rgba(16,16,20,0.06)] hover:bg-stone-50 dark:bg-[#18181b] dark:text-stone-200"
        aria-label={`Notifikasi${unread ? `, ${unread} belum dibaca` : ""}`}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-brand-600 px-1 text-[10px] leading-4 font-bold text-white">{unread}</span>}
      </Link>
    </div>
  );

  return (
    <div className="mx-auto min-h-screen max-w-[1320px] md:flex md:gap-8 md:px-6">
      <nav className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col py-6 md:flex" aria-label="Navigasi utama">
        <div className="mb-8 flex items-center gap-2 px-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-ink text-lg font-extrabold text-white dark:bg-white dark:text-ink">M</span>
          <span className="text-lg font-extrabold tracking-tight">Montrack</span>
        </div>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`mb-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${
              active(n.href)
                ? "bg-ink font-semibold text-white dark:bg-white dark:text-ink"
                : "text-stone-600 hover:bg-white dark:text-stone-300 dark:hover:bg-white/5"
            }`}
          >
            <Icon name={n.icon} />
            <span className="flex-1">{n.label}</span>
            {n.href === "/tinjau" && reviewCount > 0 && <span className="rounded-full bg-brand-600 px-2 text-xs font-bold text-white">{reviewCount}</span>}
          </Link>
        ))}
        <button className="btn-primary mt-6 w-full" onClick={() => {
          setAddType(undefined);
          setAdding(true);
        }}>
          <Icon name="plus" className="size-4" /> Catat transaksi
        </button>
        <div className="mt-auto px-1">{tools}</div>
      </nav>
      <main className="min-w-0 flex-1 px-4 pt-3 pb-32 md:py-6">
        <div className="mb-2 flex items-center justify-between md:hidden">
          <span className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-ink text-base font-extrabold text-white dark:bg-white dark:text-ink">M</span>
            <span className="font-extrabold tracking-tight">Montrack</span>
          </span>
          {tools}
        </div>
        <div className={wide ? "" : "mx-auto max-w-3xl"}>{children}</div>
      </main>

      <button
        className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex size-14 items-center justify-center rounded-2xl bg-ink text-white shadow-[0_10px_30px_-8px_rgba(17,17,20,0.6)] active:scale-95 md:hidden dark:bg-white dark:text-ink"
        onClick={() => {
          setAddType(undefined);
          setAdding(true);
        }}
        aria-label="Catat transaksi"
      >
        <Icon name="plus" className="size-6" />
      </button>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_rgba(16,16,20,0.06)] backdrop-blur md:hidden dark:bg-[#121214]/95"
        aria-label="Navigasi utama"
      >
        <div className="mx-auto flex max-w-lg">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${
                active(n.href) ? "font-semibold text-ink dark:text-white" : "text-stone-400"
              }`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active(n.href) ? "bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200" : ""}`}>
                <Icon name={n.icon} />
              </span>
              {n.label}
              {n.href === "/tinjau" && reviewCount > 0 && (
                <span className="absolute top-1 right-[18%] min-w-4 rounded-full bg-brand-600 px-1 text-[10px] leading-4 font-bold text-white">{reviewCount}</span>
              )}
            </Link>
          ))}
        </div>
      </nav>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Catat transaksi">
        <TxForm
          key={`${adding}-${addType ?? "x"}`}
          quick
          initialType={addType}
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
