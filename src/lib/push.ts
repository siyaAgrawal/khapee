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
  push: { available: boolean; publicKey: string; devices: number }
  email: { available: boolean; to: string }
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
 * Safari only allows push to a web app that has been added to the Home Screen,
 * so on an iPhone in the browser this is worth saying rather than failing.
 */
export function needsHomeScreen(): boolean {
  if (typeof navigator === 'undefined') return false
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  const installed =
    (navigator as any).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true
  return iOS && !installed && !('PushManager' in window)
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
    const reg = await navigator.serviceWorker.ready
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
