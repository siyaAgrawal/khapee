/**
 * The operational view of a restaurant: everyone who is here right now, inside
 * or parked on the road outside, and what state their food is in.
 *
 * This exists because the thing it replaces is a staff member's memory — "that
 * white car ordered two sandwiches, and the black one hasn't paid". Every query
 * here is written so one screen can answer: who is here, where, what did they
 * order, when, what state is it in, who is carrying it, have they paid.
 */
import { db } from './db.ts'
import { isTerminal, type OrderStatus, type ServiceMode } from '../shared/orders.ts'

export type OpsOrder = {
  id: number
  orderNumber: string
  status: OrderStatus
  serviceMode: ServiceMode
  totalCents: number
  paymentStatus: 'UNPAID' | 'PAID'
  paymentMethod: string
  createdAt: string
  ageMinutes: number
  items: { name: string; quantity: number; addedLater: boolean }[]
  runner: { id: number; name: string } | null
}

export type OpsSession = {
  id: number
  token: string
  code: string
  serviceMode: ServiceMode
  label: string
  vehicle: string
  vehicleNumber: string
  zoneId: number | null
  zoneName: string | null
  partySize: number
  openedByStaff: boolean
  createdAt: string
  waitingMinutes: number
  orders: OpsOrder[]
  /** No order yet — the loudest thing on the board, because nobody has been to them. */
  waitingToOrder: boolean
  dueCents: number
}

const MINUTE = 60_000

function minutesSince(iso: string): number {
  // SQLite writes naive UTC; tell Date so, or every age is off by the offset.
  const t = Date.parse(iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.round((Date.now() - t) / MINUTE))
}

/** Everything open at one restaurant, sessions first and orders hung off them. */
export function opsBoard(restaurantId: number) {
  const sessions = db
    .prepare(
      `SELECT s.*, z.name AS zone_name
         FROM dining_sessions s
         LEFT JOIN service_zones z ON z.id = s.zone_id
        WHERE s.restaurant_id = ? AND s.closed_at IS NULL
        ORDER BY s.created_at ASC`,
    )
    .all(restaurantId) as any[]

  const orderRows = db
    .prepare(
      `SELECT o.*, u.name AS runner_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.runner_id
        WHERE o.restaurant_id = ?
          AND o.created_at > datetime('now', '-1 day')
        ORDER BY o.created_at ASC`,
    )
    .all(restaurantId) as any[]

  const itemsFor = db.prepare(
    'SELECT name, quantity, added_by_staff FROM order_items WHERE order_id = ? ORDER BY id',
  )

  const shapeOrder = (o: any): OpsOrder => ({
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    serviceMode: (o.service_mode ?? 'dine_in') as ServiceMode,
    totalCents: o.total_cents,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    createdAt: o.created_at,
    ageMinutes: minutesSince(o.created_at),
    items: (itemsFor.all(o.id) as any[]).map((i) => ({
      name: i.name,
      quantity: i.quantity,
      addedLater: !!i.added_by_staff,
    })),
    runner: o.runner_id ? { id: o.runner_id, name: o.runner_name ?? 'Runner' } : null,
  })

  const bySession = new Map<number, any[]>()
  const loose: any[] = []
  for (const o of orderRows) {
    if (isTerminal((o.service_mode ?? 'dine_in') as any, o.status) && o.payment_status === 'PAID') continue
    if (o.dining_session_id) {
      const list = bySession.get(o.dining_session_id) ?? []
      list.push(o)
      bySession.set(o.dining_session_id, list)
    } else {
      loose.push(o)
    }
  }

  const shaped: OpsSession[] = sessions.map((s) => {
    const orders = (bySession.get(s.id) ?? []).map(shapeOrder)
    const mode = (s.service_mode ?? 'dine_in') as ServiceMode
    return {
      id: s.id,
      token: s.token,
      code: s.code || '',
      serviceMode: mode,
      label: mode === 'car' ? `Car ${s.seq_no ?? s.id}` : s.table_label || 'Table',
      vehicle: s.vehicle || '',
      vehicleNumber: s.vehicle_number || '',
      zoneId: s.zone_id,
      zoneName: s.zone_name ?? null,
      partySize: s.party_size ?? 1,
      openedByStaff: !!s.opened_by,
      createdAt: s.created_at,
      waitingMinutes: minutesSince(s.created_at),
      orders,
      waitingToOrder: orders.length === 0,
      dueCents: orders
        .filter((o) => o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED')
        .reduce((n, o) => n + o.totalCents, 0),
    }
  })

  // An order with no session still has to appear — a counter or pickup order,
  // or one whose session was closed underneath it.
  const unattached = loose.map(shapeOrder)

  const zones = db
    .prepare('SELECT * FROM service_zones WHERE restaurant_id = ? ORDER BY sort_order, id')
    .all(restaurantId) as any[]

  return {
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      note: z.note,
      token: z.token,
      isActive: !!z.is_active,
    })),
    sessions: shaped,
    unattached,
    summary: {
      inside: shaped.filter((s) => s.serviceMode === 'dine_in').length,
      cars: shaped.filter((s) => s.serviceMode === 'car').length,
      waitingToOrder: shaped.filter((s) => s.waitingToOrder).length,
      preparing: shaped.flatMap((s) => s.orders).filter((o) => o.status === 'PREPARING').length,
      ready: shaped
        .flatMap((s) => s.orders)
        .filter((o) => o.status === 'READY' || o.status === 'READY_FOR_PICKUP').length,
      paymentPending: shaped.filter((s) => s.dueCents > 0).length,
      dueCents: shaped.reduce((n, s) => n + s.dueCents, 0),
    },
  }
}

