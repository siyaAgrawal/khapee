import { api } from './api'

/**
 * Signing this device up to be told when an order arrives.
 *
 * The dashboard's own chime only rings while somebody is looking at the board,
 * which is the one moment nobody needs telling. This registers the browser's
 * push service against the service worker, so a phone with the tab closed —
 * or locked, in an apron pocket — still rings.
 */
export type AlertState = {
  /** Every restaurant a switched-on device will ring for. */
  ringsFor: string[]
  push: {
    available: boolean
    publicKey: string
    devices: number
    reason: string
    /** Who is signed up, so an owner can see a phone they do not recognise. */
    list: { id: number; who: string; whose: string; since: string; lastOk: string | null; failing: boolean }[]
  }
  /** Links handed out and not yet used. */
  invites: { id: number; code: string; path: string; since: string; until: string }[]
  email: { available: boolean; to: string; own: string }
}

/**
 * A service worker that is definitely registered and definitely ready.
 *
 * `navigator.serviceWorker.ready` never resolves if nothing ever registered —
 * it waits forever rather than rejecting — so a page whose registration failed
 * shows a button that spins and does nothing, with no error anywhere. This
 * registers if needed and gives up loudly rather than silently.
 */
export async function workerReady(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration()
  if (!existing) await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((_, reject) =>
      setTimeout(() => reject(new Error('The app could not start its background worker.')), 12000),
    ),
  ])
}

/** What this phone actually reports, for when it will not do as it is told. */
export function pushFacts(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const nav = navigator as any
  return {
    'Home Screen app': nav.standalone === true || window.matchMedia?.('(display-mode: standalone)')?.matches
      ? 'yes'
      : 'no — Safari tab',
    'Push available': 'PushManager' in window ? 'yes' : 'no',
    'Service worker': 'serviceWorker' in navigator ? 'yes' : 'no',
    Permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    Browser: /CriOS/.test(navigator.userAgent)
      ? 'Chrome on iPhone — use Safari'
      : /Safari/.test(navigator.userAgent) && /iP/.test(navigator.userAgent)
        ? 'Safari on iPhone'
        : 'other',
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  )
}

/**
 * Whether this is an iPhone in Safari rather than on the Home Screen.
 *
 * Everywhere else — Android, and every desktop browser — push works on the
 * plain website with nothing installed. Apple is the exception: Safari only
 * allows it once the site has been added to the Home Screen, which is a
 * bookmark rather than an app, but has to be done before the switch works at
 * all. Worth saying, with the steps, rather than failing.
 */
export function needsHomeScreen(): boolean {
  if (typeof navigator === 'undefined') return false
  const iOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // An iPad reports itself as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const onHomeScreen =
    (navigator as any).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true
  return iOS && !onHomeScreen && !('PushManager' in window)
}

/** The key arrives as base64url and the browser wants raw bytes. */
function toBytes(base64url: string): Uint8Array {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub?.endpoint ?? null
  } catch {
    return null
  }
}

/**
 * Asks, subscribes, and tells the server — in that order, because the
 * permission prompt has to come from a tap and everything after it is
 * pointless without a yes.
 */
export async function enablePush(publicKey: string): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) {
    return {
      ok: false,
      error: needsHomeScreen()
        ? 'On iPhone, add Khapee to your Home Screen first — Safari only allows alerts to an installed app.'
        : 'This browser cannot do background alerts.',
    }
  }
  if (!publicKey) return { ok: false, error: 'Push alerts are not switched on for this server yet.' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, error: 'Alerts were blocked. Allow notifications for khapee.com and try again.' }
  }

  try {
    const reg = await workerReady()
    // A subscription made against an older key cannot be re-used, and the push
    // service refuses the new one while the old one stands.
    const existing = await reg.pushManager.getSubscription()
    if (existing) await existing.unsubscribe().catch(() => {})

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toBytes(publicKey) as BufferSource,
    })
    await api('/staff/alerts/subscribe', { body: { subscription: sub.toJSON() } })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'The browser refused to subscribe.' }
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await api('/staff/alerts/unsubscribe', { body: { endpoint: sub.endpoint } })
    await sub.unsubscribe().catch(() => {})
  } catch {
    /* nothing subscribed is the state we wanted anyway */
  }
}

/**
 * The customer's own phone, asking to hear about their own order.
 *
 * The same browser push the restaurant's dashboard uses, pointed the other
 * way. It costs nothing to send — which is the whole reason it exists beside
 * a WhatsApp message a business is billed for.
 */
export async function followOrder(
  orderNumber: string,
  token: string,
  publicKey: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) {
    return {
      ok: false,
      error: needsHomeScreen()
        ? 'On iPhone, add Khapee to your Home Screen first — Safari only allows updates to an installed app.'
        : 'This browser cannot show updates when Khapee is closed.',
    }
  }
  if (!publicKey) return { ok: false, error: 'Updates are not switched on for this server yet.' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, error: 'Updates were blocked in your browser settings.' }

  try {
    const reg = await workerReady()
    const existing = await reg.pushManager.getSubscription()
    if (existing) await existing.unsubscribe().catch(() => {})
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toBytes(publicKey) as BufferSource,
    })
    await api(`/orders/${orderNumber}/notify`, { body: { token, subscription: sub.toJSON() } })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'The browser refused to subscribe.' }
  }
}

/**
 * Puts this phone's alerts back after the server has forgotten them.
 *
 * The database is rebuilt from the published copy whenever the service
 * restarts, which on the free plan is often — and the device registrations
 * live in it, so a phone that was set up last night is quietly unsubscribed by
 * morning with nothing to say so. The phone still holds a live push
 * subscription and still remembers the code it was set up with, so it can
 * simply present both again. Nothing new is granted: it is the same phone
 * claiming the same invite it already claimed.
 *
 * Silent by design. If the server has not forgotten, the invite reports itself
 * used and this does nothing, which is the ordinary case.
 */
export async function keepAlertsAlive(): Promise<void> {
  let grant = ''
  try {
    // Either key. A phone set up before the grant was being kept still has the
    // code it typed, and that is the same thing by another name — without this
    // it could never put itself back and would go quiet at the first restart,
    // with nothing on screen to say so.
    grant = localStorage.getItem('khapee.alertGrant') ?? localStorage.getItem('khapee.alertCode') ?? ''
  } catch {
    return
  }
  if (!grant || !pushSupported()) return

  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await api(`/alerts/invite/${grant}`, { body: { subscription: sub.toJSON() } })
    try {
      localStorage.setItem('khapee.alertGrant', grant)
    } catch {
      /* nothing to tidy */
    }
  } catch {
    /* already registered, or the invite is spent for good: nothing to do */
  }
}
