import { Router } from 'express'
import { db } from '../db.ts'
import { requireStaff, setActiveRestaurant, userFromToken } from '../auth.ts'
import { generateAccessCode, normalizeCode, tableToken } from '../ids.ts'
import { publish } from '../events.ts'
import { getOrder, shapeOrder } from '../orders-service.ts'
import { deleteUpload, imageUrl, saveDataUrl } from '../uploads.ts'
import { canTransition, STATUS_LABEL, type OrderStatus } from '../../shared/orders.ts'
import { markMemberItemsPaid, shapePayment, syncOrderPayment } from '../payments.ts'
import { shapeSession } from '../groups.ts'

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
  const service = row.order_type === 'pickup' ? 'pickup' : row.takeaway ? 'takeaway' : 'dine_in'
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
    qrPayload: `ORDRO:ACCESS:${row.restaurant_id}:${row.code}`,
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
      qrPayload: `ORDRO:TABLE:${t.token}`,
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
    table: { id: t.id, label: t.label, seats: t.seats, token: t.token, activeOrders: 0, qrPayload: `ORDRO:TABLE:${t.token}` },
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
    restaurant: { id: restaurant.id, name: restaurant.name, isOpen: !!restaurant.is_open, hours: restaurant.hours },
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
        (restaurant_id, category_id, name, description, price_cents, emoji, hue, is_veg, is_available, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  }
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
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId) as any
  res.json({ restaurant: shapeOwnRestaurant(row) })
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

staffRouter.get('/summary', (req, res) => {
  const restaurantId = myRestaurant(req)
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND status = 'NEW') AS newOrders,
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND status NOT IN ('COMPLETED','PICKED_UP','CANCELLED')) AS activeOrders,
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND date(created_at) = date('now')) AS todayOrders,
        (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE restaurant_id = ? AND date(created_at) = date('now') AND status != 'CANCELLED') AS todayCents,
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND payment_status = 'UNPAID' AND status NOT IN ('CANCELLED')) AS unpaid`,
    )
    .get(restaurantId, restaurantId, restaurantId, restaurantId, restaurantId) as any
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
