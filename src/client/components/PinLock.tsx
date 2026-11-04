import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

/** Layar kunci PIN. Setelah 5 kali salah, server mengakhiri sesi dan pengguna harus login dengan password. */
export function PinLock({ onUnlock, onLoggedOut }: { onUnlock: () => void; onLoggedOut: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(value: string) {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/pin/verify", { body: { pin: value } });
      onUnlock();
    } catch (e) {
      const err = e as ApiError;
      setPin("");
      if (err.status === 401 && /password/i.test(err.message)) {
        onLoggedOut();
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length === 6) void submit(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter" && pin.length >= 4) void submit(pin);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-stone-50 px-6 dark:bg-stone-950">
      <div className="text-center">
        <p className="text-2xl font-bold text-brand-700 dark:text-brand-500">Montrack</p>
        <p className="mt-1 text-sm text-stone-500">Masukkan PIN</p>
      </div>
      <div className="flex gap-3" aria-label={`${pin.length} angka dimasukkan`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={`size-3.5 rounded-full ${i < pin.length ? "bg-brand-700" : "bg-stone-300 dark:bg-stone-700"}`} />
        ))}
      </div>
      <p className="h-5 text-sm text-rose-600" role="alert">{error}</p>
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} className="h-16 rounded-2xl bg-white text-2xl font-medium shadow-sm active:bg-stone-100 dark:bg-stone-900" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button className="h-16 rounded-2xl text-sm text-stone-500" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Hapus angka">
          ⌫
        </button>
        <button className="h-16 rounded-2xl bg-white text-2xl font-medium shadow-sm active:bg-stone-100 dark:bg-stone-900" onClick={() => press("0")}>
          0
        </button>
        <button
          className="h-16 rounded-2xl bg-brand-700 text-sm font-semibold text-white disabled:opacity-40"
          disabled={pin.length < 4 || busy}
          onClick={() => submit(pin)}
        >
          Buka
        </button>
      </div>
    </div>
  );
}
