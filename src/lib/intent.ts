/**
 * How this order is being collected, chosen before the food is.
 *
 * Khapee has always asked "at a table, takeaway, or collect later" at the
 * checkout, which is the last screen and the worst place for it. By then the
 * basket is full and the question is a surprise — and it is a surprise the
 * customer has usually already answered, because they got here by tapping
 * "sitting in your car" or by scanning the QR on their table.
 *
 * So the choice moves to the front, beside the other ways in, and the
 * checkout simply states what was chosen with a way back to change it. The
 * two routes that already worked this way — a car, an address — are the model;
 * this is the third.
 *
 * Kept on the phone rather than on the server because nothing has been
 * ordered yet. It is an intention, not a session: no table is held, no
 * kitchen is told, and it costs nothing if it is abandoned.
 */
const KEY = 'khapee.intent'

export type Intent = {
  restaurantId: number
  /** 'pickup' is ordering ahead and collecting; 'table' is eating in. */
  mode: 'pickup'
  savedAt: number
}

export function saveIntent(restaurantId: number, mode: Intent['mode'] = 'pickup') {
  try {
    localStorage.setItem(KEY, JSON.stringify({ restaurantId, mode, savedAt: Date.now() }))
  } catch {
    /* private window; the checkout falls back to asking */
  }
}

/**
 * The intention for this restaurant, if there is a fresh one.
 *
 * Expires after a few hours for the same reason a dining session does: one
 * left over from last week must not quietly decide where this evening's
 * dinner is going.
 */
const GOOD_FOR_MS = 4 * 60 * 60 * 1000

export function readIntent(restaurantId?: number): Intent | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const i = JSON.parse(raw) as Intent
    if (restaurantId && i.restaurantId !== restaurantId) return null
    if (!i.savedAt || Date.now() - i.savedAt > GOOD_FOR_MS) return forget()
    return i
  } catch {
    return null
  }
}

export function clearIntent(): void {
  forget()
}

function forget(): null {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to tidy */
  }
  return null
}
