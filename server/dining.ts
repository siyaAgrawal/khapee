import { db } from './db.ts'
import { normalizeCode, randomToken } from './ids.ts'
import { checkAccessCode } from './orders-service.ts'
import type { ServiceMode } from '../shared/orders.ts'

/**
 * A dining session is "this person is here, at this restaurant, right now".
 *
 * It opens the moment a customer proves presence — by entering the staff code,
 * scanning a table QR, or paying through the app — and stays open for the meal.
 * Ordering then needs no further proof, and the same session covers a second
 * round, so a single-use code is spent once rather than at every order.
 */
const SESSION_HOURS = 4

export type SessionResult =
  | { ok: true; session: any }
  | { ok: false; status: number; error: string }

export function shapeDiningSession(row: any) {
  if (!row) return null
  const live = db
    .prepare(
      `SELECT (expires_at > datetime('now') AND closed_at IS NULL) AS active,
              strftime('%s', expires_at) - strftime('%s','now') AS seconds_left
       FROM dining_sessions WHERE id = ?`,
    )
    .get(row.id) as any
  const restaurant = db.prepare('SELECT name, emoji, hue FROM restaurants WHERE id = ?').get(row.restaurant_id) as any
  return {
    token: row.token,
    restaurantId: row.restaurant_id,
    restaurantName: restaurant?.name ?? '',
    restaurantEmoji: restaurant?.emoji ?? '🍽️',
    tableId: row.table_id,
    tableLabel: row.table_label,
    source: row.source as 'code' | 'table_qr' | 'payment',
    serviceMode: (row.service_mode ?? 'dine_in') as ServiceMode,
    zoneId: row.zone_id ?? null,
    zoneName: row.zone_id
      ? ((db.prepare('SELECT name FROM service_zones WHERE id = ?').get(row.zone_id) as any)?.name ?? null)
      : null,
    vehicle: row.vehicle ?? '',
    vehicleNumber: row.vehicle_number ?? '',
    seqNo: row.seq_no ?? null,
    ...(() => {
      // Carried on the session so the checkout can show what the delivery adds
      // and what it still needs, without asking for the area a second time.
      const area = row.area_id
        ? (db.prepare('SELECT * FROM delivery_areas WHERE id = ?').get(row.area_id) as any)
        : null
      return {
        areaId: row.area_id ?? null,
        areaName: area?.name ?? null,
        deliveryFeeCents: area?.fee_cents ?? 0,
        minOrderCents: area?.min_order_cents ?? 0,
      }
    })(),
    ...(() => {
      // The landmark someone is standing at, and the precinct it belongs to.
      const spot = row.spot_id
        ? (db
            .prepare(
              `SELECT s.label, s.note, p.name AS precinct_name, p.slug AS precinct_slug
                 FROM precinct_spots s JOIN precincts p ON p.id = s.precinct_id
                WHERE s.id = ?`,
            )
            .get(row.spot_id) as any)
        : null
      return {
        precinctId: row.precinct_id ?? null,
        precinctName: spot?.precinct_name ?? null,
        precinctSlug: spot?.precinct_slug ?? null,
        spotId: row.spot_id ?? null,
        spotLabel: spot?.label ?? null,
        spotNote: spot?.note ?? '',
      }
    })(),
    address: row.address ?? '',
    phone: row.phone ?? '',
    code: row.code ?? '',
    label:
      (row.service_mode ?? 'dine_in') === 'car'
        ? `Car ${row.seq_no ?? ''}`.trim()
        : (row.service_mode ?? '') === 'delivery'
          ? 'Delivery'
          : (row.service_mode ?? '') === 'precinct'
            ? ((db.prepare('SELECT label FROM precinct_spots WHERE id = ?').get(row.spot_id) as any)?.label ??
              'Nearby')
            : (row.table_label ?? null),
    openedByStaff: !!row.opened_by,
    partySize: row.party_size ?? 1,
    active: !!live?.active,
    secondsLeft: Math.max(0, Number(live?.seconds_left ?? 0)),
    createdAt: row.created_at,
  }
}

