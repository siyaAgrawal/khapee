import { Router } from 'express'
import { optionsFor, priceLine } from '../menu-options.ts'
import { db } from '../db.ts'
import { publish } from '../events.ts'
import {
  createSession,
  ensureSessionOrder,
  joinSession,
  memberByToken,
  recalcOrderTotal,
  sessionPreview,
  shapeSession,
} from '../groups.ts'
import { getOrder, mustPayInApp } from '../orders-service.ts'
import { alertRestaurant } from '../alerts.ts'
import { pushOrder } from '../petpooja.ts'
import { syncOrderPayment, upiLink } from '../payments.ts'

export const groupsRouter = Router()

function tokenOf(req: any): string | undefined {
  const header = req.headers['x-group-token']
  if (typeof header === 'string' && header) return header
  const body = req.body?.groupToken
  if (typeof body === 'string' && body) return body
  const query = req.query?.groupToken
  if (typeof query === 'string' && query) return query
  return undefined
}

function requireMember(req: any, res: any) {
  const ctx = memberByToken(tokenOf(req))
  if (!ctx) {
    res.status(401).json({ error: 'Join the group again to continue.' })
    return null
  }
  return ctx
}

/** Preview before joining, so nobody lands in the wrong table's order. */
groupsRouter.get('/:code', (req, res) => {
  const preview = sessionPreview(String(req.params.code))
  if (!preview) return res.status(404).json({ error: "That group code isn't valid." })
  res.json({ group: preview })
})

