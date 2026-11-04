import { getPref, setPref } from "./prefs";

export interface SavedLocation {
  lat: number;
  lon: number;
  city?: string;
  at: number;
}

export function savedLocation(): SavedLocation | null {
  try {
    const v = JSON.parse(getPref("loc") ?? "null");
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null;
  } catch {
    return null;
  }
}

function position(): Promise<GeolocationPosition> {
  return new Promise((res, rej) => {
    if (!("geolocation" in navigator)) return rej(new Error("Browser tidak mendukung lokasi"));
    navigator.geolocation.getCurrentPosition(res, (e) => rej(new Error(e.code === 1 ? "Izin lokasi ditolak. Aktifkan di pengaturan browser." : "Lokasi tidak bisa dibaca, coba lagi.")), {
      enableHighAccuracy: false,
      timeout: 15_000,
      maximumAge: 30 * 60_000,
    });
  });
}

async function cityName(lat: number, lon: number): Promise<string | undefined> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=id&lat=${lat}&lon=${lon}`);
    const j = (await r.json()) as { address?: Record<string, string> };
    const a = j.address ?? {};
    return a.city ?? a.town ?? a.county ?? a.municipality ?? a.state ?? undefined;
  } catch {
    return undefined;
  }
}

/** Minta lokasi GPS & simpan (dibulatkan ±1 km, cukup untuk akurasi menit). */
export async function updateLocation(): Promise<SavedLocation> {
  const p = await position();
  const lat = Math.round(p.coords.latitude * 100) / 100;
  const lon = Math.round(p.coords.longitude * 100) / 100;
  const prev = savedLocation();
  const moved = !prev || Math.abs(prev.lat - lat) > 0.05 || Math.abs(prev.lon - lon) > 0.05;
  const city = moved || !prev?.city ? await cityName(lat, lon) : prev.city;
  const loc = { lat, lon, city, at: Date.now() };
  setPref("loc", JSON.stringify(loc));
  return loc;
}

/** Perbarui diam-diam bila izin sudah diberikan dan lokasi lebih tua dari 3 jam. */
export async function refreshLocationSilently(): Promise<SavedLocation | null> {
  const prev = savedLocation();
  if (prev && Date.now() - prev.at < 3 * 3600_000) return null;
  try {
    const st = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (st?.state !== "granted") return null;
    return await updateLocation();
  } catch {
    return null;
  }
}
