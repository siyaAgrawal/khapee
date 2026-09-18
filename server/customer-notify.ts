/**
 * Telling the customer, on the phone they ordered from, for nothing.
 *
 * WhatsApp bills a business per order for messaging somebody who has not
 * messaged them first. A push notification through the browser they already
 * used costs nothing, now or ever, and reaches the same locked screen — so
 * this is the channel that runs by default, and Meta's is the one that sits
 * switched off until somebody decides it is worth paying for.
 *
 * Two kinds of message, and only two, because a phone that buzzes at every
 * internal step gets its notifications turned off:
 *
 *   - the ones worth looking up for: the kitchen said yes, or the food is
 *     ready, or it is on its way;
 *   - the thank-you, once the kitchen has said yes, which is the moment the
 *     restaurant knows the order is really happening and has a reason to
 *     write to the customer.
 */
import { thanksText, waLink } from '../shared/thanks.ts'
import { isTerminal, type OrderStatus, type ServiceType } from '../shared/orders.ts'
import { db } from './db.ts'
import { pushToCustomer, pushToRestaurant } from './push.ts'

/** What a customer would actually want their phone to light up for. */
const WORTH_A_BUZZ: Partial<Record<OrderStatus, (restaurant: string) => string>> = {
  ACCEPTED: (r) => `${r} is making it now.`,
  READY: (r) => `Ready to collect at ${r}.`,
  READY_FOR_PICKUP: (r) => `Ready to collect at ${r}.`,
  DELIVERING: () => 'On its way to you now.',
  OUT_FOR_DELIVERY: () => 'On its way to you now.',
  DECLINED: (r) => `${r} could not take this one.`,
}

/**
 * Fires whatever this status is worth, and never throws.
 *
 * Deliberately not awaited by the route that changes the status: whether a
 * push service answered has nothing to do with whether the kitchen has moved
 * the order along.
 */
export function tellCustomer(orderId: number, status: OrderStatus): void {
  const row = db
    .prepare(
      `SELECT o.order_number, o.customer_name, o.service_mode, o.contact_phone, o.delivery_phone,
              o.restaurant_id, r.name AS restaurant
         FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.id = ?`,
    )
    .get(orderId) as any
  if (!row) return

  // The kitchen has said yes: the order is really happening, so this is when
  // the restaurant has something worth saying to the customer.
  if (status === 'ACCEPTED') {
    // The free way to reach a customer who never allowed notifications.
    // WhatsApp charges a business for messaging somebody who has not messaged
    // them first, and charges nothing for one person messaging another — so
    // the app does not send it. It taps the restaurant on the shoulder and
    // they send it, in one tap, from the phone already in their hand.
    const link = waLink(
      row.contact_phone || row.delivery_phone || '',
      thanksText(row.customer_name || 'there', row.restaurant),
    )
    if (link) {
      void pushToRestaurant(row.restaurant_id, {
        title: `Thank ${row.customer_name || 'them'} on WhatsApp`,
        body: `#${row.order_number} accepted. Tap to send it — it opens WhatsApp with the message written.`,
        url: link,
        tag: `khapee-thank-${orderId}`,
      }).catch(() => {})
    }
  }

  const done = isTerminal((row.service_mode ?? 'pickup') as ServiceType, status) && status !== 'DECLINED'
  if (done) {
    // Once per order, even if a terminal status is set twice by a mis-tap.
    const already = db
      .prepare('SELECT COUNT(*) n FROM customer_push WHERE order_id = ? AND thanked_at IS NOT NULL')
      .get(orderId) as any
    if (already?.n) return
    db.prepare("UPDATE customer_push SET thanked_at = datetime('now') WHERE order_id = ?").run(orderId)
    void pushToCustomer(orderId, {
      title: `Thanks from ${row.restaurant}`,
      body: thanksText(row.customer_name || 'there', row.restaurant),
      url: `/order/${row.order_number}`,
      tag: `khapee-thanks-${orderId}`,
    }).catch(() => {})
    return
  }

  const line = WORTH_A_BUZZ[status]
  if (!line) return
  void pushToCustomer(orderId, {
    title: `Order #${row.order_number}`,
    body: line(row.restaurant),
    url: `/order/${row.order_number}`,
    tag: `khapee-order-${orderId}`,
  }).catch(() => {})
}
