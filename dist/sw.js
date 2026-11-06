/* ReadVibe service worker — makes the app installable and launch instantly, without ever serving stale data.
 *   • /api/*            never touched (always the network; offline reading uses IndexedDB in the app itself)
 *   • /assets/*         cache-first: filenames are content-hashed, so a cached file is never out of date
 *   • page navigations  network-first, with the last good copy (then /offline.html) when there is no connection
 *   • icons, manifest   stale-while-revalidate
 * Bump VERSION to drop every old cache.
 */
const VERSION = 'v1';
const SHELL = `rv-shell-${VERSION}`;
const ASSETS = `rv-assets-${VERSION}`;
const STATIC = `rv-static-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/offline.html'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS, STATIC]);
    for (const key of await caches.keys()) if (key.startsWith('rv-') && !keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

const putIfOk = async (cacheName, request, response) => {
  if (response && response.ok && response.type === 'basic') { try { await (await caches.open(cacheName)).put(request, response.clone()); } catch { /* quota */ } }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        await putIfOk(SHELL, '/', fresh);
        return fresh;
      } catch {
        return (await caches.match('/', { cacheName: SHELL })) || (await caches.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => (await caches.match(request)) || putIfOk(ASSETS, request, await fetch(request)))());
    return;
  }

  if (url.pathname.startsWith('/icons/') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then((r) => putIfOk(STATIC, request, r)).catch(() => cached);
      return cached || network;
    })());
  }
});
