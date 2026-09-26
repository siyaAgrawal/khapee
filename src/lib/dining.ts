const KEY = 'khapee.dining'

export type DiningSession = {
  token: string
  restaurantId: number
  restaurantName: string
  restaurantEmoji: string
  tableId: number | null
  tableLabel: string | null
  source: 'code' | 'table_qr' | 'payment'
  serviceMode?: 'dine_in' | 'car' | 'takeaway' | 'pickup' | 'delivery' | 'precinct'
  areaName?: string | null
  /** Where it is going: an address for a delivery, a car for the kerb outside,
   *  or a landmark for somebody standing in a precinct. */
  address?: string
  precinctSlug?: string | null
  precinctName?: string | null
  spotLabel?: string | null
  /** Where they are, landmark or their own words. */
  whereLabel?: string | null
  lookFor?: string
  vehicle?: string
  seqNo?: number | null
  /** What this area adds for carrying the order, and what it will not go out under. */
  deliveryFeeCents?: number
  minOrderCents?: number
  active: boolean
  secondsLeft: number
  /**
   * When this phone stored it, so the countdown means something later.
   *
   * secondsLeft is a number the server sent at one moment and it has been
   * sitting in localStorage ever since. Without knowing when that moment was,
   * it can never be spent. See readDining.
   */
  savedAt?: number
}

/**
 * How long a stored session is worth believing when it did not say.
 *
 * Sessions written before this existed carry no savedAt and no honest expiry,
 * and one of them left on a phone is what caused the bug this guards against:
 * a delivery session from days ago still deciding where somebody's dinner was
 * going. Treating them as expired costs anybody genuinely mid-meal one scan of
 * the QR on their table, and costs everybody else nothing.
 */
const NO_TIMESTAMP_IS_STALE = true

/** The open "I'm here" session, kept for the length of the meal. */
export function saveDining(session: DiningSession) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...session, savedAt: Date.now() }))
  } catch {
    /* ignore */
  }
}

/**
 * The open session, or nothing if it has run out.
 *
 * It used to be whatever was in storage, for ever. A session says how long it
 * has left and nothing ever spent it, so one left behind by an abandoned
 * delivery order went on deciding where that customer's food was going on
 * every later visit — the checkout hid the "at a table / takeaway / collect"
 * choice entirely, treated the order as a delivery, and demanded that area's
 * minimum. A customer sitting at a table was told to add seventy rupees more
 * to be delivered, with no way out of it.
 *
 * So it expires, here, where every caller already goes.
 */
export function readDining(restaurantId?: number): DiningSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as DiningSession
    if (restaurantId && s.restaurantId !== restaurantId) return null
    if (s.active === false) return forget()
    // Written before sessions were timestamped: no way to know how old, so
    // not to be trusted with where somebody's dinner is going.
    if (!s.savedAt) return NO_TIMESTAMP_IS_STALE ? forget() : s
    const seconds = Number(s.secondsLeft ?? 0)
    if (seconds > 0 && Date.now() > s.savedAt + seconds * 1000) return forget()
    return s
  } catch {
    return null
  }
}

/** Drops the stored session and answers "there isn't one". */
function forget(): null {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Whether this order belongs to one party on its own, rather than to a table
 * several people are adding to.
 *
 * A group room is a table's shared ticket — it is keyed to a table, and the
 * kitchen sends it to that table. Someone waiting in their car or at home is
 * not at a table, so a group handle left over from an earlier visit must not
 * capture their order: it did, and the cart offered "Add to table" as the only
 * button, with no way to place the car order at all.
 *
 * The group itself is left alone rather than cleared. It is still theirs, and
 * it comes back the moment the car or delivery session ends.
 */
export function ownOrderOnly(restaurantId?: number): boolean {
  const mode = readDining(restaurantId)?.serviceMode
  return mode === 'car' || mode === 'delivery' || mode === 'precinct'
}

export function clearDining() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
