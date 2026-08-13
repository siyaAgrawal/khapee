import { Router } from 'express'
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
import { getOrder } from '../orders-service.ts'
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

  const priced: { item: any; quantity: number }[] = []
  for (const line of lines) {
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(line?.menuItemId)) as any
    if (!item || item.restaurant_id !== ctx.session.restaurant_id) {
      return res.status(400).json({ error: 'One of the items is no longer on this menu.' })
    }
    if (!item.is_available) {
      return res.status(409).json({ error: `${item.name} just sold out. Remove it to continue.` })
    }
    priced.push({ item, quantity: Math.min(50, Math.max(1, Math.floor(Number(line.quantity) || 1))) })
  }

  const order = db.transaction(() => {
    const target = ensureSessionOrder(ctx.session, `${ctx.member.display_name}'s table`)
    const insert = db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, emoji, unit_price_cents, quantity, member_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const l of priced) {
      insert.run(target.id, l.item.id, l.item.name, l.item.emoji, l.item.price_cents, l.quantity, ctx.member.id)
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

  const ref = `TABLO${state.order.orderNumber}${ctx.member.id}`
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
      ref,
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
