/**
 * Who is ordering, and what they had last time — remembered on this phone.
 *
 * Asking for a name and a ten-digit number on every order was most of the
 * typing in Khapee, and the answer never changes. Asked once, kept here, and
 * filled in from then on. Nothing leaves the phone that was not already sent
 * with the order itself.
 */
const ME = 'khapee.me'
const LAST = 'khapee.lastOrder'

export type Me = { name: string; phone: string }

export function readMe(): Me | null {
  try {
    const me = JSON.parse(localStorage.getItem(ME) || 'null')
    if (me && typeof me.name === 'string' && typeof me.phone === 'string') return me
  } catch {
    /* a private window, or storage turned off: they simply type it */
  }
  return null
}

export function saveMe(name: string, phone: string): void {
  try {
    const n = name.trim()
    const p = phone.trim()
    if (n.length >= 2 && p.replace(/\D/g, '').length >= 10) localStorage.setItem(ME, JSON.stringify({ name: n, phone: p }))
  } catch {
    /* nothing to do */
  }
}

export type LastLine = { menuItemId: number; quantity: number; name: string; priceCents: number }

/** The last order at each restaurant, for "Order again". */
export function readLastOrder(restaurantId: number): LastLine[] {
  try {
    const all = JSON.parse(localStorage.getItem(LAST) || '{}')
    const lines = all?.[restaurantId]
    return Array.isArray(lines) ? lines : []
  } catch {
    return []
  }
}

export function saveLastOrder(restaurantId: number, lines: LastLine[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(LAST) || '{}') || {}
    all[restaurantId] = lines.slice(0, 20)
    localStorage.setItem(LAST, JSON.stringify(all))
  } catch {
    /* nothing to do */
  }
}
