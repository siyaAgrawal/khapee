import { db } from './db.ts'
import { generateOrderNumber, randomToken } from './ids.ts'
import { publish } from './events.ts'
import { money, type OrderStatus, type OrderType, type ServiceType } from '../shared/orders.ts'
import { sessionByToken, sessionIsValid, startPaidSession } from './dining.ts'
import { openRoomForOrder } from './rooms.ts'

export type CodeCheck =
  | { ok: true; row: any }
  | { ok: false; reason: 'not_found' | 'wrong_restaurant' | 'expired' | 'used' | 'revoked'; message: string }

export function checkAccessCode(code: string, restaurantId: number): CodeCheck {
  const row = db.prepare('SELECT * FROM access_codes WHERE code = ?').get(code) as any
  if (!row) {
    return { ok: false, reason: 'not_found', message: "That code isn't valid. Ask a staff member for a new one." }
  }
  if (row.restaurant_id !== restaurantId) {
    return {
      ok: false,
      reason: 'wrong_restaurant',
      message: 'That code belongs to a different restaurant.',
    }
  }
  if (row.revoked_at) {
    return { ok: false, reason: 'revoked', message: 'That code was cancelled by staff.' }
  }
  const expired = db
    .prepare(`SELECT (expires_at <= datetime('now')) AS expired FROM access_codes WHERE id = ?`)
    .get(row.id) as any
  if (expired?.expired) {
    return { ok: false, reason: 'expired', message: 'That code has expired. Ask staff to generate a new one.' }
  }
  if (row.single_use && row.used_at) {
    return { ok: false, reason: 'used', message: 'That code has already been used. Ask staff for a fresh code.' }
  }
  return { ok: true, row }
}

export type CartLine = { menuItemId: number; quantity: number }

export type CreateOrderInput = {
  restaurantId: number
  type: OrderType
  items: CartLine[]
  customerName: string
  userId: number | null
  note?: string
  paymentMethod?: 'counter' | 'app'
  accessCode?: string | null
  tableToken?: string | null
  tableId?: number | null
  /** Ordered at the restaurant but carried out — no table needed. */
  takeaway?: boolean
  /** An open dining session stands in for the code or table QR. */
  sessionToken?: string | null
  /** What the customer says they have already sent over UPI. */
  paymentClaim?: { amountCents?: number; upiRef?: string; method?: string } | null
}

export type CreateOrderResult = { ok: true; order: any } | { ok: false; status: number; error: string }

