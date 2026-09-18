/**
 * Telling the restaurant an order has arrived, by every route it has.
 *
 * The dashboard's own chime only works while somebody is looking at it, which
 * is the one moment they do not need telling. So an order goes out three ways
 * at once and none of them blocks it:
 *
 *   - the notification row the dashboard already reads;
 *   - a push notification to every phone signed into this restaurant, which
 *     arrives with the dashboard closed and needs no account anywhere;
 *   - an email to whoever runs the place, which is slower but cannot be
 *     silently revoked the way a push subscription can.
 *
 * Push and email are each inert without their configuration, so a deployment
 * with neither behaves exactly as before.
 */
import { db } from './db.ts'
import { mailConfigured, sendMail } from './mail.ts'
import { pushToRestaurant } from './push.ts'

/**
 * Where the order emails go.
 *
 * The restaurant can name an address of its own — a kitchen printer, a shared
 * inbox — and otherwise it is whoever signed up, because that is the only
 * address we can be sure somebody reads.
 */
export function alertEmailFor(restaurantId: number): string {
  const own = db.prepare('SELECT order_email FROM restaurants WHERE id = ?').get(restaurantId) as any
  const named = String(own?.order_email ?? '').trim()
  if (named) return named
  const owner = db
    .prepare(
      `SELECT u.email FROM restaurant_staff rs
         JOIN users u ON u.id = rs.user_id
        WHERE rs.restaurant_id = ?
        ORDER BY rs.id LIMIT 1`,
    )
    .get(restaurantId) as any
  return String(owner?.email ?? '')
}

export type OrderAlert = {
  restaurantId: number
  restaurantName: string
  orderNumber: string
  where: string
  customerName: string
  customerPhone: string
  total: string
  items: string
  needsAccepting: boolean
  paid: boolean
}

/** The subject line has to answer, on a lock screen, "does this need me?" */
function title(a: OrderAlert): string {
  return a.needsAccepting ? `#${a.orderNumber} needs your yes` : `Paid order #${a.orderNumber}`
}

function summary(a: OrderAlert): string {
  return `${a.where} · ${a.customerName} · ${a.total}${a.paid ? ' · paid in the app' : ' · unpaid'}`
}

/**
 * Fires everything and waits for nothing. An order that exists is an order,
 * whether or not a push service or a mail server answered.
 */
export function alertRestaurant(a: OrderAlert): void {
  void pushToRestaurant(a.restaurantId, {
    title: title(a),
    body: summary(a),
    url: '/staff/orders',
    tag: `order-${a.orderNumber}`,
  }).catch(() => {})

  if (!mailConfigured()) return
  const to = alertEmailFor(a.restaurantId)
  if (!to) return

  void sendMail({
    to,
    subject: `${title(a)} — ${a.restaurantName}`,
    text: [
      a.needsAccepting
        ? 'A new order is waiting for you to accept it.'
        : 'A new order has come in, already paid.',
      '',
      `Order   #${a.orderNumber}`,
      `Where   ${a.where}`,
      `Name    ${a.customerName}`,
      `Phone   ${a.customerPhone || '—'}`,
      `Total   ${a.total}${a.paid ? ' (paid in the app)' : ' (unpaid)'}`,
      '',
      a.items,
      '',
      'Open the board: https://khapee.com/staff/orders',
    ].join('\n'),
  })
    .then((result) => {
      // Said out loud in the host's log, because an email that never arrives
      // looks exactly like a quiet evening. The dashboard's "send me a test"
      // is the other half of this: one proves the setup, this catches the
      // night it stops working.
      if (result !== 'sent') {
        console.warn(`[alerts] order #${a.orderNumber}: email to ${to} ${result}`)
      }
    })
    .catch((e) => console.warn(`[alerts] order #${a.orderNumber}: email threw`, e))
}
