/**
 * Opening the customer's own UPI app on the phone they are holding.
 *
 * There is one UPI request — the `upi://pay?…` the server built — and every
 * app in India can pay it. What differs is how you get into a named app, and
 * that is entirely a matter of platform:
 *
 *   Android understands `intent://` URLs, which can name the package to open.
 *   A plain `upi://pay` works too, but it opens the system's own chooser, so
 *   paying costs two taps: ours, then theirs. Naming the package skips the
 *   chooser and lands the customer inside Google Pay with the amount already
 *   filled in — which is the one tap this is supposed to be.
 *
 *   iOS registers no handler for `upi://` at all, so a generic button there
 *   does nothing and gives no sign of it. Each app carries a scheme of its
 *   own, and the only way to reach one is by name.
 *
 * Hence: named buttons on both, the generic intent kept on Android for the
 * app nobody here has listed, and the QR for everybody — the only route that
 * is true of every app without exception, including the ones that will exist
 * next year.
 *
 * The identifiers below are the published ones: Android package names from
 * the apps' own Play listings, iOS schemes from the registries client
 * libraries share. Where an app's is not documented it is not listed, because
 * a button named after somebody's bank that silently does nothing is worse
 * than no button.
 */
export type UpiApp = {
  id: string
  name: string
  /** iOS custom scheme, where the app publishes one. */
  scheme?: string
  /** Android package, for an intent:// that skips the chooser. */
  pkg?: string
}

/** Everything after `?` is the same for every app — it is the same payment. */
function queryOf(link: string): string {
  return link.slice(link.indexOf('?') + 1)
}

/** iOS: the app's own scheme, carrying the same request. */
export function appLink(app: UpiApp, link: string): string {
  return `${app.scheme}?${queryOf(link)}`
}

/**
 * Android: an intent aimed at one package.
 *
 * `S.browser_fallback_url` is deliberately absent. The fallback fires when the
 * package is not installed, and every URL we could put there is this same
 * page — so it would reload the checkout under the customer, losing the panel
 * they were looking at. With no fallback, Chrome simply does nothing, and the
 * other buttons are still on screen.
 */
export function androidAppLink(app: UpiApp, link: string): string {
  return `intent://pay?${queryOf(link)}#Intent;scheme=upi;package=${app.pkg};end`
}

/**
 * The apps worth naming, in the order people in Indore actually hold them.
 *
 * One list for both platforms: an entry carries a scheme, a package, or both,
 * and each platform shows what it can open.
 */
export const UPI_APPS: UpiApp[] = [
  { id: 'gpay', name: 'Google Pay', scheme: 'gpay://upi/pay', pkg: 'com.google.android.apps.nbu.paisa.user' },
  { id: 'phonepe', name: 'PhonePe', scheme: 'phonepe://pay', pkg: 'com.phonepe.app' },
  { id: 'paytm', name: 'Paytm', scheme: 'paytmmp://pay', pkg: 'net.one97.paytm' },
  { id: 'amazonpay', name: 'Amazon Pay', pkg: 'in.amazon.mShop.android.shopping' },
  { id: 'cred', name: 'CRED', pkg: 'com.dreamplug.androidapp' },
  { id: 'bhim', name: 'BHIM', scheme: 'bhim://upi/pay', pkg: 'in.org.npci.upiapp' },
  { id: 'fampay', name: 'FamApp', scheme: 'in.fampay.app://upi/pay', pkg: 'in.fampay.app' },
  { id: 'mobikwik', name: 'MobiKwik', scheme: 'mobikwik://upi/pay', pkg: 'com.mobikwik_new' },
  { id: 'freecharge', name: 'Freecharge', scheme: 'freecharge://upi/pay' },
]

/** The ones this phone can actually be sent to. */
export function appsFor(ios: boolean): UpiApp[] {
  return UPI_APPS.filter((a) => (ios ? !!a.scheme : !!a.pkg))
}

/** The link that opens `app` on this phone. */
export function linkFor(app: UpiApp, link: string, ios: boolean): string {
  return ios ? appLink(app, link) : androidAppLink(app, link)
}

/** Kept for the generic Android button, under the named ones. */
export const IOS_UPI_APPS: UpiApp[] = UPI_APPS.filter((a) => !!a.scheme)

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/**
 * An in-app browser: WhatsApp, Instagram, Facebook, Snapchat.
 *
 * Most people in Indore reach a restaurant through a link somebody sent them,
 * and tapping that link opens a webview rather than Chrome or Safari. A
 * webview is where UPI goes quiet: custom schemes and `intent://` are blocked
 * or ignored, with no error and nothing on screen, so every app button simply
 * does nothing. That is exactly what "UPI is not connecting" looks like from
 * the customer's side.
 *
 * Detected so the panel can say so and offer the ways out that do work, rather
 * than leaving somebody tapping a button that was never going to fire.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /\b(FBAN|FBAV|FB_IAB|Instagram|Line|Snapchat)\b/i.test(ua) || /\bWhatsApp\b/i.test(ua)
}

/** A phone at all — a desktop has no UPI app to open, only a QR to scan. */
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return isIOS() || /Android/i.test(navigator.userAgent)
}
