import { Router } from 'express'
import { db, WRITES_ARE_TEMPORARY } from '../db.ts'
import { requireStaff, setActiveRestaurant, userFromToken } from '../auth.ts'
import { generateAccessCode, normalizeCode, tableToken } from '../ids.ts'
import { publish } from '../events.ts'
import { createOrder, getOrder, shapeOrder } from '../orders-service.ts'
import { deleteUpload, imageUrl, saveDataUrl } from '../uploads.ts'
import { canTransition, STATUS_LABEL, type OrderStatus } from '../../shared/orders.ts'
import { claimedCents, markMemberItemsPaid, paidCents, shapePayment, syncOrderPayment } from '../payments.ts'
import { shapeSession } from '../groups.ts'
import { opsBoard, runQueue } from '../ops.ts'
import { tellCustomer } from '../customer-notify.ts'
import { dropSubscription, pushConfigured, pushPublicKey, pushReason, pushToRestaurant, removeSubscription, saveSubscription, subscriptionCount, subscriptionList } from '../push.ts'
import { alertEmailFor } from '../alerts.ts'
import { mailConfigured, sendMail } from '../mail.ts'
import {
  audit,
  finaliseInvoice,
  invoicePaymentStatus,
  paidOnInvoice,
  quoteOrder,
  refund,
  shapeInvoice,
  takePayment,
  voidInvoice,
} from '../billing.ts'
import { shapeDiningSession, startCarSession } from '../dining.ts'
import { randomToken } from '../ids.ts'

export const staffRouter = Router()
staffRouter.use(requireStaff)

const CODE_TTL_MINUTES = 10

function myRestaurant(req: any): number {
  return req.user.restaurantId as number
}

// --- Orders board -----------------------------------------------------------

staffRouter.get('/orders', (req, res) => {
  const restaurantId = myRestaurant(req)
  const scope = String(req.query.scope ?? 'active')
  const clause =
    scope === 'all'
      ? ''
      : `AND o.status NOT IN ('COMPLETED','PICKED_UP','CANCELLED')`
  const rows = db
    .prepare(
      `SELECT o.*, r.name AS restaurant_name, r.emoji AS restaurant_emoji, r.hue AS restaurant_hue,
              r.slug AS restaurant_slug, r.prep_minutes
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.restaurant_id = ? ${clause}
       ORDER BY o.id DESC LIMIT 200`,
    )
    .all(restaurantId) as any[]
  res.json({ orders: rows.map(shapeOrder) })
})

staffRouter.post('/orders/:id/status', (req, res) => {
  const restaurantId = myRestaurant(req)
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any
  if (!row) return res.status(404).json({ error: 'Order not found.' })
  if (row.restaurant_id !== restaurantId) {
    return res.status(403).json({ error: 'That order belongs to another restaurant.' })
  }

  const to = String(req.body?.status ?? '').toUpperCase() as OrderStatus
  // A car order has a delivery leg, so the flow comes from where the customer
  // is rather than from the order_type column, which only knows table/counter.
  const service =
    row.service_mode === 'car'
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
  if (!canTransition(service, row.status, to)) {
    return res.status(400).json({ error: `Cannot move ${row.status} to ${to}.` })
  }

  db.transaction(() => {
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(to, id)
    db.prepare(`INSERT INTO order_events (order_id, status, actor) VALUES (?, ?, 'staff')`).run(id, to)
    if (row.user_id) {
      db.prepare(
        `INSERT INTO notifications (user_id, order_id, restaurant_id, title, body)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(row.user_id, id, restaurantId, `Order #${row.order_number} — ${STATUS_LABEL[to]}`, '')
    }
  })()

  const order = getOrder(id)
  // The customer's own phone, for nothing — see server/customer-notify.ts.
  tellCustomer(id, to as OrderStatus)
  publish('order:update', { restaurantId, userId: row.user_id, orderId: id, order })
  res.json({ order })
})

staffRouter.post('/orders/:id/payment', (req, res) => {
  const restaurantId = myRestaurant(req)
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any
  if (!row) return res.status(404).json({ error: 'Order not found.' })
  if (row.restaurant_id !== restaurantId) {
    return res.status(403).json({ error: 'That order belongs to another restaurant.' })
  }
  const status = String(req.body?.paymentStatus ?? '').toUpperCase()
  if (status !== 'PAID' && status !== 'UNPAID') {
    return res.status(400).json({ error: 'Payment status must be PAID or UNPAID.' })
  }
  db.prepare(`UPDATE orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id)
  // Marking the order settles whatever the customer said they sent, so the
  // board and the Payments list cannot disagree about the same money — one of
  // them saying PAID while the other still lists a claim waiting on somebody.
  if (status === 'PAID') {
    db.prepare(
      `UPDATE payments SET status = 'CONFIRMED', settled_at = datetime('now')
        WHERE order_id = ? AND status = 'CLAIMED'`,
    ).run(id)
  } else {
    db.prepare(
      `UPDATE payments SET status = 'CLAIMED', settled_at = NULL
        WHERE order_id = ? AND status = 'CONFIRMED'`,
    ).run(id)
  }
  const order = getOrder(id)
  publish('order:update', { restaurantId, userId: row.user_id, orderId: id, order })
  res.json({ order })
})

/** Pickup hand-off: staff scans the customer's QR or types the order number. */
staffRouter.post('/verify-order', (req, res) => {
  const restaurantId = myRestaurant(req)
  const raw = String(req.body?.value ?? '').trim()
  if (!raw) return res.status(400).json({ error: 'Enter an order number to look it up.' })

  let orderNumber = raw
  let token: string | null = null
  const match = raw.match(/(?:ORDRO|TABLO):ORDER:([A-Za-z0-9]+):([a-f0-9]+)/i)
  if (match) {
    orderNumber = match[1]
    token = match[2].toLowerCase()
  }
  orderNumber = orderNumber.replace('#', '').toUpperCase()

  const row = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderNumber) as any
  if (!row) return res.status(404).json({ error: `No order ${orderNumber} found.` })
  if (row.restaurant_id !== restaurantId) {
    return res.status(403).json({ error: 'That order was placed at a different restaurant.' })
  }
  if (token && token !== row.verify_token) {
    return res.status(400).json({ error: 'That QR code does not match the order.' })
  }

  db.prepare(`UPDATE orders SET verified_at = datetime('now') WHERE id = ?`).run(row.id)
  res.json({ order: getOrder(row.id), scanned: !!token })
})

// --- Access codes -----------------------------------------------------------

function shapeCode(row: any) {
  return {
    id: row.id,
    code: row.code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    secondsLeft: Math.max(0, Number(row.seconds_left ?? 0)),
    singleUse: !!row.single_use,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    usedByOrder: row.used_order_number ?? null,
    qrPayload: `KHAPEE:ACCESS:${row.restaurant_id}:${row.code}`,
  }
}

staffRouter.get('/codes', (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, strftime('%s', a.expires_at) - strftime('%s','now') AS seconds_left,
              o.order_number AS used_order_number
       FROM access_codes a LEFT JOIN orders o ON o.id = a.used_by_order
       WHERE a.restaurant_id = ? ORDER BY a.id DESC LIMIT 20`,
    )
    .all(myRestaurant(req)) as any[]
  res.json({ codes: rows.map(shapeCode) })
})

staffRouter.post('/codes', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const minutes = Math.min(60, Math.max(1, Number(req.body?.minutes) || CODE_TTL_MINUTES))
  const singleUse = req.body?.singleUse === false ? 0 : 1
  const code = generateAccessCode()
  const info = db
    .prepare(
      `INSERT INTO access_codes (restaurant_id, code, created_by, expires_at, single_use)
       VALUES (?, ?, ?, datetime('now', '+' || ? || ' minutes'), ?)`,
    )
    .run(restaurantId, code, req.user.id, minutes, singleUse)

  const row = db
    .prepare(
      `SELECT a.*, strftime('%s', a.expires_at) - strftime('%s','now') AS seconds_left, NULL AS used_order_number
       FROM access_codes a WHERE a.id = ?`,
    )
    .get(Number(info.lastInsertRowid)) as any
  res.status(201).json({ code: shapeCode(row) })
})

staffRouter.post('/codes/:id/revoke', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM access_codes WHERE id = ?').get(id) as any
  if (!row || row.restaurant_id !== myRestaurant(req)) {
    return res.status(404).json({ error: 'Code not found.' })
  }
  db.prepare(`UPDATE access_codes SET revoked_at = datetime('now') WHERE id = ?`).run(id)
  res.json({ ok: true })
})

// --- Tables -----------------------------------------------------------------

staffRouter.get('/tables', (req, res) => {
  const restaurantId = myRestaurant(req)
  const rows = db
    .prepare(
      `SELECT t.*, (
          SELECT COUNT(*) FROM orders o
          WHERE o.table_id = t.id AND o.status NOT IN ('COMPLETED','PICKED_UP','CANCELLED')
        ) AS active_orders
       FROM restaurant_tables t WHERE t.restaurant_id = ? ORDER BY t.id`,
    )
    .all(restaurantId) as any[]
  res.json({
    tables: rows.map((t) => ({
      id: t.id,
      label: t.label,
      seats: t.seats,
      token: t.token,
      activeOrders: t.active_orders,
      qrPayload: `KHAPEE:TABLE:${t.token}`,
    })),
  })
})