groupsRouter.post('/', (req, res) => {
  const result = createSession({
    restaurantId: Number(req.body?.restaurantId),
    hostName: String(req.body?.hostName ?? req.user?.name ?? ''),
    userId: req.user?.id ?? null,
    tableId: req.body?.tableId ? Number(req.body.tableId) : null,
    tableToken: req.body?.tableToken ?? null,
    accessCode: req.body?.accessCode ?? null,
    sessionToken: req.body?.sessionToken ?? null,
    ahead: !!req.body?.ahead,
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  res.status(201).json({
    groupToken: result.member.token,
    memberId: result.member.id,
    session: shapeSession(result.session.id),
  })
})

groupsRouter.post('/join', (req, res) => {
  const result = joinSession(
    String(req.body?.code ?? ''),
    String(req.body?.displayName ?? req.user?.name ?? ''),
    req.user?.id ?? null,
  )
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  const session = shapeSession(result.session.id)
  publish('group:update', { restaurantId: result.session.restaurant_id, sessionId: result.session.id })
  res.status(201).json({ groupToken: result.member.token, memberId: result.member.id, session })
})

groupsRouter.get('/session/state', (req, res) => {
  const ctx = requireMember(req, res)
  if (!ctx) return
  res.json({ session: shapeSession(ctx.session.id), memberId: ctx.member.id })
})

/** A member adds their own food to the shared order. */
groupsRouter.post('/session/items', (req, res) => {
  const ctx = requireMember(req, res)
  if (!ctx) return
  if (ctx.session.status === 'CLOSED') {
    return res.status(409).json({ error: 'This group session has closed. Start a new one to order again.' })
  }

  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(ctx.session.restaurant_id) as any
  if (!restaurant?.is_open) {
    return res.status(409).json({ error: `${restaurant?.name ?? 'This restaurant'} is closed right now.` })
  }

  const lines = Array.isArray(req.body?.items) ? req.body.items : []
  if (!lines.length) return res.status(400).json({ error: 'Your cart is empty.' })

  const priced: { item: any; quantity: number; unitPriceCents: number; variation: any; addons: any[] }[] = []
  const dishOptions = optionsFor(lines.map((l: any) => Number(l?.menuItemId)).filter(Number.isFinite))
  for (const line of lines) {
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(line?.menuItemId)) as any
    if (!item || item.restaurant_id !== ctx.session.restaurant_id) {
      return res.status(400).json({ error: 'One of the items is no longer on this menu.' })
    }
    if (!item.is_available) {
      return res.status(409).json({ error: `${item.name} just sold out. Remove it to continue.` })
    }
    const chosen = priceLine(item, line, dishOptions.get(item.id))
    if (!chosen.ok) return res.status(409).json({ error: chosen.error })
    priced.push({
      item,
      quantity: Math.min(50, Math.max(1, Math.floor(Number(line.quantity) || 1))),
      unitPriceCents: chosen.unitPriceCents,
      variation: chosen.variation,
      addons: chosen.addons,
    })
  }

  /*
   * The payment rule, which this route never asked.
   *
   * A group order is built straight into the orders table rather than through
   * createOrder, so every rule that lives there — a restaurant that takes no
   * cash, a car that must be prepaid — simply did not apply to it. At Revery,
   * which takes UPI only, a table could sit down, add a round and have it go
   * to the kitchen unpaid. That is how a cash order got through a restaurant
   * that does not take cash.
   *
   * The rule is asked here now, against the same function the single-order
   * route uses, so the two can never drift apart again. A round that has to be
   * paid for still goes on the ticket — the table keeps ordering as it always
   * has — but the order is held as waiting for payment, so the kitchen does
   * not start on food nobody has paid for. The session's own payment-request
   * and paid routes are how it gets settled.
   */
  const payFirst = mustPayInApp(
    {
      restaurantId: ctx.session.restaurant_id,
      type: 'dine_in',
      items: [],
      customerName: ctx.member.display_name,
      userId: null,
      fromCustomer: true,
    },
    null,
    restaurant,
  )

  // A restaurant that takes no cash takes none here either. Refused before a
  // round is written rather than after, so the ticket does not carry food the
  // kitchen is not allowed to make.
  if (payFirst) return res.status(402).json({ error: payFirst.reason })

  const order = db.transaction(() => {
    const target = ensureSessionOrder(ctx.session, `${ctx.member.display_name}'s table`)
    const insert = db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, emoji, unit_price_cents, quantity, member_id,
                                variation_id, variation_name, addons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const l of priced) {
      insert.run(
        target.id,
        l.item.id,
        l.item.name,
        l.item.emoji,
        l.unitPriceCents,
        l.quantity,
        ctx.member.id,
        l.variation?.id ?? null,
        l.variation?.name ?? '',
        l.addons.length ? JSON.stringify(l.addons) : '',
      )
    }
    recalcOrderTotal(target.id)
    syncOrderPayment(target.id)
    db.prepare(
      `INSERT INTO notifications (restaurant_id, order_id, title, body) VALUES (?, ?, ?, ?)`,
    ).run(
      ctx.session.restaurant_id,
      target.id,
      `Group ${ctx.session.code} · ${ctx.member.display_name} added items`,
      String(ctx.session.table_label ?? ''),
    )
    return target
  })()

  const session = shapeSession(ctx.session.id)
  publish('order:new', {
    restaurantId: ctx.session.restaurant_id,
    orderId: order.id,
    order: getOrder(order.id),
  })

  /*
   * A later round is food somebody is waiting for, so it is told the same way
   * a first order is.
   *
   * The notifications row above is read by the dashboard, and the dashboard is
   * shut for most of an evening. Everything after the first round arrived on a
   * screen nobody was looking at — the kitchen found out when a customer asked
   * where their second drink was. Push and email are how the first order gets
   * through, and there is no reason the third should be told any differently.
   */
  const alertFor = db
    .prepare('SELECT name FROM restaurants WHERE id = ?')
    .get(ctx.session.restaurant_id) as any
  alertRestaurant({
    restaurantId: ctx.session.restaurant_id,
    restaurantName: String(alertFor?.name ?? ''),
    orderNumber: order.order_number,
    where: String(ctx.session.table_label ?? 'Table'),
    customerName: `${ctx.member.display_name} (added to the table)`,
    customerPhone: '',
    total: `₹${(priced.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0) / 100).toFixed(0)}`,
    items: priced.map((l) => `${l.quantity} × ${l.item.name}`).join('\n'),
    // The table already said yes when it opened. This is more food, not a new
    // decision, so it must not read as something waiting to be accepted.
    needsAccepting: false,
    paid: false,
    moreItems: true,
  })

  /* And the till, if the restaurant bills on one. Their API is one KOT per
     order, so this round goes over as an order of its own against the same
     table — which is exactly what Petpooja said it would become. Not awaited:
     a round belongs to the kitchen whether or not somebody's Windows machine
     answered. */
  void pushOrder(order.id, originOf(req)).catch(() => {})

  res.status(201).json({ session })
})

