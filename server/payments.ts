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
  /** Shown in the restaurant's own UPI app — put the order number in it. */
  note: string
}): string {
  /*
   * Four parameters, and deliberately not five.
   *
   * `tr` — the merchant transaction reference — was on every request, and it
   * is what broke them. `tr` tells the app this is a MERCHANT collect, and a
   * merchant collect can only be serviced by a merchant VPA. These are
   * personal handles (`@ybl`, `@okhdfcbank`), because that is what a café in
   * Indore has. Google Pay and PhonePe see a merchant reference pointed at a
   * personal VPA, cannot reconcile the two, and refuse — some with "unable to
   * process", some by doing nothing at all. It failed in the QR too, because
   * the QR encodes this same string, which is why it failed for everybody
   * rather than for the people on one platform.
   *
   * What is left is the plain person-to-person request every UPI app in India
   * has handled since the beginning: pay this VPA, this much, in rupees.
   *
   * The reference is not lost, it has moved. It rides in `tn`, the note —
   * which is the field that actually shows up in the restaurant's own UPI
   * app, so they can match a payment to an order by reading it.
   */
  const params = new URLSearchParams({
    pa: opts.vpa,
    pn: opts.name || opts.vpa,
    am: (opts.amountCents / 100).toFixed(2),
    cu: 'INR',
    tn: opts.note.slice(0, 50),
  })
  /*
   * `+` for a space is a form-encoding convention, not a URI one, and a UPI
   * app is not reading a form. Several parse the query themselves and show
   * the payee as "VIBHANSHI+JAIN", which is the name the customer is being
   * asked to trust at the moment they are deciding whether to pay. %20 is the
   * literal escape and every app decodes it.
   */
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`
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

/**
 * UPI only: the restaurant has switched cash off (Settings → "Take UPI only")
 * and has a UPI ID to be paid into. A customer's order there is paid before it
 * is placed, and it only reaches the kitchen once staff have seen the money in
 * their own UPI app and accepted it.
 */
export function upiOnly(restaurantId: number): boolean {
  const r = db.prepare('SELECT cash_disabled, upi_vpa FROM restaurants WHERE id = ?').get(restaurantId) as any
  return !!r?.cash_disabled && !!String(r?.upi_vpa ?? '').trim()
}

/**
 * Accepting a UPI-only order is staff saying "the money is in our UPI app",
 * so every payment the customer said they sent is ticked off in the same tap.
 */
export function confirmClaims(orderId: number) {
  const claims = db
    .prepare(`SELECT id FROM payments WHERE order_id = ? AND status = 'CLAIMED'`)
    .all(orderId) as { id: number }[]
  if (!claims.length) return
  db.transaction(() => {
    db.prepare(
      `UPDATE payments SET status = 'CONFIRMED', settled_at = datetime('now') WHERE order_id = ? AND status = 'CLAIMED'`,
    ).run(orderId)
    markMemberItemsPaid(orderId, null)
    syncOrderPayment(orderId)
  })()
}
