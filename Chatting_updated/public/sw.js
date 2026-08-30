/*
 * © 2026 gamer-09. All rights reserved.
 * This code is proprietary. Unauthorized copying, modification,
 * distribution, or use of this software is strictly prohibited.
 */
// ── Network-first shell: always serve fresh same-origin assets ─────────────
// GitHub Pages sends max-age=600; this SW bypasses the HTTP cache so deploys
// reach users instantly, with cache fallback only when the network is dead.
const CACHE = 'ptr29-shell-v2';

// Take over immediately the moment a newer sw.js arrives — no user is ever
// stranded on a stale build behind an old worker.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).then((res) => {
      try {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
      } catch (e) {}
      return res;
    }).catch(() => caches.match(event.request))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification && event.notification.data || {};
  const room = (data && data.room) ? String(data.room) : '';
  const url = room ? `?room=${encodeURIComponent(room)}` : '.';
  event.waitUntil((async () => {
    try {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (allClients && allClients.length) {
        const client = allClients[0];
        await client.focus();
        try { client.postMessage({ type: 'open-room', room }); } catch {}
        return;
      }
      await clients.openWindow(url);
    } catch (e) {
      try { await clients.openWindow(url); } catch {}
    }
  })());
});