export function sessionByToken(token: string | undefined | null) {
  if (!token) return null
  return db.prepare('SELECT * FROM dining_sessions WHERE token = ?').get(token) as any
}

/** True when the session is usable for ordering at this restaurant. */
export function sessionIsValid(row: any, restaurantId: number): boolean {
  if (!row || row.restaurant_id !== restaurantId) return false
  const live = db
    .prepare(
      `SELECT (expires_at > datetime('now') AND closed_at IS NULL) AS active FROM dining_sessions WHERE id = ?`,
    )
    .get(row.id) as any
  return !!live?.active
}

function insert(opts: {
  restaurantId: number
  tableId: number | null
  tableLabel: string | null
  accessCodeId: number | null
  source: 'code' | 'table_qr' | 'payment'
  userId: number | null
}) {
  const token = randomToken(14)
  db.prepare(
    `INSERT INTO dining_sessions (token, restaurant_id, table_id, table_label, access_code_id, source, user_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+${SESSION_HOURS} hours'))`,
  ).run(token, opts.restaurantId, opts.tableId, opts.tableLabel, opts.accessCodeId, opts.source, opts.userId)
  return db.prepare('SELECT * FROM dining_sessions WHERE token = ?').get(token) as any
}

/**
 * Opens a session from whatever the customer scanned or typed. Accepts a staff
 * access code, a table QR token, or the full QR payload of either.
 */
/** Restaurant names often end in a full stop ("99 Kitchen & Co."); don't add a second. */
function named(name: unknown): string {
  const text = String(name ?? '').trim()
  return text ? text.replace(/\.+$/, '') : 'another restaurant'
}

export function startSession(input: { value: string; restaurantId?: number | null; userId: number | null }): SessionResult {
  const raw = String(input.value ?? '').trim()
  if (!raw) return { ok: false, status: 400, error: 'Enter a code to continue.' }

  const upper = raw.toUpperCase()
  const tableUrl = raw.match(/\/t\/([a-f0-9]{16})/i)
  let tableToken: string | null = null

  if (upper.includes('KHAPEE:TABLE:') || upper.includes('ORDRO:TABLE:') || upper.includes('TABLO:TABLE:')) tableToken = raw.split(/(?:KHAPEE|ORDRO|TABLO):TABLE:/i)[1]?.split(/[^A-Za-z0-9]/)[0] ?? null
  else if (tableUrl) tableToken = tableUrl[1]
  else if (/^[a-f0-9]{16}$/i.test(raw)) tableToken = raw

  if (tableToken) {
    const table = db
      .prepare(
        `SELECT t.*, r.is_open, r.name AS restaurant_name FROM restaurant_tables t
         JOIN restaurants r ON r.id = t.restaurant_id WHERE t.token = ?`,
      )
      .get(tableToken.toLowerCase()) as any
    if (!table) return { ok: false, status: 404, error: "That table QR isn't recognised." }
    if (input.restaurantId && table.restaurant_id !== input.restaurantId) {
      return { ok: false, status: 400, error: `That QR belongs to ${named(table.restaurant_name)}.` }
    }
    return {
      ok: true,
      session: insert({
        restaurantId: table.restaurant_id,
        tableId: table.id,
        tableLabel: table.label,
        accessCodeId: null,
        source: 'table_qr',
        userId: input.userId,
      }),
    }
  }

  // Otherwise it is an access code, which identifies its own restaurant.
  let code = raw
  if (upper.includes('KHAPEE:ACCESS:') || upper.includes('ORDRO:ACCESS:') || upper.includes('TABLO:ACCESS:')) code = (raw.split(/(?:KHAPEE|ORDRO|TABLO):ACCESS:/i)[1] ?? '').split(':').pop() ?? ''
  code = normalizeCode(code)
  if (code.length !== 6) return { ok: false, status: 400, error: 'Access codes are 6 characters, like K7X92P.' }

  const row = db.prepare('SELECT * FROM access_codes WHERE code = ?').get(code) as any
  if (!row) return { ok: false, status: 404, error: "That code isn't valid. Ask a staff member for a new one." }
  if (input.restaurantId && row.restaurant_id !== input.restaurantId) {
    const other = db.prepare('SELECT name FROM restaurants WHERE id = ?').get(row.restaurant_id) as any
    return { ok: false, status: 400, error: `That code belongs to ${named(other?.name)}.` }
  }

  const check = checkAccessCode(code, row.restaurant_id)
  if (!check.ok) return { ok: false, status: 400, error: check.message }

  // A single-use code is spent by the order, not by opening the session — the
  // staff screen promises exactly that. Consuming it here meant a customer who
  // re-entered their own correct code (second device, cleared storage, or just
  // reopening the sheet) was told it was already used.
  return {
    ok: true,
    session: insert({
      restaurantId: row.restaurant_id,
      tableId: null,
      tableLabel: null,
      accessCodeId: row.id,
      source: 'code',
      userId: input.userId,
    }),
  }
}

