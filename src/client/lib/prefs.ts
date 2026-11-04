/** Preferensi per perangkat (localStorage aman bila tidak tersedia). */
export function getPref(key: string): string | null {
  try {
    return localStorage.getItem(`mt:${key}`);
  } catch {
    return null;
  }
}
export function setPref(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(`mt:${key}`);
    else localStorage.setItem(`mt:${key}`, value);
  } catch {
    /* abaikan */
  }
}

export function applyPrivacy(on: boolean) {
  document.documentElement.classList.toggle("privacy", on);
  setPref("privacy", on ? "1" : null);
}
export function privacyOn(): boolean {
  return getPref("privacy") === "1";
}
