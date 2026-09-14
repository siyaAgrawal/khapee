import { db } from './db.ts'
import { generateOrderNumber, normalizeCode, randomToken } from './ids.ts'
import { checkAccessCode } from './orders-service.ts'
import { paidCents, claimedCents } from './payments.ts'
import { isTerminal, type OrderStatus } from '../shared/orders.ts'
import { sessionByToken as diningByToken, sessionIsValid as diningIsValid } from './dining.ts'

const GROUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function groupCode(): string {
  for (let attempt = 0; attempt < 60; attempt++) {
    let code = 'G'
    for (let i = 0; i < 4; i++) code += GROUP_ALPHABET[Math.floor(Math.random() * GROUP_ALPHABET.length)]
    if (!db.prepare('SELECT 1 FROM group_sessions WHERE code = ?').get(code)) return code
  }
  throw new Error('Could not generate a unique group code')
}

export type MemberContext = { session: any; member: any }

export function memberByToken(token: string | undefined): MemberContext | null {
  if (!token) return null
  const member = db.prepare('SELECT * FROM group_members WHERE token = ?').get(token) as any
  if (!member) return null
  const session = db.prepare('SELECT * FROM group_sessions WHERE id = ?').get(member.session_id) as any
  if (!session) return null
  return { session, member }
}

export type CreateResult = { ok: true; session: any; member: any } | { ok: false; status: number; error: string }

export function createSession(input: {
  restaurantId: number
  hostName: string
  userId: number | null
  tableId?: number | null
  tableToken?: string | null
  accessCode?: string | null
  sessionToken?: string | null
  /** Ordering ahead: a room with no table, needing no presence proof. */
  ahead?: boolean
}): CreateResult {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(input.restaurantId) as any
  if (!restaurant) return { ok: false, status: 404, error: 'That restaurant no longer exists.' }
  if (!restaurant.accepts_groups) {
    return { ok: false, status: 409, error: `${restaurant.name} is not taking group orders right now.` }
  }
  if (!restaurant.is_open) {
    return { ok: false, status: 409, error: `${restaurant.name} is closed right now.` }
  }
  const hostName = String(input.hostName ?? '').trim()
  if (hostName.length < 2) return { ok: false, status: 400, error: 'Please enter your name to start the group.' }

  // Same presence proof as a normal dine-in order: a table QR or a staff code.
  let tableId: number | null = null
  let tableLabel: string | null = null

  if (input.tableToken) {
    const table = db.prepare('SELECT * FROM restaurant_tables WHERE token = ?').get(input.tableToken) as any
    if (!table || table.restaurant_id !== input.restaurantId) {
      return { ok: false, status: 400, error: "That table QR isn't recognised." }
    }
    tableId = table.id
    tableLabel = table.label
  }
  if (input.accessCode) {
    const check = checkAccessCode(normalizeCode(input.accessCode), input.restaurantId)
    if (!check.ok) return { ok: false, status: 400, error: check.message }
    db.prepare(`UPDATE access_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`).run(check.row.id)
  }
  // An open dining session is proof enough to start a group.
  const dining = input.sessionToken ? diningByToken(input.sessionToken) : null
  const hasDining = !!dining && diningIsValid(dining, input.restaurantId)

  // A room is a table's shared ticket: the kitchen sends it to that table.
  // Someone sitting outside in their car, or waiting at an address, has no
  // table for it to go to, and asking them for a table number — which is where
  // this used to end up — is a question with no answer.
  if (hasDining && (dining.service_mode === 'car' || dining.service_mode === 'delivery')) {
    return {
      ok: false,
      status: 409,
      error:
        dining.service_mode === 'car'
          ? 'A shared table order needs a table. Order for the car instead, and they will bring it out.'
          : 'A shared table order needs a table. Order for delivery instead.',
    }
  }
  if (hasDining && dining.table_id && !tableId) {
    tableId = dining.table_id
    tableLabel = dining.table_label
  }
  // A room opened from a cart before anyone has arrived is the group version of
  // ordering ahead, so it asks for no more proof than a solo ahead order does.
  if (input.ahead && !input.tableToken && !input.accessCode && !hasDining) {
    if (!restaurant.accepts_pickup) {
      return { ok: false, status: 409, error: `${restaurant.name} only takes orders at the table.` }
    }
    return finishSession(input, null, null)
  }
  if (!input.tableToken && !input.accessCode && !hasDining) {
    return {
      ok: false,
      status: 400,
      error: 'Scan the table QR or enter the restaurant access code to start a group.',
    }
  }
  if (input.tableId) {
    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(input.tableId) as any
    if (!table || table.restaurant_id !== input.restaurantId) {
      return { ok: false, status: 400, error: 'Pick a table from the list to continue.' }
    }
    tableId = table.id
    tableLabel = table.label
  }
  if (!tableId) return { ok: false, status: 400, error: 'Please choose your table number.' }

  return finishSession(input, tableId, tableLabel)
}

