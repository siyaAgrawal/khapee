/**
 * The two halves a till can reach Khapee by, and the file for everything else.
 *
 * Owner-facing setup lives on the staff router with every other setting. The
 * pull endpoint below does not: a billing system has no session and no
 * password, it has a key, so it authenticates with the key and nothing else.
 * That is the whole reason this file is separate — mixing a machine's
 * authentication into the routes a person signs in to is how one ends up
 * accepting the other.
 */
import { Router } from 'express'
import { db } from '../db.ts'
import {
  billingPayload,
  checkWebhookUrl,
  restaurantForKey,
  type BillingEvent,
} from '../order-feed.ts'

export const orderFeedRouter = Router()

/** Orders the till has not seen, newest last, so it can be replayed in order. */
function ordersSince(restaurantId: number, sinceId: number, limit: number) {
  return db
    .prepare(
      `SELECT id FROM orders WHERE restaurant_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
    )
    .all(restaurantId, sinceId, limit) as any[]
}

/**
 * A till asking what it has missed.
 *
 * Paged by order id rather than by time. A clock disagreeing by a few seconds
 * between two machines is ordinary, and with a timestamp cursor that costs you
 * an order — the one placed in the gap — silently and exactly once. An id is
 * the same number on both ends.
 */
orderFeedRouter.get('/orders', (req, res) => {
  const key = String(req.get('x-khapee-key') ?? req.query.key ?? '')
  const restaurantId = restaurantForKey(key)
  if (!restaurantId) return res.status(401).json({ error: 'Unknown or missing billing key.' })

  const since = Number(req.query.since ?? 0) || 0
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
  const rows = ordersSince(restaurantId, since, limit)
  const orders = rows.map((r) => billingPayload(r.id, 'order.status')?.order).filter(Boolean)

  res.set('Cache-Control', 'no-store')
  res.json({
    orders,
    // Where to carry on from. Unchanged when there was nothing, so a till that
    // polls every minute all afternoon never walks its cursor backwards.
    cursor: rows.length ? rows[rows.length - 1].id : since,
    more: rows.length === limit,
  })
})

/** One order by its number, for a till reconciling something in particular. */
orderFeedRouter.get('/orders/:number', (req, res) => {
  const key = String(req.get('x-khapee-key') ?? req.query.key ?? '')
  const restaurantId = restaurantForKey(key)
  if (!restaurantId) return res.status(401).json({ error: 'Unknown or missing billing key.' })

  const number = String(req.params.number).replace('#', '').toUpperCase()
  const row = db
    .prepare('SELECT id FROM orders WHERE order_number = ? AND restaurant_id = ?')
    .get(number, restaurantId) as any
  if (!row) return res.status(404).json({ error: 'No such order here.' })
  res.set('Cache-Control', 'no-store')
  res.json(billingPayload(row.id, 'order.status'))
})

/** Escapes a field for CSV, where a comma in a dish name would split the row. */
function csvCell(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The same orders as a file, one row per dish.
 *
 * One row per dish rather than per order, because that is the shape anything
 * doing arithmetic wants — a spreadsheet summing what sold, an accountant
 * reconciling a day. An order's own totals repeat down its rows, which reads
 * oddly and sums correctly, and that is the right way round.
 */
orderFeedRouter.get('/orders.csv', (req, res) => {
  const key = String(req.get('x-khapee-key') ?? req.query.key ?? '')
  const restaurantId = restaurantForKey(key)
  if (!restaurantId) return res.status(401).type('text/plain').send('Unknown or missing billing key.')

  const since = Number(req.query.since ?? 0) || 0
  const rows = ordersSince(restaurantId, since, 2000)
  const head = [
    'order_number', 'placed_at', 'status', 'service', 'table', 'customer_name', 'customer_phone',
    'item', 'quantity', 'unit_price', 'line_total', 'order_subtotal', 'delivery_fee',
    'order_total', 'payment_status', 'payment_method', 'upi_reference',
  ]
  const lines = [head.join(',')]
  for (const r of rows) {
    const p = billingPayload(r.id, 'order.status')
    if (!p) continue
    const o = p.order
    for (const item of o.items.length ? o.items : [null]) {
      lines.push(
        [
          o.number, o.placedAt, o.status, o.service, o.table ?? '', o.customer.name, o.customer.phone,
          item?.name ?? '', item?.quantity ?? 0, item?.unitPrice ?? '0.00', item?.line ?? '0.00',
          o.subtotal, o.deliveryFee, o.total, o.payment.status, o.payment.method,
          o.payment.upiReference ?? '',
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }

  res.set('Cache-Control', 'no-store')
  res.set('Content-Disposition', 'attachment; filename="khapee-orders.csv"')
  // A BOM, so Excel opens rupee symbols and Hindi names as text rather than
  // as mojibake somebody then has to retype.
  res.type('text/csv; charset=utf-8').send('﻿' + lines.join('\r\n') + '\r\n')
})

/**
 * What a receiver has to do, written where whoever is wiring it up will look.
 *
 * Served as plain text from the app rather than kept in a repository nobody
 * reading this has access to: the person integrating a till is usually not
 * the person who runs Khapee, and "ask them for the docs" is a day lost.
 */
orderFeedRouter.get('/help', (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`
  res.type('text/plain; charset=utf-8').set('Cache-Control', 'no-store').send(
    `Khapee — sending orders to a billing system
${'='.repeat(46)}

Three ways in. Use whichever your system can manage.

1. WEBHOOK (push)
   Khapee POSTs application/json to the address you set in
   Settings -> Billing, as each order is placed, moved along, or paid.

   Headers
     x-khapee-event      order.placed | order.status | order.paid | test
     x-khapee-signature  sha256=<hex>

   Verify the signature before trusting the body:
     HMAC-SHA256 of the raw request body, keyed with your billing secret,
     compared with a constant-time comparison. A mismatch means it did not
     come from Khapee.

   Answer 2xx. Anything else is retried twice, then recorded as failed and
   shown on the Billing screen. A 4xx is treated as a refusal and not
   retried. Redirects are not followed.

2. KEY (pull)
   For a till that cannot be reached from the internet.

     GET ${origin}/api/billing/orders?since=<cursor>
     Header: x-khapee-key: <your key>

   Returns { orders: [...], cursor, more }. Keep the cursor and pass it
   back next time. Paged by order id, not by time, so a clock that
   disagrees by a few seconds cannot lose you an order.

     GET ${origin}/api/billing/orders/<order number>

3. CSV (file)
     GET ${origin}/api/billing/orders.csv?since=<cursor>
     Header: x-khapee-key: <your key>

   One row per dish, with each order's totals repeated across its rows.

MONEY
  Every amount appears twice: <name>Paise as an exact integer, and <name>
  as a rupee string like "790.00". Use whichever your system takes. Do not
  use a float.

THE KEY AND THE SECRET
  Both are shown once when generated and cannot be read back — only
  replaced. Treat them as passwords.
`,
  )
})

export { type BillingEvent }
