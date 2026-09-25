import { db } from './db.ts'

/**
 * Half open — the state between taking everything and taking nothing.
 * ---------------------------------------------------------------------------
 * A kitchen closes hours before the room does. The chef leaves, the range is
 * cleaned down, and what is still servable is whatever comes out of the fridge
 * already made. Khapee only had open and closed, so a restaurant in exactly
 * that position had to choose between losing the dessert trade all evening and
 * spending the evening apologising to people whose food it could not cook.
 *
 * Switched on, two rules apply together:
 *
 *   Only the sections the restaurant marked stay orderable. Everything else
 *   reads as unavailable to a customer — not hidden, because a menu that
 *   changes shape at ten o'clock looks broken, and somebody who wanted the
 *   pasta should be able to see that it exists and is off tonight.
 *
 *   The order must be paid for in the app. This is half the feature, not a
 *   detail bolted on. A place running on one person and a fridge cannot carry
 *   somebody who orders and never turns up, and the margin that makes staying
 *   half open worth doing is exactly the margin a no-show destroys.
 *
 * Enforced here, on the server, for both. Doing it in the interface only would
 * leave the rule as a suggestion that anybody with the network tab open could
 * decline, and the person who pays for that is the restaurant.
 */

export type LimitedState = {
  on: boolean
  /** Section ids that can still be ordered. Empty when it is not on. */
  sectionIds: number[]
  /** Their names, for saying what is still going. */
  sectionNames: string[]
}

export function limitedState(restaurantId: number): LimitedState {
  const row = db.prepare('SELECT limited_mode FROM restaurants WHERE id = ?').get(restaurantId) as any
  if (!row?.limited_mode) return { on: false, sectionIds: [], sectionNames: [] }
  const rows = db
    .prepare('SELECT id, name FROM menu_categories WHERE restaurant_id = ? AND limited_ok = 1 ORDER BY sort_order, id')
    .all(restaurantId) as any[]
  return { on: true, sectionIds: rows.map((r) => r.id), sectionNames: rows.map((r) => r.name) }
}

/**
 * Whether this dish can be ordered right now.
 *
 * The restaurant's own per-dish switch still decides first — a sold-out
 * dessert is sold out whether or not the kitchen has shut. This only ever
 * takes things away.
 */
export function orderableNow(item: { is_available: number | boolean; category_id: number }, state: LimitedState): boolean {
  if (!item.is_available) return false
  if (!state.on) return true
  return state.sectionIds.includes(item.category_id)
}

/**
 * What to say when somebody has a cart full of things the kitchen can no
 * longer make — which happens constantly, because they filled it at nine and
 * pressed the button at ten past ten.
 */
export function limitedRefusal(state: LimitedState, names: string[]): string {
  const still = state.sectionNames.length ? state.sectionNames.join(' and ') : 'a few things'
  const what = names.length === 1 ? `${names[0]} is` : `${names.slice(0, 3).join(', ')} are`
  return `The kitchen has closed for the night — ${what} no longer available. ${still} can still be ordered.`
}

/** Said to a customer before they have chosen anything, at the top of the menu. */
export function limitedNotice(state: LimitedState): string {
  if (!state.on) return ''
  const still = state.sectionNames.length ? state.sectionNames.join(' and ') : 'a limited menu'
  return `The kitchen has closed for the night. ${still} only, paid in the app.`
}
