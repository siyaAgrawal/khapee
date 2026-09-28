/**
 * What came in, split by how it came in — and who it came from.
 *
 * At the end of a night somebody counts the drawer. The number in the drawer
 * has to match the cash Khapee says it took, and the UPI apps have to match
 * the UPI. A single "taken today" figure cannot be checked against anything:
 * it is right or wrong as a whole, and when it is wrong there is nowhere to
 * start looking. Split by method it reconciles against two things a person can
 * actually hold — a drawer and a phone.
 *
 * Refunds come out. A day that took eight hundred and gave two hundred back
 * took six hundred, and a report that says eight hundred will be believed by
 * the person doing the accounts.
 */
import { db } from './db.js'

/** Payments belong to a restaurant through their order, or through their bill. */
const SCOPED = `
  FROM payments p
  LEFT JOIN orders o ON o.id = p.order_id
  LEFT JOIN invoices i ON i.id = p.invoice_id
 WHERE COALESCE(o.restaurant_id, i.restaurant_id) = ?
`

export type Window = { from?: string; to?: string; days?: number }

/**
 * The window, as SQL.
 *
 * Dates are compared as the database stores them — "YYYY-MM-DD HH:MM:SS" in
 * UTC — and a restaurant's day is not UTC's day. Indore is 5h30 ahead, so a
 * sale at half past ten at night is tomorrow to the database, and "today's
 * takings" asked at closing time would have shown almost nothing. So the day
 * is shifted before it is compared, and everything here means a day as the
 * restaurant lived it.
 */
const LOCAL = "datetime(p.created_at, '+5 hours', '+30 minutes')"

function windowClause(w: Window): { sql: string; params: any[] } {
  if (w.from || w.to) {
    const parts: string[] = []
    const params: any[] = []
    if (w.from) {
      parts.push(`date(${LOCAL}) >= date(?)`)
      params.push(w.from)
    }
    if (w.to) {
      parts.push(`date(${LOCAL}) <= date(?)`)
      params.push(w.to)
    }
    return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params }
  }
  const days = Math.max(0, Math.min(365, Math.floor(w.days ?? 0)))
  // 0 days means today: everything since this morning, the restaurant's morning.
  return {
    sql: ` AND date(${LOCAL}) >= date('now', '+5 hours', '+30 minutes', '-${days} days')`,
    params: [],
  }
}

export type MethodTotal = { method: string; count: number; amountCents: number }

export type Takings = {
  netCents: number
  takenCents: number
  refundedCents: number
  byMethod: MethodTotal[]
  /** Customers who say they have paid and nobody has checked yet. */
  awaitingCents: number
  awaitingCount: number
  payments: ReturnType<typeof shapeTaking>[]
}

function shapeTaking(p: any) {
  return {
    id: p.id as number,
    at: p.created_at as string,
    amountCents: p.amount_cents as number,
    method: String(p.method ?? 'cash'),
    status: p.status as 'CLAIMED' | 'CONFIRMED' | 'REJECTED',
    isRefund: p.refund_of !== null,
    payerName: (p.payer_name as string) ?? '',
    upiRef: (p.upi_ref as string) ?? '',
    orderNumber: (p.order_number as string) ?? '',
    tableLabel: (p.table_label as string) ?? null,
    customerName: (p.customer_name as string) ?? '',
    customerPhone: (p.contact_phone as string) ?? '',
    invoiceNumber: (p.invoice_number as string) ?? '',
    changeCents: p.change_cents as number | null,
    reason: (p.reason as string) ?? '',
  }
}

/**
 * @param method 'all', or one of cash/upi/card — what the owner is looking at.
 */