staffRouter.post('/tables', (req, res) => {
  const restaurantId = myRestaurant(req)
  const label = String(req.body?.label ?? '').trim()
  const seats = Math.min(30, Math.max(1, Number(req.body?.seats) || 4))
  if (!label) return res.status(400).json({ error: 'Give the table a name, like "Table 6".' })
  const clash = db
    .prepare('SELECT 1 FROM restaurant_tables WHERE restaurant_id = ? AND label = ?')
    .get(restaurantId, label)
  if (clash) return res.status(409).json({ error: `${label} already exists.` })

  const info = db
    .prepare('INSERT INTO restaurant_tables (restaurant_id, label, seats, token) VALUES (?, ?, ?, ?)')
    .run(restaurantId, label, seats, tableToken())
  const t = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(Number(info.lastInsertRowid)) as any
  res.status(201).json({
    table: { id: t.id, label: t.label, seats: t.seats, token: t.token, activeOrders: 0, qrPayload: `KHAPEE:TABLE:${t.token}` },
  })
})

staffRouter.delete('/tables/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id) as any
  if (!row || row.restaurant_id !== myRestaurant(req)) return res.status(404).json({ error: 'Table not found.' })
  db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(id)
  res.json({ ok: true })
})

// --- Menu & restaurant ------------------------------------------------------

staffRouter.get('/menu', (req, res) => {
  const restaurantId = myRestaurant(req)
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId) as any
  const categories = db
    .prepare('SELECT id, name FROM menu_categories WHERE restaurant_id = ? ORDER BY sort_order, id')
    .all(restaurantId) as any[]
  const items = db
    .prepare('SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY sort_order, id')
    .all(restaurantId) as any[]
  res.json({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      isOpen: !!restaurant.is_open,
      hours: restaurant.hours,
      isListed: countLiveItems(restaurantId) > 0,
    },
    // Whether an edit made here will still be here tomorrow. Said out loud,
    // because the alternative is a restaurant spending an evening on its menu
    // and finding it reverted with no explanation offered.
    writesAreTemporary: WRITES_ARE_TEMPORARY,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      items: items.filter((i) => i.category_id === c.id).map(shapeMenuItem),
    })),
  })
})

function shapeMenuItem(i: any) {
  return {
    id: i.id,
    categoryId: i.category_id,
    name: i.name,
    description: i.description,
    priceCents: i.price_cents,
    emoji: i.emoji,
    hue: i.hue,
    imageUrl: imageUrl(i.image_path),
    isVeg: !!i.is_veg,
    isAvailable: !!i.is_available,
    isSpecial: !!i.is_special,
  }
}

/** Guards a menu item (or category) against the signed-in staff member's restaurant. */
function ownItem(req: any, id: number) {
  const row = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id) as any
  return row && row.restaurant_id === myRestaurant(req) ? row : null
}

function ownCategory(req: any, id: number) {
  const row = db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(id) as any
  return row && row.restaurant_id === myRestaurant(req) ? row : null
}

// --- Menu categories --------------------------------------------------------

staffRouter.post('/categories', (req, res) => {
  const restaurantId = myRestaurant(req)
  const name = String(req.body?.name ?? '').trim().slice(0, 60)
  if (!name) return res.status(400).json({ error: 'Give the section a name, like "Starters".' })
  const clash = db
    .prepare('SELECT 1 FROM menu_categories WHERE restaurant_id = ? AND lower(name) = lower(?)')
    .get(restaurantId, name)
  if (clash) return res.status(409).json({ error: `You already have a "${name}" section.` })

  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM menu_categories WHERE restaurant_id = ?')
    .get(restaurantId) as any
  const info = db
    .prepare('INSERT INTO menu_categories (restaurant_id, name, sort_order) VALUES (?, ?, ?)')
    .run(restaurantId, name, next.n)
  res.status(201).json({ category: { id: Number(info.lastInsertRowid), name, items: [] } })
})

