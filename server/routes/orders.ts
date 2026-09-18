import { Router } from 'express'
import { db } from '../db.ts'
import { pushConfigured, pushPublicKey, pushReason, saveCustomerSubscription } from '../push.ts'
import { requireAuth } from '../auth.ts'
import { checkAccessCode, createOrder, getOrder, shapeOrder } from '../orders-service.ts'
import { normalizeCode } from '../ids.ts'
import { upiLink } from '../payments.ts'
import { sessionByToken } from '../dining.ts'
import { money } from '../../shared/orders.ts'

export const ordersRouter = Router()

/** Pre-flight check so the customer learns a code is bad before building an order. */
ordersRouter.post('/verify-code', (req, res) => {
  const restaurantId = Number(req.body?.restaurantId)
  const code = normalizeCode(req.body?.code)
  if (!restaurantId) return res.status(400).json({ error: 'Pick a restaurant first.' })
  if (code.length !== 6) return res.status(400).json({ error: 'Access codes are 6 characters, like K7X92P.' })

  const check = checkAccessCode(code, restaurantId)
  if (!check.ok) return res.status(400).json({ error: check.message, reason: check.reason })

  const expiresAt = db
    .prepare(`SELECT strftime('%s', expires_at) - strftime('%s','now') AS seconds FROM access_codes WHERE id = ?`)
    .get(check.row.id) as any
  res.json({ ok: true, code, secondsLeft: Math.max(0, Number(expiresAt?.seconds ?? 0)) })
})

ordersRouter.get('/tables/:restaurantId', (req, res) => {
  const restaurantId = Number(req.params.restaurantId)
  const rows = db
    .prepare('SELECT id, label, seats FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id')
    .all(restaurantId) as any[]
  res.json({ tables: rows })
})

/** Everything the checkout needs to know about paying this restaurant. */
ordersRouter.get('/payment-options/:restaurantId', (req, res) => {
  const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(req.params.restaurantId)) as any
  if (!r) return res.status(404).json({ error: 'That restaurant no longer exists.' })
  res.json({
    acceptsUpi: !!String(r.upi_vpa ?? '').trim(),
    payeeName: r.upi_name || r.name,
    acceptsPickup: !!r.accepts_pickup,
    acceptsTakeaway: !!r.accepts_takeaway,
    acceptsGroups: !!r.accepts_groups,
  })
})

/** Builds a UPI request for a cart before the order exists. */
ordersRouter.post('/payment-request', (req, res) => {
  const restaurantId = Number(req.body?.restaurantId)
  const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId) as any
  if (!r) return res.status(404).json({ error: 'That restaurant no longer exists.' })
  if (!String(r.upi_vpa ?? '').trim()) {
    return res.status(409).json({ error: `${r.name} has not set up UPI. Please pay at the counter.`, payAtCounter: true })
  }
  const lines = Array.isArray(req.body?.items) ? req.body.items : []
  let amountCents = 0
  for (const line of lines) {
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(line?.menuItemId)) as any
    if (!item || item.restaurant_id !== restaurantId) {
      return res.status(400).json({ error: 'One of the items is no longer on this menu.' })
    }
    amountCents += item.price_cents * Math.max(1, Math.floor(Number(line.quantity) || 1))
  }
  if (amountCents <= 0) return res.status(400).json({ error: 'Your cart is empty.' })

  // What the customer is actually charged, not just what the dishes cost.
  // This summed the menu lines alone, so a delivery quoted at ₹480 in the
  // checkout asked their UPI app for ₹450 and left the restaurant carrying the
  // fee it had just told them about.
  const session = req.body?.sessionToken ? sessionByToken(String(req.body.sessionToken)) : null
  if (session && session.restaurant_id === restaurantId && session.service_mode === 'delivery' && session.area_id) {
    const area = db
      .prepare('SELECT * FROM delivery_areas WHERE id = ? AND restaurant_id = ?')
      .get(session.area_id, restaurantId) as any
    if (area) {
      // No point taking money for an order the kitchen will turn away.
      if (amountCents < area.min_order_cents) {
        return res.status(400).json({
          error: `${area.name} has a ${money(area.min_order_cents)} minimum — add ${money(area.min_order_cents - amountCents)} more.`,
        })
      }
      amountCents += area.fee_cents
    }
  }

  const ref = `TABLO${Date.now().toString(36).toUpperCase()}`
  res.json({
    amountCents,
    vpa: r.upi_vpa,
    payeeName: r.upi_name || r.name,
    reference: ref,
    upiLink: upiLink({
      vpa: r.upi_vpa,
      name: r.upi_name || r.name,
      amountCents,
      note: `${r.name} order`,
      ref,
    }),
  })
})