/** Host closes the table once everything is paid. */
groupsRouter.post('/session/close', (req, res) => {
  const ctx = requireMember(req, res)
  if (!ctx) return
  if (!ctx.member.is_host) return res.status(403).json({ error: 'Only the person who started the group can close it.' })

  const state = shapeSession(ctx.session.id)!
  if (state.remainingCents > 0 && !req.body?.force) {
    return res.status(409).json({
      error: `₹${(state.remainingCents / 100).toFixed(0)} of the bill is still unpaid.`,
      remainingCents: state.remainingCents,
    })
  }
  db.prepare(`UPDATE group_sessions SET status = 'CLOSED', closed_at = datetime('now') WHERE id = ?`).run(
    ctx.session.id,
  )
  publish('group:update', { restaurantId: ctx.session.restaurant_id, sessionId: ctx.session.id })
  res.json({ session: shapeSession(ctx.session.id) })
})

/**
 * Builds the UPI request for a share of the bill. Scope is 'mine' (this
 * member's unpaid items), 'all' (everything still outstanding) or 'amount'.
 */
groupsRouter.post('/session/payment-request', (req, res) => {
  const ctx = requireMember(req, res)
  if (!ctx) return
  const state = shapeSession(ctx.session.id)
  if (!state?.order) return res.status(400).json({ error: 'Nothing has been ordered yet.' })

  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(ctx.session.restaurant_id) as any
  const scope = String(req.body?.scope ?? 'mine')
  const me = state.members.find((m: any) => m.id === ctx.member.id)

  let amountCents = 0
  if (scope === 'mine') amountCents = me?.unpaidCents ?? 0
  else if (scope === 'all') amountCents = Math.max(0, state.remainingCents - state.claimedCents)
  else amountCents = Math.round(Number(req.body?.amountCents) || 0)

  if (amountCents <= 0) return res.status(400).json({ error: 'There is nothing left to pay.' })

  if (!String(restaurant.upi_vpa ?? '').trim()) {
    return res.status(409).json({
      error: `${restaurant.name} has not set up UPI. Please pay at the counter.`,
      payAtCounter: true,
    })
  }

  const ref = `KHAPEE${state.order.orderNumber}${ctx.member.id}`
  res.json({
    amountCents,
    scope,
    vpa: restaurant.upi_vpa,
    payeeName: restaurant.upi_name || restaurant.name,
    reference: ref,
    upiLink: upiLink({
      vpa: restaurant.upi_vpa,
      name: restaurant.upi_name || restaurant.name,
      amountCents,
      note: `${restaurant.name} ${state.tableLabel ?? ''} #${state.order.orderNumber}`.trim(),
    }),
  })
})

/** The customer says they have paid; staff confirm it against their own UPI app. */
groupsRouter.post('/session/paid', (req, res) => {
  const ctx = requireMember(req, res)
  if (!ctx) return
  const state = shapeSession(ctx.session.id)
  if (!state?.order) return res.status(400).json({ error: 'Nothing has been ordered yet.' })

  const scope = String(req.body?.scope ?? 'mine')
  const me = state.members.find((m: any) => m.id === ctx.member.id)
  let amountCents = 0
  if (scope === 'mine') amountCents = me?.unpaidCents ?? 0
  else if (scope === 'all') amountCents = Math.max(0, state.remainingCents - state.claimedCents)
  else amountCents = Math.round(Number(req.body?.amountCents) || 0)
  if (amountCents <= 0) return res.status(400).json({ error: 'There is nothing left to pay.' })

  const info = db
    .prepare(
      `INSERT INTO payments (order_id, session_id, member_id, payer_name, amount_cents, method, status, upi_ref, covers)
       VALUES (?, ?, ?, ?, ?, ?, 'CLAIMED', ?, ?)`,
    )
    .run(
      state.order.id,
      ctx.session.id,
      ctx.member.id,
      ctx.member.display_name,
      amountCents,
      String(req.body?.method ?? 'upi'),
      String(req.body?.upiRef ?? '').trim().slice(0, 40),
      scope,
    )

  publish('payment:claimed', { restaurantId: ctx.session.restaurant_id, orderId: state.order.id })
  res.status(201).json({
    paymentId: Number(info.lastInsertRowid),
    session: shapeSession(ctx.session.id),
    message: 'Sent to the restaurant to confirm.',
  })
})

/**
 * The host the request actually arrived on, which is what Petpooja's callback
 * URL has to be built from. Deliberately a copy of the same three lines in
 * orders.ts and staff.ts rather than a shared import — these three routers are
 * otherwise independent of one another, and a helper module that exists to
 * hold one expression is a worse trade than the repetition.
 */
function originOf(req: any): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'https').split(',')[0]
  return `${proto}://${req.get('host')}`
}