staffRouter.patch('/categories/:id', (req, res) => {
  const row = ownCategory(req, Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Section not found.' })
  const name = String(req.body?.name ?? '').trim().slice(0, 60)
  if (!name) return res.status(400).json({ error: 'Give the section a name.' })
  db.prepare('UPDATE menu_categories SET name = ? WHERE id = ?').run(name, row.id)
  res.json({ ok: true, name })
})

/**
 * Moves a section up or down the menu.
 *
 * The order sections were typed in is rarely the order they should be read in
 * — desserts get added first because that is what the owner was thinking
 * about, and end up above the food. Swapping with the neighbour keeps every
 * other position untouched, so a menu cannot be scrambled by a mis-tap.
 */
staffRouter.post('/categories/:id/move', (req, res) => {
  const restaurantId = myRestaurant(req)
  const row = ownCategory(req, Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Section not found.' })
  const up = String(req.body?.direction ?? 'up') === 'up'

  const ordered = db
    .prepare('SELECT id FROM menu_categories WHERE restaurant_id = ? ORDER BY sort_order, id')
    .all(restaurantId) as any[]
  const at = ordered.findIndex((c) => c.id === row.id)
  const to = up ? at - 1 : at + 1
  if (at === -1 || to < 0 || to >= ordered.length) return res.json({ ok: true, moved: false })

  // Rewritten from scratch rather than swapped, because a menu imported from a
  // PDF can arrive with every sort_order at 0 — and swapping two zeroes moves
  // nothing while reporting success.
  const rewrite = db.prepare('UPDATE menu_categories SET sort_order = ? WHERE id = ?')
  const next = ordered.map((c) => c.id)
  ;[next[at], next[to]] = [next[to], next[at]]
  db.transaction(() => next.forEach((id, i) => rewrite.run(i, id)))()
  res.json({ ok: true, moved: true })
})

staffRouter.delete('/categories/:id', (req, res) => {
  const row = ownCategory(req, Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Section not found.' })
  const items = db.prepare('SELECT image_path FROM menu_items WHERE category_id = ?').all(row.id) as any[]
  db.prepare('DELETE FROM menu_categories WHERE id = ?').run(row.id) // items cascade
  items.forEach((i) => deleteUpload(i.image_path))
  res.json({ ok: true })
})

// --- Menu items -------------------------------------------------------------



function parsePrice(input: unknown): number | null {
  const value = Number(String(input ?? '').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}

staffRouter.post('/menu', (req, res) => {
  const restaurantId = myRestaurant(req)
  const category = ownCategory(req, Number(req.body?.categoryId))
  if (!category) return res.status(400).json({ error: 'Pick a menu section for this dish.' })

  const name = String(req.body?.name ?? '').trim().slice(0, 80)
  if (!name) return res.status(400).json({ error: 'Give the dish a name.' })
  const priceCents = parsePrice(req.body?.price)
  if (priceCents === null) return res.status(400).json({ error: 'Enter a price greater than zero.' })

  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM menu_items WHERE category_id = ?')
    .get(category.id) as any
  const info = db
    .prepare(
      `INSERT INTO menu_items
        (restaurant_id, category_id, name, description, price_cents, emoji, hue, is_veg, is_available, is_special, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      restaurantId,
      category.id,
      name,
      String(req.body?.description ?? '').trim().slice(0, 200),
      priceCents,
      String(req.body?.emoji ?? '🍽️').slice(0, 8) || '🍽️',
      Math.max(0, Math.min(360, Number(req.body?.hue) || 24)),
      req.body?.isVeg === false ? 0 : 1,
      req.body?.isAvailable === false ? 0 : 1,
      req.body?.isSpecial ? 1 : 0,
      next.n,
    )
  res.status(201).json({ item: shapeMenuItem(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(info.lastInsertRowid))) })
})

staffRouter.patch('/menu/:id', (req, res) => {
  const row = ownItem(req, Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Item not found.' })

  const updates: Record<string, unknown> = {}
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim().slice(0, 80)
    if (!name) return res.status(400).json({ error: 'Give the dish a name.' })
    updates.name = name
  }
  if (req.body?.description !== undefined) updates.description = String(req.body.description).trim().slice(0, 200)
  if (req.body?.price !== undefined) {
    const priceCents = parsePrice(req.body.price)
    if (priceCents === null) return res.status(400).json({ error: 'Enter a price greater than zero.' })
    updates.price_cents = priceCents
  }
  if (req.body?.emoji !== undefined) updates.emoji = String(req.body.emoji).slice(0, 8) || '🍽️'
  if (req.body?.hue !== undefined) updates.hue = Math.max(0, Math.min(360, Number(req.body.hue) || 24))
  if (req.body?.isVeg !== undefined) updates.is_veg = req.body.isVeg ? 1 : 0
  if (req.body?.isAvailable !== undefined) updates.is_available = req.body.isAvailable ? 1 : 0
  if (req.body?.isSpecial !== undefined) updates.is_special = req.body.isSpecial ? 1 : 0
  if (req.body?.categoryId !== undefined) {
    const category = ownCategory(req, Number(req.body.categoryId))
    if (!category) return res.status(400).json({ error: 'That menu section does not exist.' })
    updates.category_id = category.id
  }

  const keys = Object.keys(updates)
  if (keys.length) {
    db.prepare(`UPDATE menu_items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...keys.map((k) => updates[k]),
      row.id,
    )
  }
  res.json({ item: shapeMenuItem(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(row.id)) })
})

staffRouter.delete('/menu/:id', (req, res) => {
  const row = ownItem(req, Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Item not found.' })
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(row.id)
  deleteUpload(row.image_path)
  res.json({ ok: true })
})

/** Moves a dish up or down within its own section. Same rules as a section. */
staffRouter.post('/menu/:id/move', (req, res) => {
  const row = ownItem(req, Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Item not found.' })
  const up = String(req.body?.direction ?? 'up') === 'up'

  const ordered = db
    .prepare('SELECT id FROM menu_items WHERE category_id = ? ORDER BY sort_order, id')
    .all(row.category_id) as any[]
  const at = ordered.findIndex((i) => i.id === row.id)
  const to = up ? at - 1 : at + 1
  if (at === -1 || to < 0 || to >= ordered.length) return res.json({ ok: true, moved: false })

  const rewrite = db.prepare('UPDATE menu_items SET sort_order = ? WHERE id = ?')
  const next = ordered.map((i) => i.id)
  ;[next[at], next[to]] = [next[to], next[at]]
  db.transaction(() => next.forEach((id, i) => rewrite.run(i, id)))()
  res.json({ ok: true, moved: true })
})

staffRouter.post('/menu/:id/image', (req, res) => {
  const row = ownItem(req, Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Item not found.' })
  const saved = saveDataUrl(req.body?.dataUrl)
  if (!saved.ok) return res.status(400).json({ error: saved.error })
  db.prepare('UPDATE menu_items SET image_path = ? WHERE id = ?').run(saved.file, row.id)
  deleteUpload(row.image_path)
  res.json({ imageUrl: imageUrl(saved.file) })
})

staffRouter.delete('/menu/:id/image', (req, res) => {
  const row = ownItem(req, Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Item not found.' })
  db.prepare('UPDATE menu_items SET image_path = NULL WHERE id = ?').run(row.id)
  deleteUpload(row.image_path)
  res.json({ ok: true })
})

staffRouter.post('/menu/:id/availability', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id) as any
  if (!row || row.restaurant_id !== myRestaurant(req)) return res.status(404).json({ error: 'Item not found.' })
  const available = req.body?.isAvailable ? 1 : 0
  db.prepare('UPDATE menu_items SET is_available = ? WHERE id = ?').run(available, id)
  res.json({ ok: true, isAvailable: !!available })
})

staffRouter.post('/restaurant/open', (req, res) => {
  const restaurantId = myRestaurant(req)
  const isOpen = req.body?.isOpen ? 1 : 0
  db.prepare('UPDATE restaurants SET is_open = ? WHERE id = ?').run(isOpen, restaurantId)
  // Opening the doors counts as going live, whichever screen it happened from.
  if (isOpen) {
    db.prepare("UPDATE restaurants SET published_at = datetime('now') WHERE id = ? AND published_at IS NULL").run(
      restaurantId,
    )
  }
  res.json({ ok: true, isOpen: !!isOpen })
})

// --- Restaurant profile -----------------------------------------------------

function shapeOwnRestaurant(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    address: row.address,
    phone: row.phone ?? '',
    categories: String(row.categories || '')
      .split(',')
      .map((c: string) => c.trim())
      .filter(Boolean),
    emoji: row.emoji,
    hue: row.hue,
    hours: row.hours,
    prepMinutes: row.prep_minutes,
    isOpen: !!row.is_open,
    imageUrl: imageUrl(row.image_path),
    city: row.city ?? '',
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    upiVpa: row.upi_vpa ?? '',
    upiName: row.upi_name ?? '',
    acceptsPickup: !!row.accepts_pickup,
    acceptsTakeaway: !!row.accepts_takeaway,
    acceptsGroups: !!row.accepts_groups,
    publishedAt: row.published_at ?? null,
    itemCount: countLiveItems(row.id),
    // Exactly what the browse list asks of a restaurant before it shows it.
    isListed: countLiveItems(row.id) > 0,
  }
}

/** Dishes a customer could order right now. */
function countLiveItems(restaurantId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = ? AND is_available = 1')
    .get(restaurantId) as any
  return row.n as number
}

staffRouter.get('/restaurant', (req, res) => {
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(myRestaurant(req)) as any
  res.json({ restaurant: shapeOwnRestaurant(row) })
})

staffRouter.patch('/restaurant', (req, res) => {
  const restaurantId = myRestaurant(req)
  const body = req.body ?? {}
  const updates: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80)
    if (name.length < 2) return res.status(400).json({ error: 'Enter your restaurant name.' })
    updates.name = name
  }
  if (body.description !== undefined) updates.description = String(body.description).trim().slice(0, 300)
  if (body.address !== undefined) updates.address = String(body.address).trim().slice(0, 200)
  if (body.phone !== undefined) updates.phone = String(body.phone).trim().slice(0, 30)
  if (body.hours !== undefined) updates.hours = String(body.hours).trim().slice(0, 60)
  if (body.city !== undefined) updates.city = String(body.city).trim().slice(0, 60)
  if (body.upiVpa !== undefined) {
    const vpa = String(body.upiVpa).trim().slice(0, 80)
    if (vpa && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(vpa)) {
      return res.status(400).json({ error: 'That does not look like a UPI ID (e.g. name@bank).' })
    }
    updates.upi_vpa = vpa
  }
  if (body.upiName !== undefined) updates.upi_name = String(body.upiName).trim().slice(0, 80)
  if (body.acceptsPickup !== undefined) updates.accepts_pickup = body.acceptsPickup ? 1 : 0
  if (body.acceptsTakeaway !== undefined) updates.accepts_takeaway = body.acceptsTakeaway ? 1 : 0
  if (body.acceptsGroups !== undefined) updates.accepts_groups = body.acceptsGroups ? 1 : 0
  if (body.lat !== undefined && body.lng !== undefined) {
    const lat = Number(body.lat)
    const lng = Number(body.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      updates.lat = lat
      updates.lng = lng
    } else if (body.lat === null) {
      updates.lat = null
      updates.lng = null
    }
  }
  if (body.emoji !== undefined) updates.emoji = String(body.emoji).slice(0, 8) || '🍽️'
  if (body.hue !== undefined) updates.hue = Math.max(0, Math.min(360, Number(body.hue) || 210))
  if (body.prepMinutes !== undefined) {
    updates.prep_minutes = Math.max(1, Math.min(180, Math.round(Number(body.prepMinutes) || 15)))
  }
  if (body.categories !== undefined) {
    const list = Array.isArray(body.categories) ? body.categories : String(body.categories).split(',')
    updates.categories = list
      .map((c: unknown) => String(c).trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(', ')
  }

  const keys = Object.keys(updates)
  if (keys.length) {
    db.prepare(`UPDATE restaurants SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...keys.map((k) => updates[k]),
      restaurantId,
    )
  }
  // "Done" is the moment a restaurant goes live: once it has a dish to sell we
  // open it for orders and remember that it has been published. Later edits
  // leave it alone — after the first time, open and closed is the owner's call.
  let justPublished = false
  const before = db.prepare('SELECT published_at FROM restaurants WHERE id = ?').get(restaurantId) as any
  if (body.publish && !before.published_at && countLiveItems(restaurantId) > 0) {
    db.prepare('UPDATE restaurants SET published_at = ?, is_open = 1 WHERE id = ?').run(
      new Date().toISOString(),
      restaurantId,
    )
    justPublished = true
  }

  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId) as any
  res.json({ restaurant: shapeOwnRestaurant(row), justPublished })
})

staffRouter.post('/restaurant/image', (req, res) => {
  const restaurantId = myRestaurant(req)
  const current = db.prepare('SELECT image_path FROM restaurants WHERE id = ?').get(restaurantId) as any
  const saved = saveDataUrl(req.body?.dataUrl)
  if (!saved.ok) return res.status(400).json({ error: saved.error })
  db.prepare('UPDATE restaurants SET image_path = ? WHERE id = ?').run(saved.file, restaurantId)
  deleteUpload(current?.image_path)
  res.json({ imageUrl: imageUrl(saved.file) })
})

staffRouter.delete('/restaurant/image', (req, res) => {
  const restaurantId = myRestaurant(req)
  const current = db.prepare('SELECT image_path FROM restaurants WHERE id = ?').get(restaurantId) as any
  db.prepare('UPDATE restaurants SET image_path = NULL WHERE id = ?').run(restaurantId)
  deleteUpload(current?.image_path)
  res.json({ ok: true })
})

/** Moves the dashboard to another restaurant on this account. */
staffRouter.post('/switch', (req: any, res) => {
  const restaurantId = Number(req.body?.restaurantId)
  if (!setActiveRestaurant(req.user.id, restaurantId)) {
    return res.status(403).json({ error: 'You do not run that restaurant.' })
  }
  res.json({ user: userFromToken(String(req.headers.authorization ?? '').replace('Bearer ', '')) })
})

// --- Order alerts on a device that is not looking at the dashboard ----------

/**
 * What this restaurant's alerts can currently do.
 *
 * The dashboard needs all of it in one call: the key to subscribe with, how
 * many devices are already signed up, and whether email is switched on at all
 * — so it can say "two phones and siya@…" rather than an optimistic promise.
 */
staffRouter.get('/alerts', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const own = db.prepare('SELECT order_email FROM restaurants WHERE id = ?').get(restaurantId) as any
  // Everywhere this account runs, so a switched-on phone can say what it will
  // actually ring for rather than leaving an owner with two places guessing.
  const mine = db
    .prepare(
      `SELECT r.name FROM restaurant_staff rs JOIN restaurants r ON r.id = rs.restaurant_id
        WHERE rs.user_id = ? ORDER BY r.name`,
    )
    .all(req.user.id) as any[]
  res.json({
    ringsFor: mine.map((r) => r.name),
    push: {
      available: pushConfigured(),
      publicKey: pushPublicKey(),
      devices: subscriptionCount(restaurantId),
      reason: pushReason(),
      // Who is actually getting these, so an owner can see a phone they do not
      // recognise and take it off.
      list: subscriptionList(restaurantId).map((d) => ({
        id: d.id,
        who: d.label || d.who || 'Somebody signed in',
        whose: d.label ? '' : d.whose || '',
        since: d.created_at,
        lastOk: d.last_ok_at,
        failing: d.failures > 3,
      })),
    },
    // Links handed out and not yet used, so they can be seen and called back.
    invites: db
      .prepare(
        `SELECT id, token, created_at, expires_at FROM alert_invites
          WHERE restaurant_id = ? AND used_at IS NULL AND revoked_at IS NULL
            AND expires_at > datetime('now') ORDER BY id DESC`,
      )
      .all(restaurantId)
      .map((i: any) => ({ id: i.id, path: `/alerts/${i.token}`, since: i.created_at, until: i.expires_at })),
    email: {
      available: mailConfigured(),
      // What is actually used, and what was typed — they differ when the
      // restaurant has named nothing and is falling back to the owner's own
      // address, which is worth showing as the answer rather than a blank box.
      to: alertEmailFor(restaurantId),
      own: String(own?.order_email ?? ''),
    },
  })
})

/**
 * The address order alerts go to.
 *
 * Blank means whoever signed up, which is right for a one-person café and
 * wrong for a kitchen with a shared inbox or a printer that takes email — so
 * it is a field rather than an assumption.
 */
staffRouter.patch('/alerts/email', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const raw = String(req.body?.email ?? '').trim().slice(0, 120)
  if (raw && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    return res.status(400).json({ error: "That doesn't look like an email address." })
  }
  db.prepare('UPDATE restaurants SET order_email = ? WHERE id = ?').run(raw, restaurantId)
  audit(restaurantId, actorOf(req), 'alerts.email', 'restaurant', restaurantId, { email: raw })
  res.json({ ok: true, to: alertEmailFor(restaurantId), own: raw })
})

/**
 * Sends one real email to that address.
 *
 * Not a simulation: an address with a typo in it, a spam filter, a mailbox
 * nobody opens — all of those look identical to working until somebody
 * actually looks in the inbox.
 */
staffRouter.post('/alerts/test-email', async (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const to = alertEmailFor(restaurantId)
  if (!to) return res.status(400).json({ error: 'Add an address first.' })
  if (!mailConfigured()) {
    return res.status(503).json({ error: 'Khapee cannot send email yet. Ask whoever set Khapee up to switch it on.' })
  }
  const name = (db.prepare('SELECT name FROM restaurants WHERE id = ?').get(restaurantId) as any)?.name ?? ''
  const result = await sendMail({
    to,
    subject: `Khapee order alerts are working — ${name}`,
    text: [
      'This is what a new order will look like.',
      '',
      'Order   #A123',
      'Where   Table 4',
      'Name    Siya',
      'Phone   98765 43210',
      'Total   ₹470 (unpaid)',
      '',
      '2 × Cold Coffee',
      '1 × Veggie Wrap',
      '',
      'Open the board: https://khapee.com/staff/orders',
    ].join('\n'),
  })
  if (result !== 'sent') {
    return res.status(502).json({ error: 'The mail server would not take it. Check the address and try again.' })
  }
  res.json({ ok: true, to })
})

/** This device would like to be told. */
staffRouter.post('/alerts/subscribe', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  if (!pushConfigured()) {
    return res.status(503).json({ error: pushReason() })
  }
  const result = saveSubscription(req.user.id, restaurantId, req.body?.subscription ?? req.body)
  if (!result.ok) return res.status(400).json({ error: result.error })
  audit(restaurantId, actorOf(req), 'alerts.subscribe', 'restaurant', restaurantId, {})
  res.json({ ok: true, devices: subscriptionCount(restaurantId) })
})

/** And this one would like to stop. */
staffRouter.post('/alerts/unsubscribe', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  dropSubscription(String(req.body?.endpoint ?? ''))
  res.json({ ok: true, devices: subscriptionCount(restaurantId) })
})

/**
 * A link that puts alerts on one phone without handing over the password.
 *
 * The password is the wrong thing to give somebody who only needs their phone
 * to buzz: it is the whole dashboard, and it cannot be taken back without
 * changing it for everybody. This grants exactly one capability — be notified
 * about this restaurant's orders — to exactly one device, and stops working
 * the moment it is used.
 */
staffRouter.post('/alerts/invite', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  if (!pushConfigured()) return res.status(503).json({ error: pushReason() })
  const token = randomToken(18)
  db.prepare(
    `INSERT INTO alert_invites (restaurant_id, created_by, token, expires_at)
     VALUES (?, ?, ?, datetime('now', '+2 days'))`,
  ).run(restaurantId, req.user.id, token)
  audit(restaurantId, actorOf(req), 'alerts.invite', 'restaurant', restaurantId, {})
  res.status(201).json({ token, path: `/alerts/${token}` })
})

staffRouter.post('/alerts/invite/:id/revoke', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const done = db
    .prepare(
      `UPDATE alert_invites SET revoked_at = datetime('now')
        WHERE id = ? AND restaurant_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    )
    .run(Number(req.params.id), restaurantId)
  if (!done.changes) return res.status(404).json({ error: 'That invite is already used or gone.' })
  res.json({ ok: true })
})

/** Takes one phone off the list — the one place an owner can undo a sign-up. */
staffRouter.post('/alerts/devices/:id/remove', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const gone = removeSubscription(restaurantId, Number(req.params.id))
  if (!gone) return res.status(404).json({ error: 'That device is not on this restaurant.' })
  audit(restaurantId, actorOf(req), 'alerts.remove', 'restaurant', restaurantId, { id: req.params.id })
  res.json({ ok: true, devices: subscriptionCount(restaurantId) })
})

/**
 * Proves it out loud.
 *
 * Silence is the failure mode of every alerting system, and there is no way to
 * tell "no orders yet" from "this never worked" without asking it to ring.
 */
staffRouter.post('/alerts/test', async (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const sent = await pushToRestaurant(restaurantId, {
    title: 'Khapee alerts are working',
    body: 'This is what a new order will look like.',
    tag: 'khapee-test',
  })
  res.json({ ok: true, sent })
})

staffRouter.get('/summary', (req, res) => {
  const restaurantId = myRestaurant(req)
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND status = 'NEW') AS newOrders,
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND status NOT IN ('COMPLETED','PICKED_UP','CANCELLED')) AS activeOrders,
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND date(created_at) = date('now')) AS todayOrders,
        -- Taken, not ordered. This counted every order placed today whether or
        -- not a rupee had arrived, so the figure a restaurant reads as "what we
        -- made" included food still being cooked and bills nobody had settled.
        (SELECT COALESCE(SUM(total_cents),0) FROM orders
          WHERE restaurant_id = ? AND date(created_at) = date('now')
            AND status != 'CANCELLED' AND payment_status = 'PAID') AS todayCents,
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND payment_status = 'UNPAID' AND status NOT IN ('CANCELLED')) AS unpaid,
        -- What is still owed, so the count next to it means something.
        (SELECT COALESCE(SUM(total_cents),0) FROM orders
          WHERE restaurant_id = ? AND payment_status = 'UNPAID' AND status NOT IN ('CANCELLED')) AS unpaidCents`,
    )
    .get(restaurantId, restaurantId, restaurantId, restaurantId, restaurantId, restaurantId) as any
  res.json({ summary: row })
})

staffRouter.get('/notifications', (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*, o.order_number FROM notifications n
       LEFT JOIN orders o ON o.id = n.order_id
       WHERE n.restaurant_id = ? AND n.user_id IS NULL
       ORDER BY n.id DESC LIMIT 20`,
    )
    .all(myRestaurant(req)) as any[]
  res.json({
    notifications: rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      orderNumber: n.order_number,
      createdAt: n.created_at,
      readAt: n.read_at,
    })),
  })
})