/** Opens a session off the back of a payment, with no code needed. */
export function startPaidSession(opts: {
  restaurantId: number
  tableId: number | null
  tableLabel: string | null
  userId: number | null
}) {
  return insert({ ...opts, accessCodeId: null, source: 'payment' })
}

export function setSessionTable(token: string, tableId: number): SessionResult {
  const row = sessionByToken(token)
  if (!row) return { ok: false, status: 404, error: 'That session has ended. Scan or enter the code again.' }
  const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(tableId) as any
  if (!table || table.restaurant_id !== row.restaurant_id) {
    return { ok: false, status: 400, error: 'Pick a table from the list to continue.' }
  }
  db.prepare('UPDATE dining_sessions SET table_id = ?, table_label = ? WHERE id = ?').run(table.id, table.label, row.id)
  return { ok: true, session: sessionByToken(token) }
}

export function closeSession(token: string) {
  db.prepare(`UPDATE dining_sessions SET closed_at = datetime('now') WHERE token = ?`).run(token)
}


/**
 * Opens a session for someone parked outside.
 *
 * A car is the same thing a table is — these people, here, now — so it is the
 * same session with a different place attached. What it must not need is a
 * table number, a code from a staff member, or anything typed that the customer
 * would rather not type: the point of the whole feature is that nobody has to
 * walk out to the car before an order can exist.
 *
 * `seq_no` is per restaurant and per day, so staff say "Car 27" and not "Car
 * 1043". It restarts each day because that is how the number is used out loud.
 */
