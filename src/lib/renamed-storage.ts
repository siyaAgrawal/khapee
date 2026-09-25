/**
 * Carrying what a phone already has over to the new names.
 *
 * Everything in this app is called Khapee now, including the keys it keeps in
 * the browser. Those keys hold real things — whether somebody is signed in,
 * what is in their basket, which table they scanned, the receipts for orders
 * they have placed — and renaming a key without moving what is under it
 * throws all of that away.
 *
 * On a restaurant's till that means being signed out mid-service, for a
 * reason nobody could ever work out. For a customer it means a basket
 * emptying itself between choosing and paying. Neither is an acceptable price
 * for tidier names, so the old key is read once, copied to the new one, and
 * then removed.
 *
 * Runs before React, because the first thing the app does is read the token.
 * Never throws: private windows and blocked storage are ordinary, and an app
 * that will not start because it could not rename a key is worse than one
 * with old names.
 */
const MOVED: [from: string, to: string][] = [
  ['tablo.token', 'khapee.token'],
  ['tablo.cart', 'khapee.cart'],
  ['tablo.dining', 'khapee.dining'],
  ['tablo.group', 'khapee.group'],
  ['tablo.table', 'khapee.table'],
  ['tablo.receipts', 'khapee.receipts'],
  ['ordro.notified', 'khapee.notified'],
  ['ordro.veg', 'khapee.veg'],
]

export function adoptOldKeys(): void {
  try {
    for (const [from, to] of MOVED) {
      const old = localStorage.getItem(from)
      if (old === null) continue
      // Only if nothing is there already. Somebody who has used the app since
      // the rename has newer state than whatever the old key still holds.
      if (localStorage.getItem(to) === null) localStorage.setItem(to, old)
      localStorage.removeItem(from)
    }
  } catch {
    /* private window, blocked storage, a full disk — none of it is fatal */
  }
}