// --- Payments ---------------------------------------------------------------

/**
 * UPI arrives directly in the restaurant's own account, so confirmation is a
 * human step: staff check their UPI app and confirm or reject what the
 * customer claimed. Nothing here talks to a payment provider.
 */
staffRouter.get('/payments', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, o.order_number, o.table_label, o.total_cents, g.code AS group_code
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN group_sessions g ON g.id = p.session_id
       WHERE o.restaurant_id = ?
       ORDER BY (p.status = 'CLAIMED') DESC, p.id DESC
       LIMIT 60`,
    )
    .all(myRestaurant(req)) as any[]
  res.json({
    payments: rows.map((p) => ({
      ...shapePayment(p),
      tableLabel: p.table_label,
      groupCode: p.group_code,
      orderTotalCents: p.total_cents,
    })),
  })
})

staffRouter.post('/payments/:id/confirm', (req, res) => {
  const id = Number(req.params.id)
  const payment = db
    .prepare(
      `SELECT p.*, o.restaurant_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ?`,
    )
    .get(id) as any
  if (!payment || payment.restaurant_id !== myRestaurant(req)) {
    return res.status(404).json({ error: 'Payment not found.' })
  }
  const accept = req.body?.accept !== false

  db.transaction(() => {
    db.prepare(`UPDATE payments SET status = ?, settled_at = datetime('now') WHERE id = ?`).run(
      accept ? 'CONFIRMED' : 'REJECTED',
      id,
    )
    if (accept) {
      // 'mine' settles that member's items; anything else settles the whole ticket.
      if (payment.covers === 'mine' && payment.member_id) markMemberItemsPaid(payment.order_id, payment.member_id)
      else markMemberItemsPaid(payment.order_id, null)
      syncOrderPayment(payment.order_id)
    }
  })()

  const order = getOrder(payment.order_id)
  publish('order:update', { restaurantId: payment.restaurant_id, orderId: payment.order_id, order })
  res.json({ ok: true, order })
})

/** Group orders, grouped the way the floor thinks about them: one per table. */
staffRouter.get('/groups', (req, res) => {
  const restaurantId = myRestaurant(req)
  const rows = db
    .prepare(
      `SELECT id FROM group_sessions WHERE restaurant_id = ? ORDER BY (status = 'OPEN') DESC, id DESC LIMIT 40`,
    )
    .all(restaurantId) as any[]
  res.json({ groups: rows.map((r) => shapeSession(r.id)).filter(Boolean) })
})

// --- Photo library ----------------------------------------------------------

/**
 * Photos imported in bulk but not yet attached to a dish. Restaurants send over
 * a folder of shots with no reliable names, so assigning them is a visual job
 * done here rather than guessed at on import.
 */
staffRouter.get('/photos', (req, res) => {
  const restaurantId = myRestaurant(req)
  const photos = db
    .prepare(
      `SELECT p.*, m.name AS item_name FROM photo_library p
       LEFT JOIN menu_items m ON m.id = p.assigned_item
       WHERE p.restaurant_id = ? ORDER BY (p.assigned_item IS NOT NULL), p.id`,
    )
    .all(restaurantId) as any[]
  const items = db
    .prepare(
      `SELECT m.id, m.name, c.name AS section, m.image_path
       FROM menu_items m JOIN menu_categories c ON c.id = m.category_id
       WHERE m.restaurant_id = ? ORDER BY c.sort_order, m.sort_order`,
    )
    .all(restaurantId) as any[]
  res.json({
    photos: photos.map((p) => ({
      id: p.id,
      url: imageUrl(p.file),
      assignedItemId: p.assigned_item,
      assignedName: p.item_name,
    })),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      section: i.section,
      hasPhoto: !!i.image_path,
    })),
  })
})

staffRouter.post('/photos/:id/assign', (req, res) => {
  const restaurantId = myRestaurant(req)
  const photo = db.prepare('SELECT * FROM photo_library WHERE id = ?').get(Number(req.params.id)) as any
  if (!photo || photo.restaurant_id !== restaurantId) {
    return res.status(404).json({ error: 'Photo not found.' })
  }
  const itemId = req.body?.itemId ? Number(req.body.itemId) : null

  if (itemId === null) {
    if (photo.assigned_item) {
      db.prepare('UPDATE menu_items SET image_path = NULL WHERE id = ? AND image_path = ?').run(
        photo.assigned_item,
        photo.file,
      )
    }
    db.prepare('UPDATE photo_library SET assigned_item = NULL WHERE id = ?').run(photo.id)
    return res.json({ ok: true })
  }

  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(itemId) as any
  if (!item || item.restaurant_id !== restaurantId) {
    return res.status(400).json({ error: 'That dish is not on your menu.' })
  }

  db.transaction(() => {
    // One photo per dish: release whatever was on it before.
    db.prepare('UPDATE photo_library SET assigned_item = NULL WHERE assigned_item = ?').run(itemId)
    db.prepare('UPDATE photo_library SET assigned_item = ? WHERE id = ?').run(itemId, photo.id)
    db.prepare('UPDATE menu_items SET image_path = ? WHERE id = ?').run(photo.file, itemId)
  })()
  res.json({ ok: true, itemName: item.name })
})

staffRouter.delete('/photos/:id', (req, res) => {
  const restaurantId = myRestaurant(req)
  const photo = db.prepare('SELECT * FROM photo_library WHERE id = ?').get(Number(req.params.id)) as any
  if (!photo || photo.restaurant_id !== restaurantId) {
    return res.status(404).json({ error: 'Photo not found.' })
  }
  db.transaction(() => {
    if (photo.assigned_item) {
      db.prepare('UPDATE menu_items SET image_path = NULL WHERE id = ? AND image_path = ?').run(
        photo.assigned_item,
        photo.file,
      )
    }
    db.prepare('DELETE FROM photo_library WHERE id = ?').run(photo.id)
  })()
  deleteUpload(photo.file)
  res.json({ ok: true })
})

// --- Table service ----------------------------------------------------------

/**
 * A waiter adding to an order the customer started in the app. Half a table's
 * food often gets ordered by voice, and it has to land on the same bill.
 */
staffRouter.post('/orders/:id/items', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id)) as any
  if (!order || order.restaurant_id !== restaurantId) {
    return res.status(404).json({ error: 'Order not found.' })
  }
  if (order.bill_closed_at) return res.status(409).json({ error: 'That bill is already closed.' })

  const lines = Array.isArray(req.body?.items) ? req.body.items : []
  if (!lines.length) return res.status(400).json({ error: 'Pick at least one dish.' })

  const priced: { item: any; quantity: number }[] = []
  for (const line of lines) {
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(line?.menuItemId)) as any
    if (!item || item.restaurant_id !== restaurantId) {
      return res.status(400).json({ error: 'That dish is not on your menu.' })
    }
    priced.push({ item, quantity: Math.min(50, Math.max(1, Math.floor(Number(line.quantity) || 1))) })
  }

  db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, emoji, unit_price_cents, quantity, added_by_staff)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    )
    for (const l of priced) {
      insert.run(order.id, l.item.id, l.item.name, l.item.emoji, l.item.price_cents, l.quantity)
    }
    const total = db
      .prepare('SELECT COALESCE(SUM(unit_price_cents * quantity), 0) AS n FROM order_items WHERE order_id = ?')
      .get(order.id) as any
    // Rebuilt from the dishes, so anything that is not a dish has to be added
    // back — otherwise a waiter adding a coffee to a delivery order quietly
    // cancels the delivery fee.
    db.prepare(`UPDATE orders SET total_cents = ?, updated_at = datetime('now') WHERE id = ?`).run(
      total.n + (order.delivery_fee_cents ?? 0),
      order.id,
    )
    syncOrderPayment(order.id)
  })()

  const updated = getOrder(order.id)
  publish('order:update', { restaurantId, userId: order.user_id, orderId: order.id, order: updated })
  res.status(201).json({ order: updated })
})

/** Everything owed on a table, ready to print or settle at the counter. */
staffRouter.get('/bill/:id', (req, res) => {
  const restaurantId = myRestaurant(req)
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id)) as any
  if (!order || order.restaurant_id !== restaurantId) {
    return res.status(404).json({ error: 'Order not found.' })
  }
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId) as any
  const shaped = getOrder(order.id)!
  const paid = paidCents(order.id)
  const claimed = claimedCents(order.id)

  res.json({
    bill: {
      restaurant: {
        name: restaurant.name,
        address: restaurant.address,
        phone: restaurant.phone,
        upiVpa: restaurant.upi_vpa,
      },
      orderNumber: shaped.orderNumber,
      tableLabel: shaped.tableLabel,
      serviceType: shaped.serviceType,
      customerName: shaped.customerName,
      placedAt: shaped.createdAt,
      items: shaped.items,
      byPerson: shaped.items.reduce((acc: any[], i: any) => {
        const key = i.memberName ?? shaped.customerName
        const bucket = acc.find((b) => b.name === key)
        const line = { ...i, lineTotal: i.unitPriceCents * i.quantity }
        if (bucket) bucket.items.push(line)
        else acc.push({ name: key, items: [line] })
        return acc
      }, []),
      subtotalCents: shaped.subtotalCents,
      deliveryFeeCents: shaped.deliveryFeeCents,
      totalCents: shaped.totalCents,
      paidCents: paid,
      claimedCents: claimed,
      dueCents: Math.max(0, shaped.totalCents - paid),
      closed: !!order.bill_closed_at,
    },
  })
})

/** Settles the bill: marks it paid in full and closes it to further items. */
staffRouter.post('/bill/:id/settle', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id)) as any
  if (!order || order.restaurant_id !== restaurantId) {
    return res.status(404).json({ error: 'Order not found.' })
  }
  const method = String(req.body?.method ?? 'cash')
  const due = Math.max(0, order.total_cents - paidCents(order.id))

  db.transaction(() => {
    if (due > 0) {
      db.prepare(
        `INSERT INTO payments (order_id, payer_name, amount_cents, method, status, covers, settled_at)
         VALUES (?, ?, ?, ?, 'CONFIRMED', 'all', datetime('now'))`,
      ).run(order.id, order.customer_name, due, method)
    }
    db.prepare(`UPDATE order_items SET paid_at = datetime('now') WHERE order_id = ? AND paid_at IS NULL`).run(order.id)
    db.prepare(
      `UPDATE orders SET payment_status = 'PAID', bill_closed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    ).run(order.id)
    const session = db.prepare('SELECT id FROM group_sessions WHERE order_id = ?').get(order.id) as any
    if (session) {
      db.prepare(`UPDATE group_sessions SET status = 'CLOSED', closed_at = datetime('now') WHERE id = ?`).run(session.id)
    }
  })()

  const updated = getOrder(order.id)
  publish('order:update', { restaurantId, userId: order.user_id, orderId: order.id, order: updated })
  res.json({ order: updated })
})


