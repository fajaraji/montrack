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
const MORE = ["/lainnya", "/akun", "/biaya-rutin", "/impor", "/kategori", "/pengaturan"];

export function Layout({
  children,
  reviewCount,
  wide = false,
}: {
  children: ReactNode;
  reviewCount: number;
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
        className="flex size-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
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
    </div>
  );

  return (
    <div className="mx-auto min-h-screen max-w-[1320px] md:flex md:gap-8 md:px-6">
      <nav className="sticky top-4 my-4 hidden h-[calc(100vh-2rem)] w-56 shrink-0 flex-col rounded-3xl border border-white/[0.08] bg-white/[0.03] p-3 backdrop-blur-xl md:flex" aria-label="Navigasi utama">
        <div className="mb-8 flex items-center gap-2 px-3">
          <span className="logo size-9 text-lg">M</span>
          <span className="text-lg font-extrabold tracking-tight">Montrack</span>
        </div>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`mb-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${
              active(n.href)
                ? "bg-white font-semibold text-black shadow-[0_8px_24px_-10px_rgba(255,255,255,0.5)]"
                : "text-white/60 hover:bg-white/[0.06] hover:text-white"
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
        <div className="mt-auto flex items-center justify-between px-1">
          <span className="kbd">v3</span>
          {tools}
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-4 pt-3 pb-36 md:py-6">
        <div className="glass sticky top-2 z-30 mb-4 flex items-center justify-between rounded-full py-1.5 pr-1.5 pl-2 md:hidden">
          <span className="flex items-center gap-2">
            <span className="logo size-8 text-base">M</span>
            <span className="font-extrabold tracking-tight">Montrack</span>
          </span>
          {tools}
        </div>
        <div className={wide ? "" : "mx-auto max-w-3xl"}>{children}</div>
      </main>

      <button
        className="fixed right-4 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 flex size-14 items-center justify-center rounded-full bg-white text-black shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_12px_40px_-8px_rgba(255,140,90,0.55)] active:scale-95 md:hidden"
        onClick={() => {
          setAddType(undefined);
          setAdding(true);
        }}
        aria-label="Catat transaksi"
      >
        <Icon name="plus" className="size-6" />
      </button>

      <nav
        className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 rounded-full border border-white/10 bg-[#0f0f11]/75 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.8)] backdrop-blur-2xl md:hidden"
        aria-label="Navigasi utama"
      >
        <div className="mx-auto flex max-w-lg">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
                active(n.href) ? "font-semibold text-white" : "text-white/45"
              }`}
            >
              <span className={`flex h-7 w-11 items-center justify-center rounded-full ${active(n.href) ? "bg-white text-black" : ""}`}>
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
