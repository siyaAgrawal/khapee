export type TableContext = {
  restaurantId: number
  restaurantName: string
  tableId: number
  tableLabel: string
  tableToken: string
  /** When the QR was scanned, so a token cannot be kept and used from home. */
  scannedAt?: number
}

/**
 * How long a scan keeps counting as being at the table.
 *
 * Long enough that no meal, however slow, is ever interrupted to ask for a
 * code; short enough that a token kept from last week is not a standing pass
 * to order as though sitting in the restaurant.
 */
const VALID_HOURS = 12

const KEY = 'khapee.table'

/**
 * Remembered when a customer scans a table QR, so nothing else is ever asked
 * for while they are at that table.
 *
 * In localStorage rather than sessionStorage. A phone locks, a tab is dropped
 * to reclaim memory, someone follows a link and comes back — sessionStorage is
 * gone in all three, and a customer sitting in front of the QR they already
 * scanned was being asked to scan it again, or to go and ask staff for a code.
 * The token is printed on the table in the first place; keeping it on the
 * device that read it gives nobody anything they did not already have.
 */
export function saveTableContext(ctx: TableContext) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...ctx, scannedAt: ctx.scannedAt ?? Date.now() }))
  } catch {
    /* ignore */
  }
}

export function readTableContext(restaurantId?: number): TableContext | null {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw) as TableContext
    if (restaurantId && ctx.restaurantId !== restaurantId) return null
    // Anything written before this had a timestamp is treated as scanned now:
    // it came from sessionStorage, so the tab is still the one that scanned it.
    if (ctx.scannedAt && Date.now() - ctx.scannedAt > VALID_HOURS * 3600_000) return null
    return ctx
  } catch {
    return null
  }
}

export function clearTableContext() {
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** Guest order receipts, so a signed-out customer can still reopen them. */
const RECEIPTS = 'khapee.receipts'

export function rememberReceipt(orderNumber: string, token: string) {
  try {
    const all = JSON.parse(localStorage.getItem(RECEIPTS) || '{}')
    all[orderNumber] = token
    localStorage.setItem(RECEIPTS, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

export function receiptToken(orderNumber: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(RECEIPTS) || '{}')
    return all[orderNumber] ?? null
  } catch {
    return null
  }
}

export function allReceipts(): { orderNumber: string; token: string }[] {
  try {
    const all = JSON.parse(localStorage.getItem(RECEIPTS) || '{}')
    return Object.entries(all).map(([orderNumber, token]) => ({ orderNumber, token: String(token) }))
  } catch {
    return []
  }
}