export function startCarSession(opts: {
  restaurantId: number
  zoneId: number | null
  vehicle: string
  vehicleNumber?: string
  partySize?: number
  userId: number | null
  openedBy?: number | null
}): { ok: true; session: any } | { ok: false; status: number; error: string } {
  const restaurant = db
    .prepare('SELECT id, name, is_open, accepts_car FROM restaurants WHERE id = ?')
    .get(opts.restaurantId) as any
  if (!restaurant) return { ok: false, status: 404, error: 'That restaurant no longer exists.' }
  if (!restaurant.accepts_car) {
    return { ok: false, status: 409, error: `${named(restaurant.name)} isn't taking roadside orders.` }
  }
  if (!restaurant.is_open && !opts.openedBy) {
    return { ok: false, status: 409, error: `${named(restaurant.name)} is closed right now.` }
  }

  if (opts.zoneId) {
    const zone = db
      .prepare('SELECT id FROM service_zones WHERE id = ? AND restaurant_id = ? AND is_active = 1')
      .get(opts.zoneId, opts.restaurantId)
    if (!zone) return { ok: false, status: 400, error: 'Pick where you are parked.' }
  }

  const vehicle = String(opts.vehicle ?? '').trim().slice(0, 60)
  if (!vehicle) return { ok: false, status: 400, error: 'Describe the car so we can find you.' }

  const next = db
    .prepare(
      `SELECT COALESCE(MAX(seq_no), 0) + 1 AS n FROM dining_sessions
        WHERE restaurant_id = ? AND service_mode = 'car' AND date(created_at) = date('now')`,
    )
    .get(opts.restaurantId) as any

  const token = randomToken(14)
  const seq = Number(next.n)
  const code = `C${String(seq).padStart(2, '0')}`
  db.prepare(
    `INSERT INTO dining_sessions
       (token, restaurant_id, table_id, table_label, access_code_id, source, user_id, expires_at,
        service_mode, zone_id, vehicle, vehicle_number, seq_no, code, opened_by, party_size)
     VALUES (?, ?, NULL, NULL, NULL, 'code', ?, datetime('now', '+${SESSION_HOURS} hours'),
        'car', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    token,
    opts.restaurantId,
    opts.userId,
    opts.zoneId,
    vehicle,
    String(opts.vehicleNumber ?? '').trim().slice(0, 20),
    seq,
    code,
    opts.openedBy ?? null,
    Math.max(1, Math.min(12, Number(opts.partySize) || 1)),
  )
  return { ok: true, session: db.prepare('SELECT * FROM dining_sessions WHERE token = ?').get(token) as any }
}

/** A car that moved keeps its session and its number; only the zone changes. */
export function moveSession(token: string, zoneId: number | null) {
  const row = sessionByToken(token)
  if (!row) return { ok: false as const, status: 404, error: 'That session has ended.' }
  if (zoneId) {
    const zone = db
      .prepare('SELECT id FROM service_zones WHERE id = ? AND restaurant_id = ?')
      .get(zoneId, row.restaurant_id)
    if (!zone) return { ok: false as const, status: 400, error: 'That zone is not on this restaurant.' }
  }
  db.prepare("UPDATE dining_sessions SET zone_id = ?, moved_at = datetime('now') WHERE id = ?").run(zoneId, row.id)
  return { ok: true as const, session: sessionByToken(token) }
}


/**
 * Opens a session for someone ordering to their own address.
 *
 * The area is chosen from the short list the restaurant actually delivers to,
 * rather than typed or worked out from coordinates: a small kitchen knows the
 * names of the two or three localities it will walk an order to, and an address
 * we cannot check is worse than a locality we can.
 */
export function startDeliverySession(opts: {
  restaurantId: number
  areaId: number
  address: string
  phone: string
  userId: number | null
}): { ok: true; session: any } | { ok: false; status: number; error: string } {
  const restaurant = db
    .prepare('SELECT id, name, is_open, accepts_delivery FROM restaurants WHERE id = ?')
    .get(opts.restaurantId) as any
  if (!restaurant) return { ok: false, status: 404, error: 'That restaurant no longer exists.' }
  if (!restaurant.accepts_delivery) {
    return { ok: false, status: 409, error: `${named(restaurant.name)} isn't delivering.` }
  }
  if (!restaurant.is_open) {
    return { ok: false, status: 409, error: `${named(restaurant.name)} is closed right now.` }
  }

  const area = db
    .prepare('SELECT * FROM delivery_areas WHERE id = ? AND restaurant_id = ? AND is_active = 1')
    .get(opts.areaId, opts.restaurantId) as any
  if (!area) {
    const open = db
      .prepare('SELECT name FROM delivery_areas WHERE restaurant_id = ? AND is_active = 1 ORDER BY sort_order')
      .all(opts.restaurantId) as any[]
    return {
      ok: false,
      status: 400,
      error: open.length
        ? `${named(restaurant.name)} only delivers to ${open.map((a) => a.name).join(', ')}.`
        : `${named(restaurant.name)} isn't delivering right now.`,
    }
  }

  const address = String(opts.address ?? '').trim().slice(0, 200)
  if (address.length < 8) {
    return { ok: false, status: 400, error: 'Add the flat or house and the building, so we can find you.' }
  }
  const phone = String(opts.phone ?? '').replace(/[^0-9+ ]/g, '').trim().slice(0, 20)
  if (phone.replace(/\D/g, '').length < 10) {
    return { ok: false, status: 400, error: 'Add a phone number in case the rider cannot find the place.' }
  }

  const token = randomToken(14)
  db.prepare(
    `INSERT INTO dining_sessions
       (token, restaurant_id, table_id, table_label, access_code_id, source, user_id, expires_at,
        service_mode, area_id, address, phone)
     VALUES (?, ?, NULL, NULL, NULL, 'code', ?, datetime('now', '+${SESSION_HOURS} hours'),
        'delivery', ?, ?, ?)`,
  ).run(token, opts.restaurantId, opts.userId, area.id, address, phone)
  return { ok: true, session: db.prepare('SELECT * FROM dining_sessions WHERE token = ?').get(token) as any }
}

