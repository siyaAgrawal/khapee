import { Router } from 'express'
import { optionsFor } from '../menu-options.ts'
import { db } from '../db.ts'
import { pushConfigured, pushPublicKey, pushToRestaurant, renewSubscription, saveSubscription } from '../push.ts'
import { limitedNotice, limitedState, orderableNow } from '../limited.ts'
import { thanksText, waAppLink, waNumber } from '../../shared/thanks.ts'
import { normalizeCode } from '../ids.ts'
import { checkAccessCode } from '../orders-service.ts'
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
    /** Above the alphabet and above nearest-first. Zero for almost everywhere. */
    topRank: row.top_rank ?? 0,
    comingSoon: !row.is_open && !!row.coming_soon,
    acceptsPickup: !!row.accepts_pickup,
    acceptsTakeaway: !!row.accepts_takeaway,
    /**
     * Whether typed codes exist here at all. A restaurant with a QR on every
     * table does not need them, and offering the worse path beside the better
     * one only sends people looking for a member of staff.
     */
    codesEnabled: row.codes_enabled === undefined ? true : !!row.codes_enabled,
    acceptsGroups: !!row.accepts_groups,
    acceptsUpi: !!String(row.upi_vpa ?? '').trim(),
    acceptsCar: !!row.accepts_car,
    acceptsDelivery: !!row.accepts_delivery,
    /**
     * The areas this kitchen delivers to, by name.
     *
     * So the offer on the restaurant's page can say where it delivers rather
     * than "nearby", which is true of everywhere and therefore says nothing —
     * and which a customer cannot act on without opening the delivery page to
     * find out whether their own area is on the list.
     */
    deliveryAreas: (
      db
        .prepare(
          'SELECT name FROM delivery_areas WHERE restaurant_id = ? AND is_active = 1 ORDER BY sort_order, name',
        )
        .all(row.id) as { name: string }[]
    ).map((a) => a.name),
    // The areas this kitchen will carry an order out into, so its own page can
    // offer that alongside eating in, takeaway and the kerb.
    precincts: db
      .prepare(
        `SELECT p.id, p.slug, p.name FROM restaurant_precincts rp
           JOIN precincts p ON p.id = rp.precinct_id
          WHERE rp.restaurant_id = ? AND p.is_active = 1 ORDER BY p.name`,
      )
      .all(row.id) as { id: number; slug: string; name: string }[],
    theme: row.theme ?? '',
  }
}

/**
 * Customers only see restaurants that have something to sell. A newly created
 * restaurant stays out of the list until its owner publishes a dish.
 */
