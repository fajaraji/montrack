export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* kosong */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) unauthorizedListeners.forEach((f) => f());
    const msg = (data as { error?: string } | null)?.error ?? `Gagal (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
