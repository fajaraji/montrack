import { useEffect } from "react";
import { api } from "../lib/api";
import { useAsync, useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { Empty, PageHeader, Spinner } from "../components/ui";
import type { NotificationDTO } from "../../shared/types";

const ICON: Record<string, string> = { recap: "📊", budget: "⚠️", bill: "🧾", test: "🔔" };

export function Notifications() {
  const { bump } = useStore();
  const list = useAsync(() => api<{ unread: number; items: NotificationDTO[] }>("/notifications?limit=50"), []);
  useEffect(() => {
    if (list.data?.unread) api("/notifications/read-all", { method: "POST" }).then(bump).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data?.unread]);
  return (
    <div className="space-y-4">
      <PageHeader title="Notifikasi" />
      {!list.data ? (
        <Spinner />
      ) : list.data.items.length === 0 ? (
        <Empty title="Belum ada notifikasi">Rekap mingguan, peringatan anggaran, dan pengingat tagihan muncul di sini.</Empty>
      ) : (
        <ul className="space-y-2">
          {list.data.items.map((n) => (
            <li key={n.id}>
              <button className={`card flex w-full gap-3 text-left ${n.read ? "" : "ring-2 ring-brand-600/40"}`} onClick={() => navigate(n.url)}>
                <span className="text-xl" aria-hidden>{ICON[n.kind] ?? "🔔"}</span>
                <span className="min-w-0">
                  <span className="block font-medium">{n.title}</span>
                  <span className="block text-sm text-stone-600 dark:text-stone-300">{n.body}</span>
                  <span className="block text-xs text-stone-400">
                    {new Date(n.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
