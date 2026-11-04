// Service worker Montrack: aset statis di-cache, API selalu dari jaringan.
const CACHE = "montrack-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // Halaman: jaringan dulu, fallback ke cache saat offline.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Aset ber-hash: cache dulu.
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// Web Push: server hanya mengirim "colekan" tanpa isi; ambil isi notifikasi terbaru dari API.
self.addEventListener("push", (e) => {
  e.waitUntil(
    (async () => {
      let title = "Montrack";
      let body = "Ada pembaruan keuanganmu.";
      let url = "/notifikasi";
      try {
        const res = await fetch("/api/notifications?limit=1", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          const n = data.items && data.items[0];
          if (n) {
            title = n.title;
            body = n.body;
            url = n.url || url;
          }
        }
      } catch (_) {
        /* tetap tampilkan notifikasi umum */
      }
      await self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url },
        tag: "montrack",
        renotify: true,
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
