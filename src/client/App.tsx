import { useEffect, useState } from "react";
import { api, onUnauthorized } from "./lib/api";
import { useLocation } from "./lib/router";
import { StoreProvider, useAsync, useStore } from "./lib/store";
import { Layout } from "./components/Layout";
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
import type { MonthSummaryDTO } from "../shared/types";

function Routes({ onLogout }: { onLogout: () => void }) {
  const { path } = useLocation();
  const { version } = useStore();
  const summary = useAsync(() => api<MonthSummaryDTO>("/summary"), [version, path]);
  const reviewCount = (summary.data?.reviewCount ?? 0) + (summary.data?.unparsedEmailCount ?? 0);
  let page;
  if (path === "/") page = <Dashboard />;
  else if (path.startsWith("/transaksi")) page = <Transactions />;
  else if (path.startsWith("/tinjau")) page = <Review />;
  else if (path.startsWith("/akun")) page = <Accounts />;
  else if (path.startsWith("/impor")) page = <Import />;
  else if (path.startsWith("/kategori")) page = <Categories />;
  else if (path.startsWith("/pengaturan")) page = <Settings onLogout={onLogout} />;
  else if (path.startsWith("/lainnya")) page = <More />;
  else page = <Dashboard />;
  return <Layout reviewCount={reviewCount}>{page}</Layout>;
}

export function App() {
  const [auth, setAuth] = useState<"loading" | "in" | "out">("loading");
  useEffect(() => {
    api<{ loggedIn: boolean }>("/auth/me")
      .then((r) => setAuth(r.loggedIn ? "in" : "out"))
      .catch(() => setAuth("out"));
    return onUnauthorized(() => setAuth("out"));
  }, []);
  if (auth === "loading") return <Spinner />;
  if (auth === "out") return <Login onLogin={() => setAuth("in")} />;
  return (
    <StoreProvider>
      <Routes onLogout={() => setAuth("out")} />
    </StoreProvider>
  );
}
