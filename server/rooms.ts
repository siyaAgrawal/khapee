import { db } from './db.ts'
import { randomToken } from './ids.ts'

/**
 * A room is the table's shared order. Every dine-in order opens one, so nobody
 * has to decide up front whether they are "ordering as a group" — friends can
 * join at any point and add their own food to the same ticket.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function newCode(): string {
  for (let attempt = 0; attempt < 60; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    if (!db.prepare('SELECT 1 FROM group_sessions WHERE code = ?').get(code)) return code
  }
  throw new Error('Could not generate a unique room code')
}

export function openRoomForOrder(opts: {
  orderId: number
  restaurantId: number
  tableId: number | null
  tableLabel: string | null
  hostName: string
  userId: number | null
}): { code: string; hostToken: string; sessionId: number } {
  const code = newCode()
  const info = db
    .prepare(
      `INSERT INTO group_sessions (code, restaurant_id, table_id, table_label, order_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(code, opts.restaurantId, opts.tableId, opts.tableLabel, opts.orderId)
  const sessionId = Number(info.lastInsertRowid)

  const hostToken = randomToken(12)
  db.prepare(
    `INSERT INTO group_members (session_id, user_id, display_name, token, is_host)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(sessionId, opts.userId, opts.hostName, hostToken)

  // Attribute what was already ordered to the person who opened the room.
  const member = db.prepare('SELECT id FROM group_members WHERE token = ?').get(hostToken) as any
  db.prepare('UPDATE order_items SET member_id = ? WHERE order_id = ? AND member_id IS NULL').run(
    member.id,
    opts.orderId,
  )
  db.prepare('UPDATE orders SET group_session_id = ? WHERE id = ?').run(sessionId, opts.orderId)

  return { code, hostToken, sessionId }
}

/** The room attached to an order, if it has one. */
export function roomForOrder(orderId: number) {
  return db.prepare('SELECT * FROM group_sessions WHERE order_id = ?').get(orderId) as any
}
