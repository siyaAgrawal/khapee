import { db } from './db.ts'
import { normalizeCode, randomToken } from './ids.ts'
import { checkAccessCode } from './orders-service.ts'

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
    serviceMode: (row.service_mode ?? 'dine_in') as 'dine_in' | 'car' | 'takeaway' | 'pickup',
    zoneId: row.zone_id ?? null,
    zoneName: row.zone_id
      ? ((db.prepare('SELECT name FROM service_zones WHERE id = ?').get(row.zone_id) as any)?.name ?? null)
      : null,
    vehicle: row.vehicle ?? '',
    vehicleNumber: row.vehicle_number ?? '',
    seqNo: row.seq_no ?? null,
    code: row.code ?? '',
    label: (row.service_mode ?? 'dine_in') === 'car' ? `Car ${row.seq_no ?? ''}`.trim() : row.table_label ?? null,
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

  if (upper.includes('ORDRO:TABLE:') || upper.includes('TABLO:TABLE:')) tableToken = raw.split(/(?:ORDRO|TABLO):TABLE:/i)[1]?.split(/[^A-Za-z0-9]/)[0] ?? null
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
  if (upper.includes('ORDRO:ACCESS:') || upper.includes('TABLO:ACCESS:')) code = (raw.split(/(?:ORDRO|TABLO):ACCESS:/i)[1] ?? '').split(':').pop() ?? ''
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
