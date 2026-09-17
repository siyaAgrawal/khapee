const KEY = 'tablo.dining'

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
}

/** The open "I'm here" session, kept for the length of the meal. */
export function saveDining(session: DiningSession) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    /* ignore */
  }
}

export function readDining(restaurantId?: number): DiningSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as DiningSession
    if (restaurantId && s.restaurantId !== restaurantId) return null
    return s
  } catch {
    return null
  }
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