publicRouter.get('/restaurants', (req, res) => {
  const includeDrafts = req.query.include === 'drafts'
  // Veg mode counts only vegetarian dishes, so a place with nothing veg on the
  // menu drops out of the list rather than opening to an empty page.
  const vegOnly = req.query.veg === '1'
  const rows = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM menu_items m
                    WHERE m.restaurant_id = r.id AND m.is_available = 1 AND (0 = ? OR m.is_veg = 1)) AS item_count
       FROM restaurants r ORDER BY r.is_open DESC, r.top_rank DESC, r.name ASC`,
    )
    .all(vegOnly ? 1 : 0) as any[]
  const visible = includeDrafts ? rows : rows.filter((r) => r.item_count > 0 && !r.unlisted)

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
      // A restaurant put at the top stays there. Nearest-first is a
      // convenience; being first is a decision, and the decision wins.
      if (a.topRank !== b.topRank) return b.topRank - a.topRank
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
    cuisines: cuisineTiles(visible),
    cities,
    nearestCity,
    draftCount: rows.length - visible.length,
  })
})

/** The cuisines on offer, most-served first. The picture is drawn client-side. */
function cuisineTiles(restaurants: any[]) {
  // Restaurants type their own cuisines, so "Cafe" and "cafe" arrive as two.
  // They are one tile, labelled the way most owners wrote it.
  const byCuisine = new Map<string, { label: string; count: number }>()
  for (const r of restaurants) {
    for (const raw of String(r.categories || '').split(',')) {
      const name = raw.trim()
      if (!name) continue
      const key = name.toLowerCase()
      const tile = byCuisine.get(key) ?? { label: name, count: 0 }
      if (name[0] === name[0].toUpperCase() && tile.label[0] !== tile.label[0].toUpperCase()) tile.label = name
      tile.count++
      byCuisine.set(key, tile)
    }
  }

  return [...byCuisine.values()]
    .map((t) => ({ name: t.label, count: t.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

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
  const vegOnly = req.query.veg === '1'
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id) as any
  if (!row) return res.status(404).json({ error: 'That restaurant no longer exists.' })

  const categories = db
    .prepare('SELECT id, name FROM menu_categories WHERE restaurant_id = ? ORDER BY sort_order, id')
    .all(id) as any[]
  const items = db
    .prepare(
      `SELECT id, category_id, name, description, price_cents, emoji, hue, is_veg, is_available, is_special, sort_order, image_path, group_label
       FROM menu_items WHERE restaurant_id = ? ORDER BY sort_order, id`,
    )
    .all(id)
    .filter((i: any) => !vegOnly || i.is_veg) as any[]

  // This month's specials ride at the top of the menu as a section of their own.
  // The dishes stay in their real section too — this is a shortcut, not a move.
  /*
   * Half open: the kitchen has shut but the fridge has not.
   *
   * Everything outside the sections that are still going reads as
   * unavailable, exactly as a sold-out dish does — not hidden. A menu that
   * quietly loses two thirds of itself at ten o'clock looks broken, and
   * somebody who came for the pasta deserves to see that it exists and is off
   * tonight rather than to wonder whether they imagined it.
   */
  const limited = limitedState(id)
  // Variations and add-ons, for the dishes that have them.
  const dishOptions = optionsFor(items.map((i: any) => i.id))
  const shape = (i: any) => {
    const o = dishOptions.get(i.id)
    return {
      ...shapeMenuItem(i),
      isAvailable: orderableNow(i, limited),
      ...(o && (o.variations.length || o.addonGroups.length)
        ? {
            options: {
              variations: o.variations.map((v) => ({
                id: v.id,
                name: v.name,
                groupName: v.groupName,
                priceCents: v.priceCents,
                isAvailable: v.isAvailable,
              })),
              addonGroups: o.addonGroups.map((g) => ({
                id: g.id,
                name: g.name,
                min: g.min,
                max: g.max,
                variationId: g.variationId,
                items: g.items.map((a) => ({ id: a.id, name: a.name, priceCents: a.priceCents, isAvailable: a.isAvailable })),
              })),
            },
          }
        : {}),
    }
  }

  const specials = items.filter((i) => i.is_special && i.is_available)
  const sections = categories.map((c) => ({
    id: c.id,
    name: c.name,
    items: items.filter((i) => i.category_id === c.id).map(shape),
  }))
  if (specials.length) {
    sections.unshift({ id: SPECIALS_SECTION_ID, name: 'This month', items: specials.map(shape) })
  }

  // An empty section is noise once veg mode has filtered the menu down.
  res.json({
    restaurant: shapeRestaurant(row),
    menu: sections.filter((s) => s.items.length > 0),
    // Said once, at the top, so nobody fills a basket they cannot order.
    limited: limited.on
      ? { on: true, sections: limited.sectionNames, notice: limitedNotice(limited), prepaidOnly: true }
      : { on: false },
  })
})

/**
 * An invite to put order alerts on this phone.
 *
 * Deliberately outside the dashboard: whoever opens this has no account and
 * needs none. The token is the whole of their authority, it buys exactly one
 * thing — being notified about this restaurant's orders — and it is spent the
 * moment a device takes it.
 */
publicRouter.get('/alerts/invite/:token', (req, res) => {
  const row = db
    .prepare(
      `SELECT ai.*, r.name AS restaurant FROM alert_invites ai
         JOIN restaurants r ON r.id = ai.restaurant_id
        WHERE ai.token = ?`,
    )
    .get(String(req.params.token).trim().toUpperCase()) as any
  if (!row) return res.status(404).json({ error: 'That link is not valid.' })
  if (row.revoked_at) return res.status(410).json({ error: 'That link was cancelled.' })
  if (row.used_at && !row.reusable) {
    return res.status(410).json({ error: 'That link has already been used on a phone.' })
  }
  const expired = db
    .prepare(`SELECT (? <= datetime('now')) AS gone`)
    .get(row.expires_at) as any
  if (expired?.gone) return res.status(410).json({ error: 'That link has expired. Ask for a new one.' })
  res.json({
    restaurant: row.all_restaurants ? 'every restaurant on Khapee' : row.restaurant,
    everywhere: !!row.all_restaurants,
    available: pushConfigured(),
    publicKey: pushPublicKey(),
  })
})

publicRouter.post('/alerts/invite/:token', (req, res) => {
  const row = db
    .prepare('SELECT * FROM alert_invites WHERE token = ?')
    .get(String(req.params.token).trim().toUpperCase()) as any
  if (!row) return res.status(404).json({ error: 'That link is not valid.' })
  if (row.revoked_at) return res.status(410).json({ error: 'That link was cancelled.' })
  if (row.used_at && !row.reusable) {
    return res.status(410).json({ error: 'That link has already been used.' })
  }
  const expired = db.prepare(`SELECT (? <= datetime('now')) AS gone`).get(row.expires_at) as any
  if (expired?.gone) return res.status(410).json({ error: 'That link has expired.' })

  const by = row.created_by
    ? ((db.prepare('SELECT name FROM users WHERE id = ?').get(row.created_by) as any)?.name ?? '')
    : ''
  const saved = saveSubscription(
    null,
    row.restaurant_id,
    req.body?.subscription ?? req.body,
    row.all_restaurants ? 'Phone following every restaurant' : by ? `Phone invited by ${by}` : 'Invited phone',
    !!row.all_restaurants,
  )
  if (!saved.ok) return res.status(400).json({ error: saved.error })
  db.prepare("UPDATE alert_invites SET used_at = datetime('now') WHERE id = ?").run(row.id)
  res.json({ ok: true })
})

/**
 * Proving it works, on the phone that just switched it on.
 *
 * Somebody who sets this up with a code has no account and no dashboard, so
 * everything that could reassure them lived somewhere they cannot reach. They
 * were left to put the phone down and hope — and the first real order is a bad
 * time to find out. A code already buys alerts for this restaurant; being able
 * to make your own phone buzz with it is strictly less than that.
 *
 * With a number it sends the thank-you notification instead of a plain one, so
 * the WhatsApp step — the last link, and the one that has been hard to see —
 * can be tried here too, without waiting for an order to accept.
 */
publicRouter.post('/alerts/invite/:token/test', async (req, res) => {
  const row = db
    .prepare('SELECT * FROM alert_invites WHERE token = ?')
    .get(String(req.params.token).trim().toUpperCase()) as any
  if (!row) return res.status(404).json({ error: 'That code is not valid.' })
  if (row.revoked_at) return res.status(410).json({ error: 'That code was cancelled.' })

  const to = waNumber(String(req.body?.phone ?? ''))
  if (to) {
    const message = thanksText('Aarav')
    const result = await pushToRestaurant(row.restaurant_id, {
      title: 'Thank Aarav on WhatsApp',
      body: 'This is the test. Tap it — WhatsApp should open with the message written.',
      url: `/thank?to=${to}&who=Aarav&text=${encodeURIComponent(message)}`,
      wa: waAppLink(to, message),
      tag: 'khapee-thank-test',
    })
    return res.json({ ok: true, ...result, to })
  }

  const result = await pushToRestaurant(row.restaurant_id, {
    title: 'Khapee alerts are working',
    body: 'This is what a new order will look like.',
    tag: 'khapee-test',
  })
  res.json({ ok: true, ...result })
})

/**
 * Whether the server is actually holding this phone's registration.
 *
 * The app decided whether to show "turn on order alerts" from what the phone
 * itself remembered — a push subscription in the browser and a code in local
 * storage. Neither is evidence. The device registrations live in a database
 * that is rebuilt from the published copy every time the service restarts, so
 * a phone can hold a perfectly good subscription for a server that has never
 * heard of it, and that phone — the one that will not ring — is the one the
 * line was hiding from. Silence read as success.
 *
 * So the phone asks. No authentication, because there is nothing here to
 * protect: an endpoint is a secret only the phone that owns it knows, and the
 * answer is whether the thing you are holding is known, which you learn anyway
 * the first time an order does not arrive.
 */
publicRouter.post('/alerts/registered', (req, res) => {
  const endpoint = String(req.body?.endpoint ?? '')
  if (!endpoint) return res.json({ registered: false })
  const row = db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(endpoint)
  res.json({ registered: !!row })
})

/**
 * A browser replacing a phone's push subscription, reported by its service
 * worker. The retired endpoint is the proof of ownership — see
 * renewSubscription. Answers 200 either way, so it cannot be used to learn
 * which endpoints are on file.
 */
publicRouter.post('/alerts/renew', (req, res) => {
  const renewed = renewSubscription(String(req.body?.oldEndpoint ?? ''), req.body?.subscription)
  res.json({ ok: true, renewed })
})

/** Not a real category row — the specials section is assembled per request. */
const SPECIALS_SECTION_ID = -1

function shapeMenuItem(i: any) {
  return {
    groupLabel: i.group_label ?? '',
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
 * What people actually order here, most first — for the top of the menu, so
 * a regular's cold coffee is the first thing on the screen rather than the
 * sixtieth. Dish ids only; nothing about who ordered them. Only dishes still
 * on the menu and available, from the last 30 days of real (not cancelled)
 * orders, and only once a dish has been ordered more than once.
 */
publicRouter.get('/restaurants/:id/popular', (req, res) => {
  const restaurantId = Number(req.params.id)
  /*
   * A restaurant's own picks, until the orders can speak for themselves.
   *
   * A new place has too few orders for "most ordered" to mean anything, so
   * the dishes it chose stand in. Once it has had PICKS_UNTIL real orders in
   * the last 30 days, the list is what people actually ordered in those 30
   * days, and it keeps moving with them. Only dishes still on the menu and
   * available, either way.
   */
  const PICKS_UNTIL = 40
  const recent = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM orders
            WHERE restaurant_id = ? AND status NOT IN ('CANCELLED', 'DECLINED')
              AND created_at >= datetime('now', '-30 days')`,
        )
        .get(restaurantId) as any
    ).n,
  )
  const own = String(
    (db.prepare('SELECT featured_items FROM restaurants WHERE id = ?').get(restaurantId) as any)?.featured_items ?? '',
  )
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
  if (own.length && recent < PICKS_UNTIL) {
    const ok = new Set(
      (
        db
          .prepare(
            `SELECT id FROM menu_items WHERE restaurant_id = ? AND is_available = 1 AND id IN (${own.map(() => '?').join(',')})`,
          )
          .all(restaurantId, ...own) as any[]
      ).map((r) => Number(r.id)),
    )
    res.set('Cache-Control', 'public, max-age=300')
    return res.json({ ids: own.filter((n) => ok.has(n)) })
  }
  const rows = db
    .prepare(
      `SELECT oi.menu_item_id AS id, SUM(oi.quantity) AS n
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN menu_items m ON m.id = oi.menu_item_id
        WHERE o.restaurant_id = ?
          AND o.status NOT IN ('CANCELLED', 'DECLINED')
          AND o.created_at >= datetime('now', '-30 days')
          AND (oi.accepted IS NULL OR oi.accepted = 1)
          AND m.is_available = 1
        GROUP BY oi.menu_item_id
       HAVING n > 1
        ORDER BY n DESC
        LIMIT 6`,
    )
    .all(restaurantId) as any[]
  res.set('Cache-Control', 'public, max-age=300')
  res.json({ ids: rows.map((r) => Number(r.id)) })
})

