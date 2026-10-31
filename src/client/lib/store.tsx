import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { AccountDTO, CategoryDTO } from "../../shared/types";

interface Store {
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  ready: boolean;
  refresh: () => Promise<void>;
  /** naik setiap ada perubahan data, agar halaman lain memuat ulang */
  version: number;
  bump: () => void;
  account: (id: number | null | undefined) => AccountDTO | undefined;
  category: (id: number | null | undefined) => CategoryDTO | undefined;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const [a, c] = await Promise.all([api<AccountDTO[]>("/accounts"), api<CategoryDTO[]>("/categories")]);
    setAccounts(a);
    setCategories(c);
    setReady(true);
  }, []);

  useEffect(() => {
    refresh().catch(() => setReady(true));
  }, [refresh, version]);

  const value = useMemo<Store>(
    () => ({
      accounts,
      categories,
      ready,
      refresh,
      version,
      bump: () => setVersion((v) => v + 1),
      account: (id) => accounts.find((a) => a.id === id),
      category: (id) => categories.find((c) => c.id === id),
    }),
    [accounts, categories, ready, refresh, version],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider hilang");
  return s;
}

/** Muat data async dengan status loading/error sederhana. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
