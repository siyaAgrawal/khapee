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