ordersRouter.post('/', (req, res) => {
  const body = req.body ?? {}
  const result = createOrder({
    restaurantId: Number(body.restaurantId),
    type: body.type === 'pickup' ? 'pickup' : 'dine_in',
    items: Array.isArray(body.items) ? body.items : [],
    customerName: String(body.customerName ?? req.user?.name ?? '').trim(),
    contactPhone: String(body.contactPhone ?? '').trim(),
    // A customer ordering for themselves has to be reachable; a counter sale
    // does not, which is why this is set here and not inside createOrder.
    requirePhone: true,
    userId: req.user?.id ?? null,
    note: body.note,
    paymentMethod: body.paymentMethod,
    accessCode: body.accessCode ? normalizeCode(body.accessCode) : null,
    tableToken: body.tableToken ?? null,
    tableId: body.tableId ? Number(body.tableId) : null,
    takeaway: !!body.takeaway,
    sessionToken: body.sessionToken ?? null,
    paymentClaim: body.paymentClaim ?? null,
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  res.status(201).json({ order: result.order })
})

/** Customer order history for a signed-in account. */
ordersRouter.get('/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, r.name AS restaurant_name, r.emoji AS restaurant_emoji, r.hue AS restaurant_hue,
              r.slug AS restaurant_slug, r.prep_minutes
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 50`,
    )
    .all(req.user!.id) as any[]
  res.json({ orders: rows.map(shapeOrder) })
})

/** The half of the keypair a customer's browser needs in order to subscribe. */
ordersRouter.get('/notify-key', (_req, res) => {
  res.json({ available: pushConfigured(), publicKey: pushPublicKey() })
})

/**
 * Order lookup for the receipt / tracking screen.
 * Guests pass the verify token they were handed at checkout; owners are matched by session.
 */
ordersRouter.get('/:orderNumber', (req, res) => {
  const orderNumber = String(req.params.orderNumber).replace('#', '').toUpperCase()
  const row = db
    .prepare('SELECT id, user_id, verify_token, restaurant_id FROM orders WHERE order_number = ?')
    .get(orderNumber) as any
  if (!row) return res.status(404).json({ error: 'We could not find that order.' })

  const token = String(req.query.token ?? '')
  const isOwner = req.user && row.user_id === req.user.id
  /**
   * Working here is a membership, not a job title on the account.
   *
   * `role` is set once when an address registers and is never revised, so
   * somebody who ordered a coffee before they took over a café reads as
   * 'customer' forever — and this refused them their own restaurant's orders.
   * It also said yes to staff at any other restaurant on Khapee, which is the
   * same mistake pointing the other way. The question is whether this person
   * works at the place that took this order.
   */
  const isStaffHere =
    !!req.user &&
    !!db
      .prepare('SELECT 1 FROM restaurant_staff WHERE user_id = ? AND restaurant_id = ?')
      .get(req.user.id, row.restaurant_id)
  if (!isOwner && !isStaffHere && token !== row.verify_token) {
    return res.status(403).json({ error: 'That order belongs to someone else.' })
  }
  res.json({ order: getOrder(row.id) })
})

/**
 * The customer's phone asking to be told about their own order.
 *
 * Proved the same way the order page itself is: the receipt token they were
 * handed at checkout, or being signed in as whoever placed it. No account
 * needed, because almost nobody ordering a coffee makes one.
 *
 * This is the free channel. A WhatsApp message to somebody who has not
 * messaged you first is billed per order by Meta; a push notification costs
 * nothing, now or ever, and goes through the browser the customer already has.
 */
ordersRouter.post('/:orderNumber/notify', (req, res) => {
  const orderNumber = String(req.params.orderNumber).replace('#', '').toUpperCase()
  const row = db
    .prepare('SELECT id, user_id, verify_token FROM orders WHERE order_number = ?')
    .get(orderNumber) as any
  if (!row) return res.status(404).json({ error: 'We could not find that order.' })

  const token = String(req.body?.token ?? req.query.token ?? '')
  const isOwner = req.user && row.user_id === req.user.id
  if (!isOwner && token !== row.verify_token) {
    return res.status(403).json({ error: 'That order belongs to someone else.' })
  }
  if (!pushConfigured()) return res.status(503).json({ error: pushReason() })

  const saved = saveCustomerSubscription(row.id, req.body?.subscription ?? req.body)
  if (!saved.ok) return res.status(400).json({ error: saved.error })
  res.json({ ok: true })
})