// --- Live operations --------------------------------------------------------

/**
 * One screen that answers: who is here, where, what did they order, when, what
 * state is it in, who is carrying it, and have they paid. This is the feature —
 * everything else on this page is in service of it.
 */
staffRouter.get('/ops', (req: any, res) => {
  res.json(opsBoard(myRestaurant(req)))
})

/** What the runner carries out next, grouped so one walk covers a whole zone. */
staffRouter.get('/runs', (req: any, res) => {
  res.json({ groups: runQueue(myRestaurant(req)) })
})

/**
 * A car session opened by staff, for a customer who has no phone, no app, or no
 * wish to use one. The restaurant has to work for them too, so this is the same
 * session the customer would have made — it can be handed to them later.
 */
staffRouter.post('/sessions/car', (req: any, res) => {
  const result = startCarSession({
    restaurantId: myRestaurant(req),
    zoneId: req.body?.zoneId ? Number(req.body.zoneId) : null,
    vehicle: String(req.body?.vehicle ?? ''),
    vehicleNumber: String(req.body?.vehicleNumber ?? ''),
    partySize: Number(req.body?.partySize) || 1,
    userId: null,
    openedBy: req.user.id,
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  publish('ops', { restaurantId: myRestaurant(req) })
  res.status(201).json({ session: shapeDiningSession(result.session) })
})

/** Closes a session — the car left, the table got up. */
staffRouter.delete('/sessions/:id', (req: any, res) => {
  const row = db
    .prepare('SELECT * FROM dining_sessions WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), myRestaurant(req)) as any
  if (!row) return res.status(404).json({ error: 'That session is not on your board.' })
  db.prepare("UPDATE dining_sessions SET closed_at = datetime('now') WHERE id = ?").run(row.id)
  publish('ops', { restaurantId: myRestaurant(req) })
  res.json({ ok: true })
})

/** Hands a delivery to a runner, so it is somebody's job rather than everyone's. */
staffRouter.post('/orders/:id/runner', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), restaurantId) as any
  if (!order) return res.status(404).json({ error: 'That order is not on your board.' })

  const runnerId = req.body?.runnerId === null ? null : Number(req.body?.runnerId ?? req.user.id)
  if (runnerId !== null) {
    const onStaff = db
      .prepare('SELECT 1 FROM restaurant_staff WHERE user_id = ? AND restaurant_id = ?')
      .get(runnerId, restaurantId)
    if (!onStaff) return res.status(400).json({ error: 'That person does not work here.' })
  }
  db.prepare("UPDATE orders SET runner_id = ?, updated_at = datetime('now') WHERE id = ?").run(runnerId, order.id)
  publish('ops', { restaurantId })
  res.json({ ok: true })
})