/** Writes the room and seats whoever opened it as the host. */
function finishSession(
  input: { restaurantId: number; hostName: string; userId: number | null },
  tableId: number | null,
  tableLabel: string | null,
): CreateResult {
  const result = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO group_sessions (code, restaurant_id, table_id, table_label) VALUES (?, ?, ?, ?)`,
      )
      .run(groupCode(), input.restaurantId, tableId, tableLabel)
    const sessionId = Number(info.lastInsertRowid)
    const memberInfo = db
      .prepare(
        `INSERT INTO group_members (session_id, user_id, display_name, token, is_host) VALUES (?, ?, ?, ?, 1)`,
      )
      .run(sessionId, input.userId, String(input.hostName).trim(), randomToken(12))
    return { sessionId, memberId: Number(memberInfo.lastInsertRowid) }
  })()

  return {
    ok: true,
    session: db.prepare('SELECT * FROM group_sessions WHERE id = ?').get(result.sessionId),
    member: db.prepare('SELECT * FROM group_members WHERE id = ?').get(result.memberId),
  }
}

export function joinSession(code: string, displayName: string, userId: number | null): CreateResult {
  const session = db
    .prepare('SELECT * FROM group_sessions WHERE code = ?')
    .get(normalizeCode(code)) as any
  if (!session) return { ok: false, status: 404, error: "That group code isn't valid." }
  if (session.status === 'CLOSED') return { ok: false, status: 409, error: 'That group session has already closed.' }

  const name = String(displayName ?? '').trim()
  if (name.length < 2) return { ok: false, status: 400, error: 'Please enter your name to join.' }

  // Rejoining with the same name (and account) reuses the existing seat.
  if (userId) {
    const existing = db
      .prepare('SELECT * FROM group_members WHERE session_id = ? AND user_id = ?')
      .get(session.id, userId) as any
    if (existing) return { ok: true, session, member: existing }
  }

  const info = db
    .prepare('INSERT INTO group_members (session_id, user_id, display_name, token, is_host) VALUES (?, ?, ?, ?, 0)')
    .run(session.id, userId, name, randomToken(12))
  return { ok: true, session, member: db.prepare('SELECT * FROM group_members WHERE id = ?').get(Number(info.lastInsertRowid)) }
}

/** The live order for a session, creating a fresh ticket if the last one is done. */
export function ensureSessionOrder(session: any, customerName: string): any {
  if (session.order_id) {
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(session.order_id) as any
    if (existing && !isTerminal('dine_in', existing.status as OrderStatus)) return existing
  }
  const info = db
    .prepare(
      `INSERT INTO orders
        (order_number, restaurant_id, user_id, customer_name, order_type, table_id, table_label,
         status, payment_status, payment_method, total_cents, note, verify_token, group_session_id)
       VALUES (?, ?, NULL, ?, 'dine_in', ?, ?, 'NEW', 'UNPAID', 'app', 0, '', ?, ?)`,
    )
    .run(
      generateOrderNumber(),
      session.restaurant_id,
      customerName,
      session.table_id,
      session.table_label,
      randomToken(10),
      session.id,
    )
  const orderId = Number(info.lastInsertRowid)
  db.prepare(`INSERT INTO order_events (order_id, status, actor) VALUES (?, 'NEW', 'customer')`).run(orderId)
  db.prepare('UPDATE group_sessions SET order_id = ? WHERE id = ?').run(orderId, session.id)
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
}

export function recalcOrderTotal(orderId: number) {
  const row = db
    .prepare('SELECT COALESCE(SUM(unit_price_cents * quantity), 0) AS n FROM order_items WHERE order_id = ?')
    .get(orderId) as any
  db.prepare(`UPDATE orders SET total_cents = ?, updated_at = datetime('now') WHERE id = ?`).run(row.n, orderId)
}

/** Full session state: who is here, who ordered what, and what is still owed. */
export function shapeSession(sessionId: number) {
  const session = db
    .prepare(
      `SELECT s.*, r.name AS restaurant_name, r.emoji AS restaurant_emoji, r.hue AS restaurant_hue,
              r.upi_vpa, r.upi_name
       FROM group_sessions s JOIN restaurants r ON r.id = s.restaurant_id WHERE s.id = ?`,
    )
    .get(sessionId) as any
  if (!session) return null

  const members = db
    .prepare('SELECT id, display_name, is_host, joined_at FROM group_members WHERE session_id = ? ORDER BY id')
    .all(sessionId) as any[]

  const order = session.order_id
    ? (db.prepare('SELECT * FROM orders WHERE id = ?').get(session.order_id) as any)
    : null

  const items = order
    ? (db
        .prepare(
          `SELECT i.*, m.display_name AS member_name
           FROM order_items i LEFT JOIN group_members m ON m.id = i.member_id
           WHERE i.order_id = ? ORDER BY i.id`,
        )
        .all(order.id) as any[])
    : []

  const byMember = members.map((m) => {
    const mine = items.filter((i) => i.member_id === m.id)
    const total = mine.reduce((n, i) => n + i.unit_price_cents * i.quantity, 0)
    const unpaid = mine.filter((i) => !i.paid_at).reduce((n, i) => n + i.unit_price_cents * i.quantity, 0)
    return {
      id: m.id,
      name: m.display_name,
      isHost: !!m.is_host,
      totalCents: total,
      unpaidCents: unpaid,
      paid: total > 0 && unpaid === 0,
      items: mine.map((i) => ({
        id: i.id,
        name: i.name,
        emoji: i.emoji,
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
        paid: !!i.paid_at,
      })),
    }
  })

  const totalCents = order?.total_cents ?? 0
  const paid = order ? paidCents(order.id) : 0
  const claimed = order ? claimedCents(order.id) : 0

  return {
    id: session.id,
    code: session.code,
    status: session.status as 'OPEN' | 'CLOSED',
    restaurantId: session.restaurant_id,
    restaurantName: session.restaurant_name,
    restaurantEmoji: session.restaurant_emoji,
    restaurantHue: session.restaurant_hue,
    tableLabel: session.table_label,
    acceptsUpi: !!String(session.upi_vpa ?? '').trim(),
    createdAt: session.created_at,
    closedAt: session.closed_at,
    order: order
      ? {
          id: order.id,
          orderNumber: order.order_number,
          status: order.status as OrderStatus,
          paymentStatus: order.payment_status,
          verifyToken: order.verify_token,
          createdAt: order.created_at,
        }
      : null,
    members: byMember,
    totalCents,
    paidCents: paid,
    claimedCents: claimed,
    remainingCents: Math.max(0, totalCents - paid),
  }
}

export function sessionPreview(code: string) {
  const row = db
    .prepare(
      `SELECT s.code, s.status, s.table_label, r.name AS restaurant_name, r.id AS restaurant_id,
              (SELECT COUNT(*) FROM group_members m WHERE m.session_id = s.id) AS member_count
       FROM group_sessions s JOIN restaurants r ON r.id = s.restaurant_id WHERE s.code = ?`,
    )
    .get(normalizeCode(code)) as any
  if (!row) return null
  return {
    code: row.code,
    status: row.status,
    tableLabel: row.table_label,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    memberCount: row.member_count,
  }
}