/** The roadside zones a restaurant has set up, for the "where are you?" step. */
publicRouter.get('/restaurants/:id/zones', (req, res) => {
  const zones = db
    .prepare(
      'SELECT id, name, note FROM service_zones WHERE restaurant_id = ? AND is_active = 1 ORDER BY sort_order, id',
    )
    .all(Number(req.params.id))
  res.json({ zones })
})

/** The localities this restaurant will deliver to, and what it charges. */
publicRouter.get('/restaurants/:id/delivery-areas', (req, res) => {
  const areas = db
    .prepare(
      `SELECT id, name, note, fee_cents, min_order_cents FROM delivery_areas
        WHERE restaurant_id = ? AND is_active = 1 ORDER BY sort_order, id`,
    )
    .all(Number(req.params.id)) as any[]
  res.json({
    areas: areas.map((a) => ({
      id: a.id,
      name: a.name,
      note: a.note,
      feeCents: a.fee_cents,
      minOrderCents: a.min_order_cents,
    })),
  })
})

/** A zone's own QR sign: "parked in Zone A? scan to order". */
publicRouter.get('/zones/:token', (req, res) => {
  const zone = db
    .prepare(
      `SELECT z.id, z.name, z.note, z.restaurant_id, r.name AS restaurant_name, r.is_open
         FROM service_zones z JOIN restaurants r ON r.id = z.restaurant_id
        WHERE z.token = ? AND z.is_active = 1`,
    )
    .get(String(req.params.token)) as any
  if (!zone) return res.status(404).json({ error: "That sign isn't recognised." })
  res.json({
    zone: { id: zone.id, name: zone.name, note: zone.note },
    restaurantId: zone.restaurant_id,
    restaurantName: zone.restaurant_name,
    isOpen: !!zone.is_open,
  })
})

