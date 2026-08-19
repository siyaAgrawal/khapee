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
const SHELL = 'ordro-shell-v2'

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

  // Navigations race the network against a short timeout. A server that answers
  // wins, so a new deploy is seen immediately — serving the cache first was
  // wrong, and left phones on an old build until their second visit. A server
  // that is still waking loses, and the cached shell stands in for it, which is
  // what keeps the host's own "waking up" page off the screen.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL)
        try {
          const fresh = await Promise.race([
            fetch(request),
            new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 3000)),
          ])
          if (fresh && fresh.ok) {
            cache.put('/', fresh.clone())
            return fresh
          }
          throw new Error('bad response')
        } catch {
          return (await cache.match('/')) || fetch(request)
        }
      })(),
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