export function createOrder(input: CreateOrderInput): CreateOrderResult {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(input.restaurantId) as any
  if (!restaurant) return { ok: false, status: 404, error: 'That restaurant no longer exists.' }
  if (!restaurant.is_open) {
    return { ok: false, status: 409, error: `${restaurant.name} is closed right now and isn't taking orders.` }
  }

  const lines = (input.items ?? []).filter((l) => Number(l?.quantity) > 0)
  if (!lines.length) return { ok: false, status: 400, error: 'Your cart is empty.' }

  const customerName = String(input.customerName ?? '').trim()
  if (customerName.length < 2) return { ok: false, status: 400, error: 'Please enter a name for the order.' }

  if (input.type === 'pickup' && !restaurant.accepts_pickup) {
    return { ok: false, status: 409, error: `${restaurant.name} is not taking pickup orders right now.` }
  }
  const takeaway = input.type === 'dine_in' && !!input.takeaway
  if (takeaway && !restaurant.accepts_takeaway) {
    return { ok: false, status: 409, error: `${restaurant.name} is not doing takeaway right now.` }
  }

  // --- Resolve where the food is going -------------------------------------
  let tableId: number | null = null
  let tableLabel: string | null = null
  let accessCodeId: number | null = null
  /** The open session this order belongs to, once one has been proven valid. */
  let liveSession: any = null

  if (input.type === 'dine_in') {
    const code = (input.accessCode ?? '').trim().toUpperCase()
    const tableToken = (input.tableToken ?? '').trim().toLowerCase()

    // An open dining session already carries the proof, and so does paying
    // through the app — either way no code is needed at this point.
    const session = input.sessionToken ? sessionByToken(input.sessionToken) : null
    const hasSession = !!session && sessionIsValid(session, input.restaurantId)
    if (input.sessionToken && !hasSession) {
      return { ok: false, status: 400, error: 'That session has ended. Scan or enter the code again.' }
    }
    const paidUpFront = !!input.paymentClaim

    if (hasSession && session.table_id) {
      tableId = session.table_id
      tableLabel = session.table_label
    }
    if (session?.access_code_id) accessCodeId = session.access_code_id
    if (hasSession) liveSession = session

    if (!code && !tableToken && !hasSession && !paidUpFront) {
      return {
        ok: false,
        status: 400,
        error: takeaway
          ? 'Enter the restaurant access code, or pay through the app, to order for takeaway.'
          : 'Scan the table QR, enter the access code, or pay through the app to order at the table.',
      }
    }

    if (code) {
      const check = checkAccessCode(code, input.restaurantId)
      if (!check.ok) return { ok: false, status: 400, error: check.message }
      accessCodeId = check.row.id
    }

    if (tableToken) {
      const table = db
        .prepare('SELECT * FROM restaurant_tables WHERE token = ?')
        .get(tableToken) as any
      if (!table) return { ok: false, status: 400, error: "That table QR isn't recognised." }
      if (table.restaurant_id !== input.restaurantId) {
        return { ok: false, status: 400, error: 'That table belongs to a different restaurant.' }
      }
      tableId = table.id
      tableLabel = table.label
    }

    if (input.tableId) {
      const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(input.tableId) as any
      if (!table || table.restaurant_id !== input.restaurantId) {
        return { ok: false, status: 400, error: 'Pick a table from the list to continue.' }
      }
      tableId = table.id
      tableLabel = table.label
    }

    if (takeaway || liveSession?.service_mode === 'car' || liveSession?.service_mode === 'delivery') {
      // A car has no table number and a delivery has an address instead, and
      // asking for one is exactly the friction these modes exist to remove.
      tableId = null
      tableLabel = null
    } else if (!tableId) {
      return { ok: false, status: 400, error: 'Please choose your table number.' }
    }
  }

  // --- Price the cart from the database, never from the client -------------
  const priced: { item: any; quantity: number }[] = []
  for (const line of lines) {
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(line.menuItemId)) as any
    if (!item || item.restaurant_id !== input.restaurantId) {
      return { ok: false, status: 400, error: 'One of the items is no longer on this menu.' }
    }
    if (!item.is_available) {
      return { ok: false, status: 409, error: `${item.name} just sold out. Remove it to continue.` }
    }
    const quantity = Math.min(50, Math.max(1, Math.floor(Number(line.quantity))))
    priced.push({ item, quantity })
  }
  const totalCents = priced.reduce((sum, l) => sum + l.item.price_cents * l.quantity, 0)

  const orderNumber = generateOrderNumber()
  const verifyToken = randomToken(10)
  const paymentMethod = input.paymentMethod === 'app' ? 'app' : 'counter'

  const run = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO orders
          (order_number, restaurant_id, user_id, customer_name, order_type, table_id, table_label,
           status, payment_status, payment_method, total_cents, note, verify_token, access_code_id, takeaway,
           service_mode, zone_id, dining_session_id, delivery_area_id, delivery_address, delivery_phone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orderNumber,
        input.restaurantId,
        input.userId,
        customerName,
        input.type,
        tableId,
        tableLabel,
        // Delivery waits to be accepted; everything else is already happening.
        liveSession?.service_mode === 'delivery' ? 'REQUESTED' : 'NEW',
        paymentMethod,
        totalCents,
        String(input.note ?? '').slice(0, 300),
        verifyToken,
        accessCodeId,
        takeaway ? 1 : 0,
        // Where the customer is decides how the order ends: a car has to be
        // walked out to, a table does not. Recorded on the order so the board
        // never has to work it out from a join.
        liveSession?.service_mode === 'car'
          ? 'car'
          : liveSession?.service_mode === 'delivery'
            ? 'delivery'
            : takeaway
            ? 'takeaway'
            : input.type === 'dine_in'
              ? 'dine_in'
              : 'pickup',
        liveSession?.zone_id ?? null,
        liveSession?.id ?? null,
        liveSession?.service_mode === 'delivery' ? (liveSession.area_id ?? null) : null,
        liveSession?.service_mode === 'delivery' ? (liveSession.address ?? '') : '',
        liveSession?.service_mode === 'delivery' ? (liveSession.phone ?? '') : '',
      )
    const orderId = Number(info.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, emoji, unit_price_cents, quantity)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const l of priced) {
      insertItem.run(orderId, l.item.id, l.item.name, l.item.emoji, l.item.price_cents, l.quantity)
    }

    db.prepare(`INSERT INTO order_events (order_id, status, actor) VALUES (?, 'NEW', 'customer')`).run(orderId)

    if (input.paymentClaim) {
      const claimed = Math.max(0, Math.round(Number(input.paymentClaim.amountCents) || totalCents))
      db.prepare(
        `INSERT INTO payments (order_id, payer_name, amount_cents, method, status, upi_ref, covers)
         VALUES (?, ?, ?, ?, 'CLAIMED', ?, 'all')`,
      ).run(
        orderId,
        customerName,
        Math.min(claimed, totalCents),
        String(input.paymentClaim.method ?? 'upi'),
        String(input.paymentClaim.upiRef ?? '').trim().slice(0, 40),
      )
    }

    if (accessCodeId) {
      db.prepare(
        `UPDATE access_codes SET used_at = datetime('now'), used_by_order = ?
         WHERE id = ? AND used_at IS NULL`,
      ).run(orderId, accessCodeId)
    }

    const where =
      input.type === 'pickup' ? 'Pickup order' : `Table ${String(tableLabel).replace(/^Table\s*/i, '')}`
    db.prepare(
      `INSERT INTO notifications (restaurant_id, order_id, title, body)
       VALUES (?, ?, ?, ?)`,
    ).run(
      input.restaurantId,
      orderId,
      `New order #${orderNumber}`,
      `${where} · ${customerName} · ${money(totalCents)}`,
    )

    return orderId
  })

  const orderId = run()
  const order: any = getOrder(orderId)

  // Every dine-in order is a room the rest of the table can join — no separate
  // "start a group" step, it is simply how ordering works.
  if (input.type === 'dine_in' && !takeaway && tableId) {
    const room = openRoomForOrder({
      orderId,
      restaurantId: input.restaurantId,
      tableId,
      tableLabel,
      hostName: customerName,
      userId: input.userId,
    })
    order.roomCode = room.code
    order.groupToken = room.hostToken
  }

  // Paying up front opens the session, so the next round needs no code.
  if (input.type === 'dine_in' && input.paymentClaim && !input.sessionToken) {
    const opened = startPaidSession({
      restaurantId: input.restaurantId,
      tableId,
      tableLabel,
      userId: input.userId,
    })
    order.sessionToken = opened.token
  }
  publish('order:new', { restaurantId: input.restaurantId, userId: input.userId, orderId, order })
  return { ok: true, order }
}