/**
 * Resolves whatever a customer scanned or typed.
 * Accepts a raw access code, a table token, or the full QR payload string.
 */
publicRouter.post('/resolve', (req, res) => {
  const raw = String(req.body?.value ?? '').trim()
  if (!raw) return res.status(400).json({ error: 'Enter a code to continue.' })

  // Accepted payloads: KHAPEE:TABLE:<token>, a table QR URL (…/t/<token>),
  // KHAPEE:ACCESS:<restaurantId>:<code>, KHAPEE:ROOM:<code>, a room link.
  // ORDRO: and TABLO: are the names this app had before; codes printed under
  // them are still on tables and must keep scanning.
  // (…/g/<code>), a bare table token, a typed access code, or a room code.
  const upper = raw.toUpperCase()
  let kind: 'access' | 'table' | 'room' | 'unknown' = 'unknown'
  let value = raw

  const tableUrl = raw.match(/\/t\/([a-f0-9]{16})/i)
  // Rooms are G plus four; the earliest ones were four bare characters.
  const roomUrl = raw.match(/\/g\/([A-Za-z0-9]{4,5})(?:[^A-Za-z0-9]|$)/)

  if (upper.includes('KHAPEE:ROOM:') || upper.includes('ORDRO:ROOM:') || upper.includes('TABLO:ROOM:')) {
    kind = 'room'
    value = raw.split(/(?:KHAPEE|ORDRO|TABLO):ROOM:/i)[1]?.split(/[^A-Za-z0-9]/)[0] ?? ''
  } else if (roomUrl) {
    kind = 'room'
    value = roomUrl[1]
  } else if (upper.includes('KHAPEE:TABLE:') || upper.includes('ORDRO:TABLE:') || upper.includes('TABLO:TABLE:')) {
    kind = 'table'
    value = raw.split(/(?:KHAPEE|ORDRO|TABLO):TABLE:/i)[1]?.split(/[^A-Za-z0-9]/)[0] ?? ''
  } else if (tableUrl) {
    kind = 'table'
    value = tableUrl[1]
  } else if (upper.includes('KHAPEE:ACCESS:') || upper.includes('ORDRO:ACCESS:') || upper.includes('TABLO:ACCESS:')) {
    kind = 'access'
    const tail = raw.split(/(?:KHAPEE|ORDRO|TABLO):ACCESS:/i)[1] ?? ''
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

  // Room codes are shorter than the restaurant's six-character access code, so
  // one box takes whatever the customer happens to have.
  const typed = normalizeCode(value)
  if (kind === 'room' || (kind === 'unknown' && typed.length >= 4 && typed.length <= 5)) {
    const room = db
      .prepare(
        `SELECT g.code, g.status, g.table_label, g.restaurant_id, r.name AS restaurant_name
         FROM group_sessions g JOIN restaurants r ON r.id = g.restaurant_id WHERE g.code = ?`,
      )
      .get(typed) as any
    if (!room) return res.status(404).json({ error: "That room code isn't valid." })
    if (room.status === 'CLOSED') return res.status(409).json({ error: 'That room has already closed.' })
    return res.json({
      kind: 'room',
      restaurantId: room.restaurant_id,
      restaurantName: room.restaurant_name,
      tableLabel: room.table_label,
      code: room.code,
    })
  }

  const code = typed
  if (code.length !== 6) return res.status(400).json({ error: 'Access codes are 6 characters, like K7X92P.' })

  const row = db
    .prepare(
      `SELECT a.*, r.name AS restaurant_name FROM access_codes a
       JOIN restaurants r ON r.id = a.restaurant_id WHERE a.code = ?`,
    )
    .get(code) as any
  if (!row) return res.status(404).json({ error: "That code isn't valid. Ask a staff member for a new one." })

  // Say so here rather than waving the customer through to a checkout that
  // would reject the same code a few taps later.
  const check = checkAccessCode(code, row.restaurant_id)
  if (!check.ok) return res.status(400).json({ error: check.message })

  return res.json({
    kind: 'access',
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    code,
  })
})

/**
 * A precinct as a customer standing in it sees it: the places they might be
 * standing, and every kitchen willing to walk an order over.
 *
 * The point of the screen this feeds is that it is not about one restaurant.
 * Somebody outside a café in 140 wants what is available in 140, which is the
 * question the rest of the app never asks.
 */
publicRouter.get('/precincts/:slug', (req, res) => {
  const precinct = db
    .prepare('SELECT * FROM precincts WHERE slug = ? AND is_active = 1')
    .get(String(req.params.slug).toLowerCase()) as any
  if (!precinct) return res.status(404).json({ error: 'That area is not on Khapee.' })

  const spots = db
    .prepare(
      `SELECT id, label, note FROM precinct_spots
        WHERE precinct_id = ? AND is_active = 1 ORDER BY sort_order, id`,
    )
    .all(precinct.id) as any[]

  // Only restaurants that have joined, are open, and have something to sell.
  const restaurants = db
    .prepare(
      `SELECT r.id, r.name, r.slug, r.description, r.categories, r.emoji, r.hue, r.image_path,
              r.prep_minutes, r.is_open, r.rating
         FROM restaurant_precincts rp
         JOIN restaurants r ON r.id = rp.restaurant_id
        WHERE rp.precinct_id = ?
          AND EXISTS (SELECT 1 FROM menu_items m WHERE m.restaurant_id = r.id AND m.is_available = 1)
        ORDER BY r.is_open DESC, r.top_rank DESC, r.name`,
    )
    .all(precinct.id) as any[]

  res.json({
    precinct: { id: precinct.id, slug: precinct.slug, name: precinct.name, city: precinct.city, note: precinct.note },
    spots,
    restaurants: restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      categories: String(r.categories || '').split(',').map((c: string) => c.trim()).filter(Boolean),
      emoji: r.emoji,
      hue: r.hue,
      imageUrl: imageUrl(r.image_path),
      prepMinutes: r.prep_minutes,
      isOpen: !!r.is_open,
      rating: r.rating,
    })),
  })
})

/** Every precinct with anyone serving it — for a "near me" list later. */
publicRouter.get('/precincts', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.slug, p.name, p.city, p.note,
              (SELECT COUNT(*) FROM restaurant_precincts rp WHERE rp.precinct_id = p.id) AS restaurants
         FROM precincts p WHERE p.is_active = 1 ORDER BY p.name`,
    )
    .all() as any[]
  res.json({ precincts: rows })
})