/**
 * Opens a session for somebody standing in a precinct.
 *
 * Not at a table, not in a car, and without an address — the three things every
 * other way of ordering assumes. What they have instead is a landmark ("outside
 * Chai Sutta") and whatever makes them findable once the runner gets there
 * ("blue scooter, grey shirt"). That is enough, because the walk is two
 * minutes, which is the whole reason this works at all.
 */
export function startPrecinctSession(opts: {
  restaurantId: number
  spotId: number
  detail: string
  phone: string
  userId: number | null
}): { ok: true; session: any } | { ok: false; status: number; error: string } {
  const restaurant = db
    .prepare('SELECT id, name, is_open FROM restaurants WHERE id = ?')
    .get(opts.restaurantId) as any
  if (!restaurant) return { ok: false, status: 404, error: 'That restaurant no longer exists.' }
  if (!restaurant.is_open) {
    return { ok: false, status: 409, error: `${named(restaurant.name)} is closed right now.` }
  }

  const spot = db
    .prepare(
      `SELECT s.*, p.id AS precinct_id, p.name AS precinct_name, p.is_active AS precinct_active
         FROM precinct_spots s JOIN precincts p ON p.id = s.precinct_id
        WHERE s.id = ? AND s.is_active = 1`,
    )
    .get(opts.spotId) as any
  if (!spot || !spot.precinct_active) {
    return { ok: false, status: 400, error: 'Pick where you are from the list.' }
  }

  // A restaurant joins a precinct and can leave it again; one that has not
  // agreed to walk orders out must not be handed one.
  const serves = db
    .prepare('SELECT 1 FROM restaurant_precincts WHERE restaurant_id = ? AND precinct_id = ?')
    .get(opts.restaurantId, spot.precinct_id)
  if (!serves) {
    return {
      ok: false,
      status: 409,
      error: `${named(restaurant.name)} isn't bringing orders out into ${spot.precinct_name} right now.`,
    }
  }

  // Optional: the landmark alone is often enough, and demanding a description
  // of yourself before you can order is friction this exists to remove.
  const detail = String(opts.detail ?? '').trim().slice(0, 140)

  // The number is not optional. This is the one way of ordering where the
  // kitchen commits a member of staff to the street on the strength of it, and
  // the walk is wasted if they get there and cannot find anybody.
  const phone = String(opts.phone ?? '').replace(/[^0-9+ ]/g, '').trim().slice(0, 20)
  if (phone.replace(/\D/g, '').length < 10) {
    return { ok: false, status: 400, error: 'Add a phone number so they can ring you when they set off.' }
  }

  const token = randomToken(14)
  db.prepare(
    `INSERT INTO dining_sessions
       (token, restaurant_id, table_id, table_label, access_code_id, source, user_id, expires_at,
        service_mode, precinct_id, spot_id, address, phone)
     VALUES (?, ?, NULL, NULL, NULL, 'code', ?, datetime('now', '+${SESSION_HOURS} hours'),
        'precinct', ?, ?, ?, ?)`,
  ).run(token, opts.restaurantId, opts.userId, spot.precinct_id, spot.id, detail, phone)
  return { ok: true, session: db.prepare('SELECT * FROM dining_sessions WHERE token = ?').get(token) as any }
}