/**
 * What a runner carries out next. Grouped by zone, because the walk is the
 * expensive part — three ready orders in one zone is one trip, not three.
 */
export function runQueue(restaurantId: number) {
  const rows = db
    .prepare(
      `SELECT o.*, s.seq_no, s.vehicle, s.vehicle_number, s.table_label, s.service_mode AS session_mode,
              z.name AS zone_name, z.id AS zone_id, u.name AS runner_name
         FROM orders o
         LEFT JOIN dining_sessions s ON s.id = o.dining_session_id
         LEFT JOIN service_zones z ON z.id = COALESCE(o.zone_id, s.zone_id)
         LEFT JOIN users u ON u.id = o.runner_id
        WHERE o.restaurant_id = ?
          AND o.status IN ('READY', 'DELIVERING')
        ORDER BY o.created_at ASC`,
    )
    .all(restaurantId) as any[]

  const groups = new Map<string, any>()
  for (const o of rows) {
    const key = o.zone_name ?? (o.session_mode === 'car' ? 'Unzoned' : 'Inside')
    const g = groups.get(key) ?? { zone: key, zoneId: o.zone_id ?? null, drops: [] }
    g.drops.push({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      label:
        o.session_mode === 'car'
          ? `Car ${o.seq_no ?? ''}`.trim()
          : o.table_label || (o.service_mode === 'dine_in' ? 'Table' : 'Counter'),
      vehicle: o.vehicle || '',
      vehicleNumber: o.vehicle_number || '',
      ageMinutes: minutesSince(o.created_at),
      totalCents: o.total_cents,
      paymentStatus: o.payment_status,
      runner: o.runner_id ? { id: o.runner_id, name: o.runner_name ?? 'Runner' } : null,
      items: (
        db.prepare('SELECT name, quantity FROM order_items WHERE order_id = ? ORDER BY id').all(o.id) as any[]
      ).map((i) => `${i.quantity}× ${i.name}`),
    })
    groups.set(key, g)
  }

  return [...groups.values()].sort((a, b) => b.drops.length - a.drops.length)
}
