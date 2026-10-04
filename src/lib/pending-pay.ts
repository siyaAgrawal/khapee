/**
 * The payment the customer went off to make, kept so they can come back to it.
 *
 * Paying by UPI means leaving: the customer taps Google Pay or PhonePe, the
 * browser hands the phone to another app, and Khapee is a background tab. iOS
 * discards background tabs routinely and Android does it under memory
 * pressure, so the page that comes back is very often a fresh one — and the
 * pay panel lived in React state, which a fresh page does not have.
 *
 * What that cost: the money left the customer's account and no order was ever
 * placed, because the order is only created when they come back and say they
 * have paid. The restaurant saw nothing. The customer saw a checkout with
 * their basket still in it.
 *
 * It only began to show when takeaway became UPI-only, which moved most
 * takeaway customers onto this path for the first time — the bug was always
 * there, waiting for enough people to use it.
 *
 * Kept on the phone rather than on the server because no order exists yet.
 * This is a payment in flight, not a record of one.
 */
const KEY = 'khapee.pending-pay'

export type PendingPay = {
  restaurantId: number
  amountCents: number
  upiLink: string
  payeeName: string
  vpa: string
  reference: string
  savedAt: number
}

/**
 * Long enough to pay, short enough that it cannot resurface another day.
 *
 * Opening a UPI app, choosing an account and entering a PIN is a minute or
 * two; a customer who comes back forty minutes later has done something else
 * in between and should be asked afresh, because the basket and the prices
 * behind the request may both have moved.
 */
const GOOD_FOR_MS = 40 * 60 * 1000

export function savePendingPay(request: Omit<PendingPay, 'savedAt'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...request, savedAt: Date.now() }))
  } catch {
    /* private window; the customer simply has no second chance at it */
  }
}

/** The payment in flight for this restaurant, if it is still fresh. */
export function readPendingPay(restaurantId: number): PendingPay | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingPay
    if (p.restaurantId !== restaurantId) return null
    if (!p.savedAt || Date.now() - p.savedAt > GOOD_FOR_MS) return clearPendingPay()
    if (!p.upiLink || !p.amountCents) return clearPendingPay()
    return p
  } catch {
    return null
  }
}

export function clearPendingPay(): null {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to tidy */
  }
  return null
}
