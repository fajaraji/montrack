import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { refreshLocationSilently, savedLocation, updateLocation, type SavedLocation } from "../lib/location";
import { Icon } from "../components/Icon";
import { ErrorNote, useToast } from "../components/ui";
import { formatClock, formatCountdown, prayerToday } from "../../shared/prayer";

/** Lokasi tersimpan + jam yang berdetak tiap 30 detik (jadwal otomatis ganti hari). */
function usePrayer() {
  const [loc, setLoc] = useState<SavedLocation | null>(() => savedLocation());
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    const onVis = () => document.visibilityState === "visible" && setNow(new Date());
    document.addEventListener("visibilitychange", onVis);
    refreshLocationSilently().then((l) => l && setLoc(l));
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  const locate = async () => {
    setBusy(true);
    setError(null);
    try {
      setLoc(await updateLocation());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const data = loc ? prayerToday(loc.lat, loc.lon, now) : null;
  return { loc, data, now, busy, error, locate };
}

/** Kartu ringkas di Beranda. */
export function PrayerCard() {
  const { loc, data, busy, error, locate } = usePrayer();
  if (!loc || !data) {
    return (
      <div className="card flex items-center gap-3 p-4">
        <span className="icon-tile text-[#ffb38a]">
          <Icon name="moon" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Waktu sholat</p>
          <p className="text-xs text-white/45">{error ?? "Izinkan lokasi agar jadwal sesuai kotamu."}</p>
        </div>
        <button className="btn-outline shrink-0" onClick={locate} disabled={busy}>
          {busy ? "Membaca…" : "Pakai lokasi"}
        </button>
      </div>
    );
  }
  return (
    <Link href="/sholat" className="card flex items-center gap-3 p-4 transition hover:border-white/20">
      <span className="icon-tile text-[#ffb38a]">
        <Icon name="moon" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-white/45">
          Berikutnya · {loc.city ?? "lokasimu"}
        </p>
        <p className="font-semibold">
          {data.next.label} <span className="tabular">{formatClock(data.next.time)}</span>
        </p>
      </div>
      <span className="kbd shrink-0">{formatCountdown(data.minutesLeft)}</span>
    </Link>
  );
}

export function Prayer() {
  const { loc, data, now, busy, error, locate } = usePrayer();
  const { toastEl, showToast } = useToast();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";
  const widgetUrl = loc ? `${location.origin}/api/public/sholat?lat=${loc.lat}&lon=${loc.lon}&tz=${encodeURIComponent(tz)}&format=next` : "";
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Waktu <span className="text-gradient">sholat.</span>
        </h1>
        <p className="mt-1 text-sm text-white/50">
          {now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          {loc && <> · {loc.city ?? `${loc.lat}, ${loc.lon}`}</>}
        </p>
      </div>
      {toastEl}
      <ErrorNote message={error} />
      {!data ? (
        <div className="card p-5 text-center">
          <p className="font-semibold">Lokasi belum diatur</p>
          <p className="mt-1 text-sm text-white/45">Jadwal dihitung dari koordinat GPS-mu, jadi selisih menit antardaerah ikut terhitung.</p>
          <button className="btn-primary mt-4" onClick={locate} disabled={busy}>
            {busy ? "Membaca lokasi…" : "Pakai lokasi saat ini"}
          </button>
        </div>
      ) : (
        <>
          <div className="card-accent p-5">
            <p className="text-sm text-white/70">Berikutnya</p>
            <p className="mt-1 text-4xl font-bold tracking-tight">
              {data.next.label} <span className="tabular">{formatClock(data.next.time)}</span>
            </p>
            <p className="mt-1 text-sm text-white/70">{formatCountdown(data.minutesLeft)}</p>
          </div>
          <ul className="card divide-y divide-white/5">
            {data.today.map((p) => {
              const isNext = p.key === data.next.key && p.time.getTime() === data.next.time.getTime();
              const past = p.time.getTime() <= now.getTime();
              return (
                <li key={p.key} className={`flex items-center justify-between px-5 py-3.5 ${isNext ? "text-[#ffb38a]" : past ? "text-white/40" : ""}`}>
                  <span className={`${p.wajib ? "font-semibold" : "text-sm"}`}>{p.label}</span>
                  <span className="tabular font-semibold">{formatClock(p.time)}</span>
                </li>
              );
            })}
          </ul>
          <button className="btn-outline w-full" onClick={locate} disabled={busy}>
            {busy ? "Membaca lokasi…" : "Perbarui lokasi"}
          </button>
          <p className="text-xs text-white/40">
            Parameter Kemenag RI (Subuh 20°, Isya 18°, Ashar Syafi'i, ihtiyat 2–3 menit), dihitung di perangkat tanpa internet. Lokasi diperbarui otomatis
            saat aplikasi dibuka bila izin sudah diberikan.
          </p>
          <section className="card space-y-3 p-5">
            <h2 className="font-semibold">Widget layar utama Android</h2>
            <p className="text-sm text-white/55">
              PWA belum bisa jadi widget. Pakai aplikasi <b>KWGT</b> (gratis): buat widget teks, isi formulanya dengan:
            </p>
            <code className="block break-all rounded-xl bg-black/30 p-3 text-xs">{`$wg("${widgetUrl}", txt)$`}</code>
            <button
              className="btn-outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`$wg("${widgetUrl}", txt)$`);
                  showToast("Formula disalin.");
                } catch {
                  showToast("Gagal menyalin, salin manual ya.");
                }
              }}
            >
              Salin formula
            </button>
            <p className="text-xs text-white/40">
              Ganti <span className="font-mono">format=next</span> menjadi <span className="font-mono">format=today</span> untuk jadwal sehari penuh. Atur interval
              update KWGT ke 15–30 menit. Alamat ini publik tapi hanya berisi hitungan dari koordinat di atas, tanpa data keuangan.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