/** The runner reached the car. Recorded with a time, so delays can be found. */
staffRouter.post('/orders/:id/delivered', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), restaurantId) as any
  if (!order) return res.status(404).json({ error: 'That order is not on your board.' })
  if (order.status === 'DELIVERED') return res.json({ ok: true, alreadyDelivered: true })

  db.prepare(
    `UPDATE orders SET status = 'DELIVERED', delivered_at = datetime('now'),
            runner_id = COALESCE(runner_id, ?), updated_at = datetime('now')
      WHERE id = ?`,
  ).run(req.user.id, order.id)
  db.prepare("INSERT INTO order_events (order_id, status, actor) VALUES (?, 'DELIVERED', 'runner')").run(order.id)
  publish('ops', { restaurantId })
  publish('orders', { restaurantId })
  res.json({ ok: true })
})

// --- Roadside zones ---------------------------------------------------------

staffRouter.get('/zones', (req: any, res) => {
  const zones = db
    .prepare('SELECT * FROM service_zones WHERE restaurant_id = ? ORDER BY sort_order, id')
    .all(myRestaurant(req)) as any[]
  res.json({
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      note: z.note,
      token: z.token,
      isActive: !!z.is_active,
      qrPayload: `${req.protocol}://${req.get('host')}/z/${z.token}`,
    })),
  })
})

staffRouter.post('/zones', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const name = String(req.body?.name ?? '').trim().slice(0, 40)
  if (!name) return res.status(400).json({ error: 'Give the zone a name, like "Zone A".' })
  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM service_zones WHERE restaurant_id = ?')
    .get(restaurantId) as any
  const info = db
    .prepare('INSERT INTO service_zones (restaurant_id, name, note, token, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(restaurantId, name, String(req.body?.note ?? '').trim().slice(0, 80), randomToken(8), next.n)
  // A restaurant with a zone is a restaurant that serves cars.
  db.prepare('UPDATE restaurants SET accepts_car = 1 WHERE id = ?').run(restaurantId)
  const z = db.prepare('SELECT * FROM service_zones WHERE id = ?').get(Number(info.lastInsertRowid)) as any
  res.status(201).json({ zone: { id: z.id, name: z.name, note: z.note, token: z.token, isActive: true } })
})

staffRouter.patch('/zones/:id', (req: any, res) => {
  const z = db
    .prepare('SELECT * FROM service_zones WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), myRestaurant(req)) as any
  if (!z) return res.status(404).json({ error: 'That zone is not on this restaurant.' })
  const name = req.body?.name === undefined ? z.name : String(req.body.name).trim().slice(0, 40) || z.name
  const note = req.body?.note === undefined ? z.note : String(req.body.note).trim().slice(0, 80)
  const active = req.body?.isActive === undefined ? z.is_active : req.body.isActive ? 1 : 0
  db.prepare('UPDATE service_zones SET name = ?, note = ?, is_active = ? WHERE id = ?').run(name, note, active, z.id)
  res.json({ ok: true })
})

staffRouter.delete('/zones/:id', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const z = db
    .prepare('SELECT * FROM service_zones WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), restaurantId) as any
  if (!z) return res.status(404).json({ error: 'That zone is not on this restaurant.' })
  // Sessions keep their history; they simply lose the zone they pointed at.
  db.prepare('UPDATE dining_sessions SET zone_id = NULL WHERE zone_id = ?').run(z.id)
  db.prepare('DELETE FROM service_zones WHERE id = ?').run(z.id)
  res.json({ ok: true })
})


// --- POS: bills, payment, invoices ------------------------------------------
//
// There is no separate order model here. Every bill on this screen is an order
// that already exists — placed by a customer through the app, or by a cashier a
// moment ago — so a bill can never disagree with the kitchen about what was
// ordered.

const actorOf = (req: any) => ({ id: req.user.id as number, name: (req.user.name as string) ?? 'Staff' })

/** Everything owed but not yet billed, plus bills raised and not yet settled. */
staffRouter.get('/pos/open', (req: any, res) => {
  const restaurantId = myRestaurant(req)

  const orders = db
    .prepare(
      `SELECT o.*, s.seq_no, s.vehicle, s.service_mode AS session_mode, z.name AS zone_name
         FROM orders o
         LEFT JOIN dining_sessions s ON s.id = o.dining_session_id
         LEFT JOIN service_zones z ON z.id = COALESCE(o.zone_id, s.zone_id)
        WHERE o.restaurant_id = ?
          AND o.status <> 'CANCELLED'
          AND o.invoice_id IS NULL
          AND o.created_at > datetime('now', '-2 days')
        ORDER BY o.created_at ASC`,
    )
    .all(restaurantId) as any[]

  const unpaidInvoices = db
    .prepare(
      `SELECT * FROM invoices WHERE restaurant_id = ? AND status = 'FINAL'
         AND created_at > datetime('now', '-2 days') ORDER BY id DESC`,
    )
    .all(restaurantId) as any[]

  const place = (o: any) =>
    o.session_mode === 'car'
      ? `Car ${o.seq_no ?? ''}${o.zone_name ? ` · ${o.zone_name}` : ''}`.trim()
      : o.table_label
        ? `Table ${o.table_label}`
        : o.service_mode === 'takeaway'
          ? 'Takeaway'
          : 'Counter'

  res.json({
    unbilled: orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.order_number,
      serviceMode: o.service_mode ?? 'dine_in',
      place: place(o),
      status: o.status,
      customerName: o.customer_name,
      totalCents: o.total_cents,
      createdAt: o.created_at,
    })),
    awaitingPayment: unpaidInvoices
      .map((inv) => ({ inv, status: invoicePaymentStatus(inv) }))
      .filter((x) => x.status !== 'PAID' && x.status !== 'REFUNDED')
      .map(({ inv, status }) => ({
        invoiceId: inv.id,
        number: inv.number,
        place: inv.place_label,
        serviceMode: inv.service_mode,
        totalCents: inv.total_cents,
        paidCents: paidOnInvoice(inv.id),
        dueCents: Math.max(0, inv.total_cents - paidOnInvoice(inv.id)),
        paymentStatus: status,
        createdAt: inv.created_at,
      })),
  })
})

