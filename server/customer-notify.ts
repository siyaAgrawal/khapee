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
import { thanksText, waAppLink, waNumber } from '../shared/thanks.ts'
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
 * The number the thank-you would go to, or '' when there is none.
 *
 * Asked before anything is sent, so the board can say what just happened
 * instead of leaving it to be inferred from a notification that may never
 * arrive. An order with no number produces no thank-you — correctly, there is
 * nowhere to send one — but it produced no explanation either, and from the
 * kitchen that is indistinguishable from the whole system being broken. It is
 * the difference between "this order has no phone number on it" and a silence
 * that has already cost hours.
 */
export function thankNumber(orderId: number): string {
  const row = db
    .prepare('SELECT contact_phone, delivery_phone FROM orders WHERE id = ?')
    .get(orderId) as any
  if (!row) return ''
  return waNumber(row.contact_phone || row.delivery_phone || '')
}

/** What the thank-you nudge managed, in enough detail to say it out loud. */
export type ThankResult = { to: string; sent: number; devices: number; why: string }

/**
 * Taps the restaurant on the shoulder to thank the customer, and reports back.
 *
 * WhatsApp charges a business for messaging somebody who has not messaged them
 * first, and charges nothing for one person messaging another — so the app
 * does not send it. It sends the restaurant a notification, and they send the
 * message, in one tap, from the phone already in their hand.
 *
 * Awaited by the routes that accept an order, which is a departure: everything
 * else here is fired and forgotten, because whether a push service answered
 * has nothing to do with whether the kitchen moved the order along. This one
 * is waited for because the answer is the only evidence anybody gets. A
 * notification that does not arrive looks exactly like one that was never
 * sent, and telling those apart has taken days.
 */
export async function thankNudge(orderId: number): Promise<ThankResult> {
  const row = db
    .prepare(
      `SELECT order_number, customer_name, contact_phone, delivery_phone, restaurant_id
         FROM orders WHERE id = ?`,
    )
    .get(orderId) as any
  const empty = { to: '', sent: 0, devices: 0, why: '' }
  if (!row) return empty

  const to = waNumber(row.contact_phone || row.delivery_phone || '')
  if (!to) return empty

  // Pointed at a page of ours rather than straight at WhatsApp. An app
  // installed on an iPhone Home Screen runs in its own scope, and a service
  // worker asking it to open somebody else's site is declined quietly — a
  // notification that does nothing when tapped. Our own page is always
  // allowed, and from there WhatsApp is an ordinary navigation.
  const message = thanksText(row.customer_name || 'there')
  const url =
    `/thank?to=${to}` +
    `&who=${encodeURIComponent(row.customer_name || 'them')}` +
    `&text=${encodeURIComponent(message)}`

  try {
    const r = await pushToRestaurant(row.restaurant_id, {
      title: `Thank ${row.customer_name || 'them'} on WhatsApp`,
      body: `#${row.order_number} accepted. Tap to send it — it opens WhatsApp with the message written.`,
      url,
      // Tried first by the service worker. Most browsers will not open a
      // non-web address from a notification and the page above is what
      // actually carries it; on the ones that will, this is the whole journey.
      wa: waAppLink(to, message),
      tag: `khapee-thank-${orderId}`,
    })
    return { to, sent: r.sent, devices: r.devices, why: r.why }
  } catch (e) {
    return { to, sent: 0, devices: 0, why: (e as Error)?.message ?? 'could not be sent' }
  }
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
      body: thanksText(row.customer_name || 'there'),
      url: `/order/${row.order_number}`,
      tag: `khapee-thanks-${orderId}`,
    }).catch(() => {})
    return
  }

  const line = WORTH_A_BUZZ[status]
  if (!line) return

  /**
   * If part of the order was turned down, that is the news.
   *
   * "Revery is making it now" is a cheerful thing to read about an order
   * with the dish you actually wanted struck off it. Somebody who is not
   * getting what they ordered should learn it from the notification, not
   * from the counter.
   */
  if (status === 'ACCEPTED') {
    const gone = db
      .prepare('SELECT name FROM order_items WHERE order_id = ? AND accepted = 0')
      .all(orderId) as any[]
    if (gone.length) {
      const named = gone.map((g) => g.name)
      const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
      void pushToCustomer(orderId, {
        title: `Order #${row.order_number}`,
        body: `${row.restaurant} is making the rest, but ${list} ${named.length === 1 ? 'is' : 'are'} off today. You will not be charged for ${named.length === 1 ? 'it' : 'them'}.`,
        url: `/order/${row.order_number}`,
        tag: `khapee-order-${orderId}`,
      }).catch(() => {})
      return
    }
  }
  void pushToCustomer(orderId, {
    title: `Order #${row.order_number}`,
    body: line(row.restaurant),
    url: `/order/${row.order_number}`,
    tag: `khapee-order-${orderId}`,
  }).catch(() => {})
}
