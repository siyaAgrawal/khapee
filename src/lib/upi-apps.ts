/**
 * Opening the customer's own UPI app on the phone they are holding.
 *
 * There is one UPI request — the `upi://pay?…` the server built — and every
 * app in India can pay it. How it gets opened differs by platform, and only by
 * platform:
 *
 *   Android hands `upi://pay` to the system, which offers every UPI app
 *   installed: Google Pay, PhonePe, Paytm, FamApp, CRED, BHIM, the bank apps,
 *   all of them. One button covers the lot, and a list of named buttons there
 *   would be a worse version of the picker the phone already draws.
 *
 *   iOS registers no handler for `upi://` at all, so that button does nothing
 *   and gives no sign of it. Each app carries a scheme of its own instead, and
 *   the only way to reach one is by name.
 *
 * Hence: one button on Android, named buttons on an iPhone, and the QR for
 * everybody — which is the only route that is true of every app without
 * exception, including the ones that will exist next year.
 *
 * The schemes below are the ones published in the UPI app registries that
 * client libraries share (LSApplicationQueriesSchemes entries). Where an app's
 * path is not documented, it is not listed: a button named after somebody's
 * bank that silently does nothing is worse than no button.
 */
export type UpiApp = { id: string; name: string; scheme: string }

/**
 * `link` is the `upi://pay?…` request; everything after `?` is the same for
 * every app, because it is the same payment.
 */
export function appLink(app: UpiApp, link: string): string {
  const query = link.slice(link.indexOf('?') + 1)
  return `${app.scheme}?${query}`
}

export const IOS_UPI_APPS: UpiApp[] = [
  { id: 'gpay', name: 'Google Pay', scheme: 'gpay://upi/pay' },
  { id: 'phonepe', name: 'PhonePe', scheme: 'phonepe://pay' },
  { id: 'paytm', name: 'Paytm', scheme: 'paytmmp://pay' },
  { id: 'fampay', name: 'FamApp', scheme: 'in.fampay.app://upi/pay' },
  { id: 'bhim', name: 'BHIM', scheme: 'bhim://upi/pay' },
  { id: 'mobikwik', name: 'MobiKwik', scheme: 'mobikwik://upi/pay' },
  { id: 'freecharge', name: 'Freecharge', scheme: 'freecharge://upi/pay' },
]

/** Whether the generic intent will find anything. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** A phone at all — a desktop has no UPI app to open, only a QR to scan. */
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return isIOS() || /Android/i.test(navigator.userAgent)
}