/** What this order comes to, priced now. Writes nothing — safe to call on typing. */
staffRouter.post('/pos/quote', (req: any, res) => {
  const orderId = Number(req.body?.orderId)
  const order = db
    .prepare('SELECT id FROM orders WHERE id = ? AND restaurant_id = ?')
    .get(orderId, myRestaurant(req))
  if (!order) return res.status(404).json({ error: 'That order is not on your board.' })
  const bill = quoteOrder(orderId, {
    billDiscountCents: Number(req.body?.discountCents) || 0,
    charges: Array.isArray(req.body?.charges) ? req.body.charges : [],
    interState: !!req.body?.interState,
  })
  res.json({ bill })
})

/** Turns the order into a numbered invoice. Calling twice returns the first. */
staffRouter.post('/pos/finalise', (req: any, res) => {
  const orderId = Number(req.body?.orderId)
  const owned = db
    .prepare('SELECT id FROM orders WHERE id = ? AND restaurant_id = ?')
    .get(orderId, myRestaurant(req))
  if (!owned) return res.status(404).json({ error: 'That order is not on your board.' })

  const result = finaliseInvoice({
    orderId,
    actor: actorOf(req),
    billDiscountCents: Number(req.body?.discountCents) || 0,
    discountReason: String(req.body?.discountReason ?? ''),
    charges: Array.isArray(req.body?.charges) ? req.body.charges : [],
    interState: !!req.body?.interState,
    customerName: req.body?.customerName ? String(req.body.customerName) : undefined,
    customerPhone: req.body?.customerPhone ? String(req.body.customerPhone) : undefined,
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  publish('ops', { restaurantId: myRestaurant(req) })
  res.status(result.created ? 201 : 200).json({ invoice: shapeInvoice(result.invoice.id) })
})

staffRouter.post('/pos/pay', (req: any, res) => {
  const invoiceId = Number(req.body?.invoiceId)
  const owned = db
    .prepare('SELECT id FROM invoices WHERE id = ? AND restaurant_id = ?')
    .get(invoiceId, myRestaurant(req))
  if (!owned) return res.status(404).json({ error: 'That bill is not on your board.' })

  const result = takePayment({
    invoiceId,
    amountCents: Number(req.body?.amountCents),
    method: String(req.body?.method ?? 'cash'),
    tenderedCents: req.body?.tenderedCents != null ? Number(req.body.tenderedCents) : undefined,
    payerName: String(req.body?.payerName ?? ''),
    reference: String(req.body?.reference ?? ''),
    actor: actorOf(req),
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  publish('ops', { restaurantId: myRestaurant(req) })
  res.json({ ok: true, changeCents: result.changeCents, invoice: shapeInvoice(invoiceId) })
})

staffRouter.get('/pos/invoice/:id', (req: any, res) => {
  const inv = db
    .prepare('SELECT id FROM invoices WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), myRestaurant(req))
  if (!inv) return res.status(404).json({ error: 'No such bill.' })
  res.json({ invoice: shapeInvoice(Number(req.params.id)) })
})

staffRouter.post('/pos/invoice/:id/void', (req: any, res) => {
  const owned = db
    .prepare('SELECT id FROM invoices WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), myRestaurant(req))
  if (!owned) return res.status(404).json({ error: 'No such bill.' })
  const result = voidInvoice(Number(req.params.id), String(req.body?.reason ?? ''), actorOf(req))
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  publish('ops', { restaurantId: myRestaurant(req) })
  res.json({ ok: true })
})

staffRouter.post('/pos/invoice/:id/refund', (req: any, res) => {
  const owned = db
    .prepare('SELECT id FROM invoices WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), myRestaurant(req))
  if (!owned) return res.status(404).json({ error: 'No such bill.' })
  const result = refund({
    invoiceId: Number(req.params.id),
    amountCents: Number(req.body?.amountCents),
    method: String(req.body?.method ?? 'cash'),
    reason: String(req.body?.reason ?? ''),
    actor: actorOf(req),
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  res.json({ ok: true, invoice: shapeInvoice(Number(req.params.id)) })
})

/** Search a bill by number, order, table or car. */
staffRouter.get('/pos/search', (req: any, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) return res.json({ invoices: [] })
  const like = `%${q}%`
  const rows = db
    .prepare(
      `SELECT i.* FROM invoices i
         LEFT JOIN orders o ON o.id = i.order_id
        WHERE i.restaurant_id = ?
          AND (i.number LIKE ? OR i.place_label LIKE ? OR i.customer_name LIKE ?
               OR i.customer_phone LIKE ? OR o.order_number LIKE ?)
        ORDER BY i.id DESC LIMIT 25`,
    )
    .all(myRestaurant(req), like, like, like, like, like) as any[]
  res.json({ invoices: rows.map((r) => shapeInvoice(r.id)) })
})

// --- Tax configuration ------------------------------------------------------

staffRouter.get('/tax', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId) as any
  res.json({
    profile: {
      legalName: r.legal_name ?? '',
      gstin: r.gstin ?? '',
      stateCode: r.state_code ?? '',
      invoicePrefix: r.invoice_prefix ?? 'ORD',
      taxEnabled: !!r.tax_enabled,
      address: r.address ?? '',
    },
    rates: db.prepare('SELECT * FROM tax_rates WHERE restaurant_id = ? ORDER BY id').all(restaurantId),
  })
})

staffRouter.patch('/tax', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId) as any
  const next = {
    legal_name: req.body?.legalName === undefined ? r.legal_name : String(req.body.legalName).slice(0, 120),
    gstin: req.body?.gstin === undefined ? r.gstin : String(req.body.gstin).toUpperCase().slice(0, 15),
    state_code: req.body?.stateCode === undefined ? r.state_code : String(req.body.stateCode).slice(0, 2),
    invoice_prefix:
      req.body?.invoicePrefix === undefined
        ? r.invoice_prefix
        : String(req.body.invoicePrefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ORD',
    tax_enabled: req.body?.taxEnabled === undefined ? r.tax_enabled : req.body.taxEnabled ? 1 : 0,
  }
  db.prepare(
    'UPDATE restaurants SET legal_name = ?, gstin = ?, state_code = ?, invoice_prefix = ?, tax_enabled = ? WHERE id = ?',
  ).run(next.legal_name, next.gstin, next.state_code, next.invoice_prefix, next.tax_enabled, restaurantId)
  // Changing how tax is charged is a financial act, so it is on the record.
  audit(restaurantId, actorOf(req), 'tax.configure', 'restaurant', restaurantId, next)
  res.json({ ok: true })
})

staffRouter.post('/tax/rates', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const name = String(req.body?.name ?? '').trim().slice(0, 40)
  const rateBp = Math.max(0, Math.min(10000, Math.round(Number(req.body?.ratePercent) * 100)))
  if (!name || !Number.isFinite(rateBp)) return res.status(400).json({ error: 'Give the rate a name and a percentage.' })
  const info = db
    .prepare('INSERT INTO tax_rates (restaurant_id, name, rate_bp, hsn_sac, inclusive, is_default) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      restaurantId,
      name,
      rateBp,
      String(req.body?.hsnSac ?? '').slice(0, 12),
      req.body?.inclusive === false ? 0 : 1,
      req.body?.isDefault ? 1 : 0,
    )
  if (req.body?.isDefault) {
    db.prepare('UPDATE tax_rates SET is_default = 0 WHERE restaurant_id = ? AND id <> ?').run(
      restaurantId,
      Number(info.lastInsertRowid),
    )
  }
  audit(restaurantId, actorOf(req), 'tax.rate.create', 'tax_rate', Number(info.lastInsertRowid), { name, rateBp })
  res.status(201).json({ rate: db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(Number(info.lastInsertRowid)) })
})

/** A counter sale: the cashier builds the order, and it bills like any other. */
staffRouter.post('/pos/sale', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const lines = (Array.isArray(req.body?.items) ? req.body.items : []).filter((l: any) => Number(l?.quantity) > 0)
  if (!lines.length) return res.status(400).json({ error: 'Add something to the sale first.' })

  const mode = ['counter', 'takeaway', 'dine_in', 'car', 'delivery'].includes(String(req.body?.serviceMode))
    ? String(req.body.serviceMode)
    : 'counter'

  const result = createOrder({
    restaurantId,
    type: mode === 'dine_in' ? 'dine_in' : 'pickup',
    items: lines.map((l: any) => ({ menuItemId: Number(l.menuItemId), quantity: Number(l.quantity) })),
    customerName: String(req.body?.customerName ?? '').trim() || 'Counter',
    userId: null,
    note: String(req.body?.note ?? ''),
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })

  // Staff raised it at the counter, so it is not waiting on a code or a table.
  db.prepare("UPDATE orders SET service_mode = ?, status = 'ACCEPTED' WHERE id = ?").run(mode, result.order.id)
  db.prepare("INSERT INTO order_events (order_id, status, actor) VALUES (?, 'ACCEPTED', 'counter')").run(result.order.id)
  audit(restaurantId, actorOf(req), 'order.counter', 'order', result.order.id, { mode })
  publish('orders', { restaurantId })
  publish('ops', { restaurantId })
  // Re-read: the order was shaped before the update above, so returning it
  // as-is would tell the caller NEW while the database says ACCEPTED.
  res.status(201).json({ order: getOrder(result.order.id) })
})


// --- Delivery: the yes or no a phone order gets ------------------------------
//
// This is the only mode where accepting is a decision rather than a formality.
// A small kitchen with no room says no when it is full, and the app has to be
// able to say no too — with a reason the customer actually reads.

staffRouter.post('/orders/:id/accept', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), restaurantId) as any
  if (!order) return res.status(404).json({ error: 'That order is not on your board.' })
  if (order.status !== 'REQUESTED') {
    return res.status(409).json({ error: 'That order is not waiting to be accepted.' })
  }
  db.prepare(
    "UPDATE orders SET status = 'ACCEPTED', accepted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  ).run(order.id)
  db.prepare("INSERT INTO order_events (order_id, status, actor) VALUES (?, 'ACCEPTED', 'staff')").run(order.id)
  notifyCustomer(order, 'Order accepted', `${order.order_number} is being made now.`)
  publish('orders', { restaurantId })
  publish('ops', { restaurantId })
  res.json({ order: getOrder(order.id) })
})

staffRouter.post('/orders/:id/decline', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), restaurantId) as any
  if (!order) return res.status(404).json({ error: 'That order is not on your board.' })
  if (order.status !== 'REQUESTED') {
    return res.status(409).json({ error: 'That order is not waiting to be accepted.' })
  }
  const reason = String(req.body?.reason ?? '').trim().slice(0, 140)
  if (!reason) return res.status(400).json({ error: 'Say why, so the customer knows.' })

  db.prepare(
    "UPDATE orders SET status = 'DECLINED', declined_reason = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(reason, order.id)
  db.prepare("INSERT INTO order_events (order_id, status, actor) VALUES (?, 'DECLINED', 'staff')").run(order.id)
  notifyCustomer(order, 'Order could not be taken', reason)
  audit(restaurantId, actorOf(req), 'order.decline', 'order', order.id, { reason })
  publish('orders', { restaurantId })
  publish('ops', { restaurantId })
  res.json({ order: getOrder(order.id) })
})

