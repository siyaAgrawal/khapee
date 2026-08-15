import { Router } from 'express'
import { db } from '../db.ts'
import { normalizeCode } from '../ids.ts'
import { imageUrl } from '../uploads.ts'

export const publicRouter = Router()

function shapeRestaurant(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    address: row.address,
    phone: row.phone ?? '',
    imageUrl: imageUrl(row.image_path),
    categories: String(row.categories || '')
      .split(',')
      .map((c: string) => c.trim())
      .filter(Boolean),
    emoji: row.emoji,
    hue: row.hue,
    isOpen: !!row.is_open,
    hours: row.hours,
    prepMinutes: row.prep_minutes,
    // 0 means "no rating yet" — we never invent one for a restaurant.
    rating: row.rating > 0 ? row.rating : null,
    itemCount: row.item_count ?? undefined,
    city: row.city ?? '',
    acceptsPickup: !!row.accepts_pickup,
    acceptsTakeaway: !!row.accepts_takeaway,
    acceptsGroups: !!row.accepts_groups,
    acceptsUpi: !!String(row.upi_vpa ?? '').trim(),
  }
}

/**
 * Customers only see restaurants that have something to sell. A newly created
 * restaurant stays out of the list until its owner publishes a dish.
 */
publicRouter.get('/restaurants', (req, res) => {
  const includeDrafts = req.query.include === 'drafts'
  const rows = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM menu_items m WHERE m.restaurant_id = r.id AND m.is_available = 1) AS item_count
       FROM restaurants r ORDER BY r.is_open DESC, r.name ASC`,
    )
    .all() as any[]
  const visible = includeDrafts ? rows : rows.filter((r) => r.item_count > 0)

  // "Near me" is computed here from coordinates the restaurants entered
  // themselves — the browser supplies the customer's position, no map service
  // is involved, and nothing about the customer is stored.
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  const hasPosition = Number.isFinite(lat) && Number.isFinite(lng)

  let shaped = visible.map((r) => {
    const card = shapeRestaurant(r)
    const distanceKm =
      hasPosition && r.lat != null && r.lng != null ? haversineKm(lat, lng, r.lat, r.lng) : null
    return { ...card, distanceKm }
  })

  if (hasPosition) {
    shaped = shaped.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0
      if (a.distanceKm == null) return 1
      if (b.distanceKm == null) return -1
      return a.distanceKm - b.distanceKm
    })
  }

  const cities = [...new Set(visible.map((r) => String(r.city || '').trim()).filter(Boolean))].sort()
  const nearestCity = hasPosition ? (shaped.find((r) => r.distanceKm != null)?.city ?? null) : null

  res.json({
    restaurants: shaped,
    cities,
    nearestCity,
    draftCount: rows.length - visible.length,
  })
})

/** Great-circle distance in kilometres. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10
}

publicRouter.get('/restaurants/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id) as any
  if (!row) return res.status(404).json({ error: 'That restaurant no longer exists.' })

  const categories = db
    .prepare('SELECT id, name FROM menu_categories WHERE restaurant_id = ? ORDER BY sort_order, id')
    .all(id) as any[]
  const items = db
    .prepare(
      `SELECT id, category_id, name, description, price_cents, emoji, hue, is_veg, is_available, is_special, sort_order, image_path
       FROM menu_items WHERE restaurant_id = ? ORDER BY sort_order, id`,
    )
    .all(id) as any[]

  // This month's specials ride at the top of the menu as a section of their own.
  // The dishes stay in their real section too — this is a shortcut, not a move.
  const specials = items.filter((i) => i.is_special && i.is_available)
  const sections = categories.map((c) => ({
    id: c.id,
    name: c.name,
    items: items.filter((i) => i.category_id === c.id).map(shapeMenuItem),
  }))
  if (specials.length) {
    sections.unshift({ id: SPECIALS_SECTION_ID, name: 'This month', items: specials.map(shapeMenuItem) })
  }

  res.json({ restaurant: shapeRestaurant(row), menu: sections })
})

/** Not a real category row — the specials section is assembled per request. */
const SPECIALS_SECTION_ID = -1

function shapeMenuItem(i: any) {
  return {
    id: i.id,
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

/**
 * Resolves whatever a customer scanned or typed.
 * Accepts a raw access code, a table token, or the full QR payload string.
 */
publicRouter.post('/resolve', (req, res) => {
  const raw = String(req.body?.value ?? '').trim()
  if (!raw) return res.status(400).json({ error: 'Enter a code to continue.' })

  // Accepted payloads: TABLO:TABLE:<token>, a table QR URL (…/t/<token>),
  // TABLO:ACCESS:<restaurantId>:<code>, a bare token, or a typed access code.
  const upper = raw.toUpperCase()
  let kind: 'access' | 'table' | 'unknown' = 'unknown'
  let value = raw

  const tableUrl = raw.match(/\/t\/([a-f0-9]{16})/i)

  if (upper.includes('ORDRO:TABLE:') || upper.includes('TABLO:TABLE:')) {
    kind = 'table'
    value = raw.split(/(?:ORDRO|TABLO):TABLE:/i)[1]?.split(/[^A-Za-z0-9]/)[0] ?? ''
  } else if (tableUrl) {
    kind = 'table'
    value = tableUrl[1]
  } else if (upper.includes('ORDRO:ACCESS:') || upper.includes('TABLO:ACCESS:')) {
    kind = 'access'
    const tail = raw.split(/(?:ORDRO|TABLO):ACCESS:/i)[1] ?? ''
    value = tail.split(':').pop() ?? ''
  }

  if (kind === 'table' || (kind === 'unknown' && /^[a-f0-9]{16}$/i.test(raw))) {
    const table = db
      .prepare(
        `SELECT t.id, t.label, t.restaurant_id, r.name AS restaurant_name, r.is_open
         FROM restaurant_tables t JOIN restaurants r ON r.id = t.restaurant_id
         WHERE t.token = ?`,
      )
      .get(value.toLowerCase()) as any
    if (!table) return res.status(404).json({ error: "That table QR isn't recognised." })
    return res.json({
      kind: 'table',
      restaurantId: table.restaurant_id,
      restaurantName: table.restaurant_name,
      tableId: table.id,
      tableLabel: table.label,
      tableToken: value.toLowerCase(),
    })
  }

  const code = normalizeCode(value)
  if (code.length !== 6) return res.status(400).json({ error: 'Access codes are 6 characters, like K7X92P.' })

  const row = db
    .prepare(
      `SELECT a.*, r.name AS restaurant_name FROM access_codes a
       JOIN restaurants r ON r.id = a.restaurant_id WHERE a.code = ?`,
    )
    .get(code) as any
  if (!row) return res.status(404).json({ error: "That code isn't valid. Ask a staff member for a new one." })

  return res.json({
    kind: 'access',
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    code,
  })
})
