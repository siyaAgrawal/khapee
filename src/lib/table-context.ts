export type TableContext = {
  restaurantId: number
  restaurantName: string
  tableId: number
  tableLabel: string
  tableToken: string
}

const KEY = 'tablo.table'

/** Remembered when a customer scans a table QR, so checkout can skip the code step. */
export function saveTableContext(ctx: TableContext) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function readTableContext(restaurantId?: number): TableContext | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw) as TableContext
    if (restaurantId && ctx.restaurantId !== restaurantId) return null
    return ctx
  } catch {
    return null
  }
}

export function clearTableContext() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** Guest order receipts, so a signed-out customer can still reopen them. */
const RECEIPTS = 'tablo.receipts'

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
