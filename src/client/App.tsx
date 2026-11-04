import { useEffect, useState } from "react";
import { api, onUnauthorized } from "./lib/api";
import { useLocation } from "./lib/router";
import { StoreProvider, useAsync, useStore } from "./lib/store";
import { applyPrivacy, privacyOn } from "./lib/prefs";
import { Layout } from "./components/Layout";
import { PinLock } from "./components/PinLock";
import { Spinner } from "./components/ui";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Transactions } from "./pages/Transactions";
import { Review } from "./pages/Review";
import { Accounts } from "./pages/Accounts";
import { More } from "./pages/More";
import { Import } from "./pages/Import";
import { Categories } from "./pages/Categories";
import { Settings } from "./pages/Settings";
import { Reports } from "./pages/Reports";
import { Budgets } from "./pages/Budgets";
import { Goals } from "./pages/Goals";
import { Notifications } from "./pages/Notifications";
import type { MonthSummaryDTO, SettingsDTO } from "../shared/types";

/** Kunci lagi bila aplikasi ditinggal di latar belakang lebih dari ini. */
const RELOCK_MS = 5 * 60 * 1000;
const UNLOCK_KEY = "mt:unlocked";

function Routes({ onLogout }: { onLogout: () => void }) {
  const { path } = useLocation();
  const { version } = useStore();
  const summary = useAsync(() => api<MonthSummaryDTO>("/summary"), [version, path]);
  const notif = useAsync(() => api<{ unread: number }>("/notifications?limit=1"), [version, path]);
  const reviewCount = (summary.data?.reviewCount ?? 0) + (summary.data?.unparsedEmailCount ?? 0);
  let page;
  if (path === "/") page = <Dashboard />;
  else if (path.startsWith("/transaksi")) page = <Transactions />;
  else if (path.startsWith("/tinjau")) page = <Review />;
  else if (path.startsWith("/laporan")) page = <Reports />;
  else if (path.startsWith("/akun")) page = <Accounts />;
  else if (path.startsWith("/anggaran")) page = <Budgets />;
  else if (path.startsWith("/target")) page = <Goals />;
  else if (path.startsWith("/notifikasi")) page = <Notifications />;
  else if (path.startsWith("/impor")) page = <Import />;
  else if (path.startsWith("/kategori")) page = <Categories />;
  else if (path.startsWith("/pengaturan")) page = <Settings onLogout={onLogout} />;
  else if (path.startsWith("/lainnya")) page = <More />;
  else page = <Dashboard />;
  return (
    <Layout reviewCount={reviewCount} unread={notif.data?.unread ?? 0} wide={path === "/" || path.startsWith("/laporan")}>
      {page}
    </Layout>
  );
}

function wasUnlockedRecently(): boolean {
  try {
    const t = Number(sessionStorage.getItem(UNLOCK_KEY) ?? 0);
    return Date.now() - t < RELOCK_MS;
  } catch {
    return false;
  }
}
function markUnlocked() {
  try {
    sessionStorage.setItem(UNLOCK_KEY, String(Date.now()));
  } catch {
    /* abaikan */
  }
}

export function App() {
  const [auth, setAuth] = useState<"loading" | "in" | "out">("loading");
  const [locked, setLocked] = useState(false);
  const [hasPin, setHasPin] = useState(false);

  useEffect(() => {
    applyPrivacy(privacyOn());
    api<{ loggedIn: boolean }>("/auth/me")
      .then((r) => setAuth(r.loggedIn ? "in" : "out"))
      .catch(() => setAuth("out"));
    return onUnauthorized(() => setAuth("out"));
  }, []);

  // Setelah login: cek apakah PIN aktif; kunci saat aplikasi baru dibuka.
  useEffect(() => {
    if (auth !== "in") return;
    api<SettingsDTO>("/settings")
      .then((s) => {
        setHasPin(s.hasPin);
        if (s.hasPin && !wasUnlockedRecently()) setLocked(true);
      })
      .catch(() => {});
  }, [auth]);

  // Kunci lagi setelah lama di latar belakang; perbarui penanda saat aktif.
  useEffect(() => {
    if (!hasPin) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (!locked) markUnlocked();
      } else if (!wasUnlockedRecently()) setLocked(true);
    };
    document.addEventListener("visibilitychange", onVis);
    const tick = setInterval(() => !locked && markUnlocked(), 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(tick);
    };
  }, [hasPin, locked]);

  if (auth === "loading") return <Spinner />;
  if (auth === "out") return <Login onLogin={() => { markUnlocked(); setAuth("in"); }} />;
  return (
    <StoreProvider>
      {locked && (
        <PinLock
          onUnlock={() => {
            markUnlocked();
            setLocked(false);
          }}
          onLoggedOut={() => {
            setLocked(false);
            setAuth("out");
          }}
        />
      )}
      <Routes onLogout={() => setAuth("out")} />
    </StoreProvider>
  );
}
