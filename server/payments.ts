import { db } from './db.ts'

/**
 * Payment model, deliberately keyless.
 *
 * Money moves directly from the customer's UPI app to the restaurant's own VPA.
 * This app only builds the UPI request (a `upi://pay` intent, rendered locally
 * as a QR), records what the customer says they paid, and lets the restaurant
 * confirm it against their own UPI notification. No PSP, no API key, and no
 * claim that a payment succeeded until a human at the restaurant says so.
 */

export type PaymentStatus = 'CLAIMED' | 'CONFIRMED' | 'REJECTED'

/** Builds a standard UPI deep link. Amount is in paise-free rupee decimals. */
export function upiLink(opts: {
  vpa: string
  name: string
  amountCents: number
  note: string
  ref: string
}): string {
  const params = new URLSearchParams({
    pa: opts.vpa,
    pn: opts.name || opts.vpa,
    am: (opts.amountCents / 100).toFixed(2),
    cu: 'INR',
    tn: opts.note.slice(0, 50),
    tr: opts.ref.slice(0, 35),
  })
  return `upi://pay?${params.toString()}`
}

export function restaurantAcceptsUpi(restaurant: any): boolean {
  return !!String(restaurant?.upi_vpa ?? '').trim()
}

/** Sum of confirmed payments against an order. */
export function paidCents(orderId: number): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE order_id = ? AND status = 'CONFIRMED'`)
    .get(orderId) as any
  return row.n as number
}

/** Sum of payments the customer has claimed but staff have not confirmed yet. */
export function claimedCents(orderId: number): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE order_id = ? AND status = 'CLAIMED'`)
    .get(orderId) as any
  return row.n as number
}

export function shapePayment(row: any) {
  return {
    id: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number ?? undefined,
    memberId: row.member_id,
    payerName: row.payer_name,
    amountCents: row.amount_cents,
    method: row.method,
    status: row.status as PaymentStatus,
    upiRef: row.upi_ref,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  }
}

/**
 * Recomputes an order's headline payment status from its confirmed payments,
 * and marks the covered items paid. Staff can still override manually.
 */
export function syncOrderPayment(orderId: number) {
  const order = db.prepare('SELECT total_cents FROM orders WHERE id = ?').get(orderId) as any
  if (!order) return
  const paid = paidCents(orderId)
  const status = paid >= order.total_cents && order.total_cents > 0 ? 'PAID' : 'UNPAID'
  db.prepare(`UPDATE orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, orderId)
}

/** Marks a member's items paid once their own share is confirmed. */
export function markMemberItemsPaid(orderId: number, memberId: number | null) {
  if (memberId == null) {
    db.prepare(`UPDATE order_items SET paid_at = datetime('now') WHERE order_id = ? AND paid_at IS NULL`).run(orderId)
    return
  }
  db.prepare(
    `UPDATE order_items SET paid_at = datetime('now') WHERE order_id = ? AND member_id = ? AND paid_at IS NULL`,
  ).run(orderId, memberId)
}

export function memberOwedCents(orderId: number, memberId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(unit_price_cents * quantity), 0) AS n
       FROM order_items WHERE order_id = ? AND member_id = ? AND paid_at IS NULL`,
    )
    .get(orderId, memberId) as any
  return row.n as number
}

export function outstandingCents(orderId: number): number {
  const order = db.prepare('SELECT total_cents FROM orders WHERE id = ?').get(orderId) as any
  if (!order) return 0
  return Math.max(0, order.total_cents - paidCents(orderId) - claimedCents(orderId))
}
