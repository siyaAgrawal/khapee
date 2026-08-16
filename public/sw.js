/**
 * The reason this exists: the app is on a free host that sleeps when idle, and
 * a cold request gets the host's own "waking up" interstitial before it ever
 * reaches us. Holding the app shell in a cache means opening Ordro shows Ordro
 * — immediately, from the phone — while the server wakes in the background.
 *
 * Only the shell is cached. Menus, orders and codes are never served stale;
 * they always go to the network, because a cached menu price or order status
 * would be worse than a slow one.
 */
const SHELL = 'ordro-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/apple-touch-icon.png'])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Anything live goes straight to the network, always.
  if (url.pathname.startsWith('/api/')) return

  // Navigations: show the cached shell at once if we have it, and refresh it in
  // the background. This is what replaces the host's wake screen.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/').then((cached) => {
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) caches.open(SHELL).then((c) => c.put('/', response.clone()))
            return response
          })
          .catch(() => cached)
        return cached || fresh
      }),
    )
    return
  }

  // Build assets are content-hashed, so a hit is always correct.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.png'))) {
            const copy = response.clone()
            caches.open(SHELL).then((c) => c.put(request, copy))
          }
          return response
        }),
    ),
  )
})