function notifyCustomer(order: any, title: string, body: string) {
  if (!order.user_id) return
  db.prepare(
    'INSERT INTO notifications (restaurant_id, user_id, order_id, title, body) VALUES (?, ?, ?, ?, ?)',
  ).run(order.restaurant_id, order.user_id, order.id, title, body)
}

// --- Delivery areas ---------------------------------------------------------

staffRouter.get('/delivery-areas', (req: any, res) => {
  res.json({
    areas: db
      .prepare('SELECT * FROM delivery_areas WHERE restaurant_id = ? ORDER BY sort_order, id')
      .all(myRestaurant(req)),
  })
})

staffRouter.post('/delivery-areas', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const name = String(req.body?.name ?? '').trim().slice(0, 40)
  if (!name) return res.status(400).json({ error: 'Name the area you deliver to.' })
  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM delivery_areas WHERE restaurant_id = ?')
    .get(restaurantId) as any
  const info = db
    .prepare(
      'INSERT INTO delivery_areas (restaurant_id, name, note, fee_cents, min_order_cents, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      restaurantId,
      name,
      String(req.body?.note ?? '').trim().slice(0, 80),
      Math.max(0, Math.round(Number(req.body?.feeRupees) * 100) || 0),
      Math.max(0, Math.round(Number(req.body?.minOrderRupees) * 100) || 0),
      next.n,
    )
  // A restaurant with somewhere to deliver to is a restaurant that delivers.
  db.prepare('UPDATE restaurants SET accepts_delivery = 1 WHERE id = ?').run(restaurantId)
  res.status(201).json({ area: db.prepare('SELECT * FROM delivery_areas WHERE id = ?').get(Number(info.lastInsertRowid)) })
})

staffRouter.delete('/delivery-areas/:id', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const area = db
    .prepare('SELECT id FROM delivery_areas WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), restaurantId)
  if (!area) return res.status(404).json({ error: 'That area is not on this restaurant.' })
  db.prepare('DELETE FROM delivery_areas WHERE id = ?').run(Number(req.params.id))
  const left = db
    .prepare('SELECT COUNT(*) n FROM delivery_areas WHERE restaurant_id = ? AND is_active = 1')
    .get(restaurantId) as any
  if (!left.n) db.prepare('UPDATE restaurants SET accepts_delivery = 0 WHERE id = ?').run(restaurantId)
  res.json({ ok: true })
})

/** Turns delivery off or on without losing the areas already set up. */
staffRouter.post('/delivery/toggle', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const on = req.body?.on ? 1 : 0
  db.prepare('UPDATE restaurants SET accepts_delivery = ? WHERE id = ?').run(on, restaurantId)
  audit(restaurantId, actorOf(req), on ? 'delivery.on' : 'delivery.off', 'restaurant', restaurantId, '')
  publish('ops', { restaurantId })
  res.json({ ok: true, acceptsDelivery: !!on })
})

// --- Precincts ---------------------------------------------------------------

/**
 * Which nearby areas this restaurant has agreed to carry orders out into, and
 * which ones it could. Joining is a promise to send someone out, so it is
 * opt-in and can be undone the moment the one person on shift cannot leave.
 */
staffRouter.get('/precincts', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const rows = db
    .prepare(
      `SELECT p.id, p.slug, p.name, p.city, p.note,
              EXISTS (SELECT 1 FROM restaurant_precincts rp
                       WHERE rp.precinct_id = p.id AND rp.restaurant_id = ?) AS joined,
              (SELECT COUNT(*) FROM precinct_spots s
                WHERE s.precinct_id = p.id AND s.is_active = 1) AS spots
         FROM precincts p WHERE p.is_active = 1 ORDER BY p.name`,
    )
    .all(restaurantId) as any[]
  res.json({ precincts: rows.map((p) => ({ ...p, joined: !!p.joined })) })
})

staffRouter.post('/precincts/:id/join', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const precinct = db.prepare('SELECT * FROM precincts WHERE id = ? AND is_active = 1').get(Number(req.params.id)) as any
  if (!precinct) return res.status(404).json({ error: 'That area no longer exists.' })

  const join = req.body?.joined !== false
  if (join) {
    db.prepare(
      'INSERT OR IGNORE INTO restaurant_precincts (restaurant_id, precinct_id) VALUES (?, ?)',
    ).run(restaurantId, precinct.id)
  } else {
    db.prepare('DELETE FROM restaurant_precincts WHERE restaurant_id = ? AND precinct_id = ?').run(
      restaurantId,
      precinct.id,
    )
  }
  res.json({ joined: join, name: precinct.name })
})

/** The landmarks inside an area. Any restaurant in it can correct the list —
 *  they are the ones standing there, and a wrong landmark wastes a walk. */
staffRouter.get('/precincts/:id/spots', (req: any, res) => {
  const spots = db
    .prepare('SELECT id, label, note, sort_order FROM precinct_spots WHERE precinct_id = ? ORDER BY sort_order, id')
    .all(Number(req.params.id)) as any[]
  res.json({ spots })
})

staffRouter.post('/precincts/:id/spots', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const precinctId = Number(req.params.id)
  const member = db
    .prepare('SELECT 1 FROM restaurant_precincts WHERE restaurant_id = ? AND precinct_id = ?')
    .get(restaurantId, precinctId)
  if (!member) return res.status(403).json({ error: 'Join the area before editing its landmarks.' })

  const label = String(req.body?.label ?? '').trim().slice(0, 60)
  if (label.length < 2) return res.status(400).json({ error: 'Give the landmark a name.' })
  const note = String(req.body?.note ?? '').trim().slice(0, 120)
  const next = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM precinct_spots WHERE precinct_id = ?').get(precinctId) as any).n
  const info = db
    .prepare('INSERT INTO precinct_spots (precinct_id, label, note, sort_order) VALUES (?, ?, ?, ?)')
    .run(precinctId, label, note, next + 1)
  res.status(201).json({ spot: db.prepare('SELECT id, label, note FROM precinct_spots WHERE id = ?').get(Number(info.lastInsertRowid)) })
})

staffRouter.delete('/precincts/:id/spots/:spotId', (req: any, res) => {
  const restaurantId = myRestaurant(req)
  const precinctId = Number(req.params.id)
  const member = db
    .prepare('SELECT 1 FROM restaurant_precincts WHERE restaurant_id = ? AND precinct_id = ?')
    .get(restaurantId, precinctId)
  if (!member) return res.status(403).json({ error: 'Join the area before editing its landmarks.' })

  // Kept, not deleted: orders already placed point at it, and a runner reading
  // an old ticket still needs to know where they were sent.
  db.prepare('UPDATE precinct_spots SET is_active = 0 WHERE id = ? AND precinct_id = ?').run(
    Number(req.params.spotId),
    precinctId,
  )
  res.json({ ok: true })
})
