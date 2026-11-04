import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatRupiah } from "../../shared/money";
import { MONTHS_ID, addMonths, formatYm, parseYm } from "../../shared/time";

export function Money({ value, className = "", sign = false }: { value: number; className?: string; sign?: boolean }) {
  return <span className={`tabular ${className}`}>{formatRupiah(value, { sign })}</span>;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] border border-white/10 bg-[#111113]/90 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl sm:rounded-[2rem]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn-ghost -mr-2 px-2" onClick={onClose} aria-label="Tutup">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const ym = parseYm(month);
  const now = parseYm(null);
  const isNow = ym.year === now.year && ym.month === now.month;
  return (
    <div className="flex items-center gap-1">
      <button className="btn-ghost px-2.5" aria-label="Bulan sebelumnya" onClick={() => onChange(formatYm(addMonths(ym, -1)))}>
        ‹
      </button>
      <span className="min-w-32 text-center font-semibold">
        {MONTHS_ID[ym.month - 1]} {ym.year}
      </span>
      <button
        className="btn-ghost px-2.5"
        aria-label="Bulan berikutnya"
        disabled={isNow}
        onClick={() => onChange(formatYm(addMonths(ym, 1)))}
      >
        ›
      </button>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-stone-500">{children}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">{message}</p>;
}

export function Spinner() {
  return <div className="py-10 text-center text-sm text-stone-500">Memuat…</div>;
}

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex min-h-10 items-center justify-between gap-3">
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      {right}
    </div>
  );
}

export interface ToastAction {
  label: string;
  run: () => Promise<void> | void;
}

/** Notifikasi singkat di bawah layar, opsional dengan tombol aksi (mis. "Batalkan"). */
export function useToast() {
  const [toast, setToast] = useState<{ msg: string; action?: ToastAction; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string, action?: ToastAction) => {
    if (timer.current) clearTimeout(timer.current);
    const id = Date.now();
    setToast({ msg, action, id });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), action ? 8000 : 3500);
  }, []);
  const [busy, setBusy] = useState(false);
  const el = toast ? (
    <div className="fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 md:bottom-6" role="status">
      <div className="flex w-full max-w-lg items-center gap-3 rounded-2xl glass bg-[#141416]/85 px-4 py-3 text-sm text-white shadow-2xl">
        <span className="flex-1">{toast.msg}</span>
        {toast.action && (
          <button
            className="shrink-0 font-semibold text-[#ffb38a] underline-offset-2 hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await toast.action!.run();
              } finally {
                setBusy(false);
                setToast(null);
              }
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  ) : null;
  return { toastEl: el, showToast: show };
}
