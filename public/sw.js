/**
 * The reason this exists: the app is on a free host that sleeps when idle, and
 * a cold request gets the host's own "waking up" interstitial before it ever
 * reaches us. Holding the app shell in a cache means opening Khapee shows Khapee
 * — immediately, from the phone — while the server wakes in the background.
 *
 * Only the shell is cached. Menus, orders and codes are never served stale;
 * they always go to the network, because a cached menu price or order status
 * would be worse than a slow one.
 */
const SHELL = 'ordro-assets-v5'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(['/manifest.webmanifest', '/apple-touch-icon.png'])),
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

  // Pages are never served from the cache.
  //
  // Caching the shell was meant to hide the host's "waking up" screen, and it
  // did the opposite. Render answers a cold request with its own interstitial
  // at 200 text/html, so that page got stored as the app and handed back on
  // every later visit; and a stored shell keeps pointing at the asset hashes of
  // the build that made it, which the next deploy replaces. Both failures look
  // the same from a phone: an app that will not update, or will not render.
  //
  // A slow first load is the cost of not having either. Assets below still come
  // from the cache, so only the first request after a sleep is slow.
  if (request.mode === 'navigate') return

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

/**
 * Order alerts, on a phone that is not looking at the dashboard.
 *
 * This is the whole point of the service worker existing on the staff side: a
 * page can only raise a notification while it is open, and the person who needs
 * telling is in the kitchen with the tab closed. The payload is written by the
 * server in server/push.ts.
 */
self.addEventListener('push', (event) => {
  let note = { title: 'New order', body: 'Open Khapee to see it.', url: '/staff/orders' }
  try {
    if (event.data) note = { ...note, ...event.data.json() }
  } catch {
    /* a push with no readable body still deserves to ring */
  }

  event.waitUntil(
    self.registration.showNotification(note.title, {
      body: note.body,
      tag: note.tag || 'khapee-order',
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      // Orders are the one thing worth interrupting for: without this the
      // notification is cleared by the next one and a quiet minute of four
      // orders looks like one.
      renotify: true,
      requireInteraction: true,
      data: { url: note.url || '/staff/orders' },
    }),
  )
})

/**
 * Tapping it opens the board — or focuses the tab that is already on it.
 *
 * Two of them point elsewhere: the board, and the page that hands a thank-you
 * to WhatsApp. Getting an already-open window to either needs client.navigate,
 * which Safari does not implement — so where it is missing a new window is
 * opened rather than the existing one merely being focused, which is what made
 * "thank them" land on the board.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const wanted = event.notification.data?.url || '/staff/orders'
  const target = new URL(wanted, self.location.origin).href
  const ours = target.startsWith(self.location.origin)

  event.waitUntil(
    (async () => {
      // Somebody else's site — WhatsApp — always gets its own window. Asking
      // the app's own window to go there is declined.
      if (!ours) return self.clients.openWindow(target)

      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((c) => c.url.startsWith(self.location.origin))

      // Moving an already-open window to another page needs client.navigate,
      // which Safari does not implement — it was simply skipped, so tapping
      // "thank them" focused whatever was already on screen, usually the
      // board, and looked like the wrong notification had been sent. Where it
      // is missing, a new window goes to the right place instead.
      if (open && typeof open.navigate === 'function') {
        try {
          const moved = await open.navigate(target)
          return (moved || open).focus()
        } catch {
          /* fall through and open one */
        }
      }
      // Already on the page it wants: just come to the front.
      if (open && open.url === target) return open.focus()
      return self.clients.openWindow(target)
    })(),
  )
})
