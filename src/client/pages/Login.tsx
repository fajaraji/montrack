import { useState } from "react";
import { api } from "../lib/api";
import { ErrorNote } from "../components/ui";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        className="card w-full max-w-sm space-y-4 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/auth/login", { body: { password } });
            onLogin();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <h1 className="text-2xl font-bold text-brand-700 dark:text-brand-500">Montrack</h1>
          <p className="text-sm text-stone-500">Catatan keuangan yang terisi sendiri.</p>
        </div>
        <div>
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </div>
        <ErrorNote message={error} />
        <button className="btn-primary w-full" disabled={busy || !password}>
          {busy ? "Masuk…" : "Masuk"}
        </button>
      </form>
    </div>
  );
}
