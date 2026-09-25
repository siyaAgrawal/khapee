import { db } from './db.ts'
import { publish } from './events.ts'
import { tellCustomer } from './customer-notify.ts'
import { tellBilling } from './order-feed.ts'
import { acceptRemainingItems, getOrder } from './orders-service.ts'
import { canTransition, flowFor, STATUS_LABEL, type OrderStatus, type ServiceType } from '../shared/orders.ts'

/**
 * Moving an order along, from wherever the instruction came from.
 *
 * This lived inside the staff route, which was correct while a person
 * pressing a button in our own dashboard was the only way an order could
 * change. It is not any more: a Petpooja kitchen accepts orders on a Windows
 * till and the answer arrives here as a webhook, and that answer has to do
 * every single thing the button does — write the event, notify the customer's
 * phone, wake the live stream, tell the billing feed, accept the remaining
 * dishes — or the two routes drift and the customer's screen starts lying
 * depending on which till the restaurant happens to use.
 *
 * So there is one function and both callers use it.
 */
export type StatusResult =
  | { ok: true; order: any }
  | { ok: false; status: number; error: string }

/** Whose flow this order follows, which decides which moves are legal. */
export function serviceOf(row: any): ServiceType {
  return row.service_mode === 'car'
    ? 'car'
    : row.service_mode === 'delivery'
      ? 'delivery'
      : row.service_mode === 'precinct'
        ? 'precinct'
        : row.order_type === 'pickup'
          ? 'pickup'
          : row.takeaway
            ? 'takeaway'
            : 'dine_in'
}

/** Whether every dish on the order has been turned down one at a time. */
function nothingLeft(orderId: number): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN accepted = 0 THEN 1 ELSE 0 END) AS off
         FROM order_items WHERE order_id = ?`,
    )
    .get(orderId) as any
  return row.total > 0 && row.total === (row.off ?? 0)
}

export function applyStatus(
  orderId: number,
  to: OrderStatus,
  actor: 'staff' | 'petpooja' | 'customer',
  reason = '',
  { catchUp = false }: { catchUp?: boolean } = {},
): StatusResult {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any
  if (!row) return { ok: false, status: 404, error: 'Order not found.' }
  if (row.status === to) return { ok: true, order: getOrder(orderId) }

  /*
   * Another system reporting a step we never heard about.
   *
   * Khapee's flow goes accepted, preparing, ready. Petpooja's till reports
   * accepted and then food-ready, with nothing in between — their staff never
   * press a "started cooking" button because their software does not have
   * one. Refusing that, which is what a strict one-step-at-a-time machine
   * does, means a restaurant marks food ready on their own till and the
   * customer's phone still says the kitchen has not started.
   *
   * So a caller that is relaying another system's state may walk forward
   * through the steps it skipped. Each one is written to the event log
   * properly rather than being jumped over, because the customer's tracker
   * draws that list and a missing step there reads as a broken order. Only
   * forwards, and only one order at a time.
   */
  if (catchUp && !canTransition(serviceOf(row), row.status, to)) {
    const flow = flowFor(serviceOf(row))
    const from = flow.indexOf(row.status as OrderStatus)
    const target = flow.indexOf(to)
    if (from !== -1 && target > from + 1) {
      for (let i = from + 1; i < target; i++) {
        const step = applyStatus(orderId, flow[i], actor, '', { catchUp: false })
        if (!step.ok) return step
      }
      return applyStatus(orderId, to, actor, reason, { catchUp: false })
    }
  }

  if (!canTransition(serviceOf(row), row.status, to)) {
    return { ok: false, status: 400, error: `Cannot move ${row.status} to ${to}.` }
  }
  if (to === 'ACCEPTED' && nothingLeft(orderId)) {
    return {
      ok: false,
      status: 400,
      error: 'Every dish on this order has been turned down. Decline the order instead, so the customer is told why.',
    }
  }

  db.transaction(() => {
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(to, orderId)
    db.prepare(`INSERT INTO order_events (order_id, status, actor) VALUES (?, ?, ?)`).run(orderId, to, actor)
    if (reason && (to === 'DECLINED' || to === 'CANCELLED')) {
      db.prepare('UPDATE orders SET declined_reason = ? WHERE id = ?').run(reason, orderId)
    }
    if (row.user_id) {
      db.prepare(
        `INSERT INTO notifications (user_id, order_id, restaurant_id, title, body)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(row.user_id, orderId, row.restaurant_id, `Order #${row.order_number} — ${STATUS_LABEL[to]}`, '')
    }
  })()

  if (to === 'ACCEPTED') acceptRemainingItems(orderId)

  const order = getOrder(orderId)
  tellCustomer(orderId, to)
  tellBilling(row.restaurant_id, orderId, 'order.status')
  publish('order:update', { restaurantId: row.restaurant_id, userId: row.user_id, orderId, order })
  return { ok: true, order }
}