export function takings(restaurantId: number, w: Window = {}, method = 'all'): Takings {
  const win = windowClause(w)
  const rows = db
    .prepare(
      `SELECT p.*, o.order_number, o.table_label, o.customer_name, o.contact_phone,
              i.number AS invoice_number
       ${SCOPED}${win.sql}
        ORDER BY p.id DESC
        LIMIT 500`,
    )
    .all(restaurantId, ...win.params) as any[]

  const wanted = method === 'all' ? rows : rows.filter((p) => String(p.method) === method)
  const money = rows.filter((p) => p.status === 'CONFIRMED')
  const taken = money.filter((p) => p.refund_of === null)
  const back = money.filter((p) => p.refund_of !== null)

  const byMethod = new Map<string, MethodTotal>()
  for (const p of money) {
    const key = String(p.method ?? 'cash')
    const at = byMethod.get(key) ?? { method: key, count: 0, amountCents: 0 }
    at.count += p.refund_of === null ? 1 : 0
    at.amountCents += p.refund_of === null ? p.amount_cents : -p.amount_cents
    byMethod.set(key, at)
  }

  const claimed = rows.filter((p) => p.status === 'CLAIMED')

  return {
    netCents: money.reduce((n, p) => n + (p.refund_of === null ? p.amount_cents : -p.amount_cents), 0),
    takenCents: taken.reduce((n, p) => n + p.amount_cents, 0),
    refundedCents: back.reduce((n, p) => n + p.amount_cents, 0),
    byMethod: [...byMethod.values()].sort((a, b) => b.amountCents - a.amountCents),
    awaitingCents: claimed.reduce((n, p) => n + p.amount_cents, 0),
    awaitingCount: claimed.length,
    payments: wanted.map(shapeTaking),
  }
}

/**
 * Every order this restaurant has taken, with the person who placed it.
 *
 * The board forgets on purpose — it is about tonight — and everything past
 * tonight was only reachable by scrolling it, which meant that "the lady who
 * ordered the paneer on Tuesday and left her bag" could not be found at all.
 * A phone number and a date are what somebody actually has when they ask.
 */
export type HistoryRow = {
  id: number
  orderNumber: string
  createdAt: string
  status: string
  serviceMode: string
  place: string
  customerName: string
  customerPhone: string
  items: { name: string; quantity: number }[]
  itemCount: number
  totalCents: number
  paidCents: number
  paymentStatus: string
  methods: string[]
  invoiceNumber: string
}

export function orderHistory(
  restaurantId: number,
  opts: { q?: string; days?: number; limit?: number; offset?: number } = {},
): { rows: HistoryRow[]; total: number } {
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 50)))
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const days = Math.max(0, Math.min(730, Math.floor(opts.days ?? 90)))
  const q = (opts.q ?? '').trim()

  const params: any[] = [restaurantId]
  let where = `o.restaurant_id = ? AND o.created_at >= datetime('now', '-${days} days')`
  if (q) {
    // Matched against the things somebody actually knows: what they are
    // called, the number they rang from, the order number on their receipt,
    // the table they sat at — and the dish, because "the one who had the
    // mutton" is how a kitchen remembers people.
    where += ` AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR o.contact_phone LIKE ?
                 OR o.table_label LIKE ?
                 OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.name LIKE ?))`
    const like = `%${q}%`
    params.push(like, like, like, like, like)
  }

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where}`).get(...params) as any).n as number

  const rows = db
    .prepare(
      `SELECT o.*, i.number AS invoice_number
         FROM orders o
         LEFT JOIN invoices i ON i.id = o.invoice_id
        WHERE ${where}
        ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as any[]

  const itemsOf = db.prepare('SELECT name, quantity FROM order_items WHERE order_id = ? ORDER BY id')
  const paysOf = db.prepare(
    "SELECT method, amount_cents, refund_of FROM payments WHERE order_id = ? AND status = 'CONFIRMED'",
  )

  return {
    total,
    rows: rows.map((o) => {
      const items = itemsOf.all(o.id) as any[]
      const pays = paysOf.all(o.id) as any[]
      return {
        id: o.id,
        orderNumber: o.order_number,
        createdAt: o.created_at,
        status: o.status,
        serviceMode: o.service_mode ?? 'dine_in',
        /** Car, takeaway, at the restaurant… — see howOrdered in shared/orders.ts. */
        serviceType:
          o.service_mode === 'car' || o.service_mode === 'delivery' || o.service_mode === 'precinct'
            ? o.service_mode
            : o.order_type === 'pickup'
              ? 'pickup'
              : o.takeaway
                ? 'takeaway'
                : 'dine_in',
        place: o.table_label ?? (o.service_mode === 'delivery' ? 'Delivery' : 'Counter'),
        customerName: o.customer_name ?? '',
        customerPhone: o.contact_phone ?? '',
        items: items.map((i) => ({ name: i.name, quantity: i.quantity })),
        itemCount: items.reduce((n, i) => n + i.quantity, 0),
        totalCents: o.total_cents,
        paidCents: pays.reduce((n, p) => n + (p.refund_of === null ? p.amount_cents : -p.amount_cents), 0),
        paymentStatus: o.payment_status,
        methods: [...new Set(pays.filter((p) => p.refund_of === null).map((p) => String(p.method)))],
        invoiceNumber: o.invoice_number ?? '',
      }
    }),
  }
}