export function getOrder(orderId: number) {
  const row = db
    .prepare(
      `SELECT o.*, r.name AS restaurant_name, r.slug AS restaurant_slug, r.emoji AS restaurant_emoji,
              r.hue AS restaurant_hue, r.prep_minutes
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id WHERE o.id = ?`,
    )
    .get(orderId) as any
  if (!row) return null
  return shapeOrder(row)
}

export function shapeOrder(row: any) {
  const items = db
    .prepare(
      `SELECT i.id, i.name, i.emoji, i.unit_price_cents, i.quantity, i.paid_at, i.member_id,
              i.added_by_staff, m.display_name AS member_name
       FROM order_items i LEFT JOIN group_members m ON m.id = i.member_id
       WHERE i.order_id = ? ORDER BY i.id`,
    )
    .all(row.id) as any[]
  const payments = db
    .prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id')
    .all(row.id) as any[]
  const events = db
    .prepare('SELECT status, actor, created_at FROM order_events WHERE order_id = ? ORDER BY id')
    .all(row.id) as any[]
  return {
    id: row.id,
    orderNumber: row.order_number,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    restaurantEmoji: row.restaurant_emoji,
    restaurantHue: row.restaurant_hue,
    prepMinutes: row.prep_minutes,
    customerName: row.customer_name,
    type: row.order_type as OrderType,
    serviceType: (row.service_mode === 'car'
      ? 'car'
      : row.service_mode === 'delivery'
        ? 'delivery'
        : row.order_type === 'pickup'
        ? 'pickup'
        : row.takeaway
          ? 'takeaway'
          : 'dine_in') as ServiceType,
    serviceMode: (row.service_mode ?? 'dine_in') as ServiceType,
    deliveryAddress: row.delivery_address ?? '',
    deliveryPhone: row.delivery_phone ?? '',
    deliveryArea: row.delivery_area_id
      ? ((db.prepare('SELECT name FROM delivery_areas WHERE id = ?').get(row.delivery_area_id) as any)?.name ?? null)
      : null,
    declinedReason: row.declined_reason ?? '',
    zoneName: row.zone_id
      ? ((db.prepare('SELECT name FROM service_zones WHERE id = ?').get(row.zone_id) as any)?.name ?? null)
      : null,
    takeaway: !!row.takeaway,
    isGroup: !!row.group_session_id,
    groupSessionId: row.group_session_id ?? null,
    tableLabel: row.table_label,
    status: row.status as OrderStatus,
    paymentStatus: row.payment_status as 'UNPAID' | 'PAID',
    paymentMethod: row.payment_method,
    totalCents: row.total_cents,
    note: row.note,
    verifyToken: row.verify_token,
    verifiedAt: row.verified_at,
    roomCode: row.group_session_id
      ? ((db.prepare('SELECT code FROM group_sessions WHERE id = ?').get(row.group_session_id) as any)?.code ?? null)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      emoji: i.emoji,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
      memberId: i.member_id ?? null,
      memberName: i.member_name ?? null,
      addedByStaff: !!i.added_by_staff,
      paid: !!i.paid_at,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      payerName: p.payer_name,
      amountCents: p.amount_cents,
      method: p.method,
      status: p.status,
      upiRef: p.upi_ref,
      createdAt: p.created_at,
    })),
    claimedCents: payments.filter((p) => p.status === 'CLAIMED').reduce((n, p) => n + p.amount_cents, 0),
    confirmedCents: payments.filter((p) => p.status === 'CONFIRMED').reduce((n, p) => n + p.amount_cents, 0),
    events: events.map((e) => ({ status: e.status, actor: e.actor, at: e.created_at })),
  }
}
