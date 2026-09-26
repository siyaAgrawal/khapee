/**
 * The floor: tables, the rounds sent to the kitchen, and the bill at the end.
 *
 * A restaurant does not think in orders. It thinks in tables, and a table is a
 * couple of hours long: drinks, then starters, then somebody's friend arrives
 * and orders again, and at the end one person asks for the bill. Khapee could
 * only see each of those as a separate order on a board — which is true, and
 * useless to the person holding the pad, who has to add four cards together in
 * their head to answer "how much for table six".
 *
 * So there are two documents and they are not the same document. A KOT is one
 * round, printed once, for the range: what to cook now, no prices. The bill is
 * the whole table added up, printed at the end, for the customer. The mistake
 * that makes an evening go wrong is printing either one twice, which is why a
 * round is recorded when it is sent rather than worked out again afterwards.
 */
import { db } from './db.js'
import { paidCents, claimedCents } from './payments.js'
import { type Actor, finaliseInvoice, paidOnInvoice, takePayment } from './billing.js'

/** Anything still being eaten: not cancelled, not billed, not closed. */
const OPEN_SQL = `
  o.status NOT IN ('CANCELLED', 'DECLINED')
  AND o.invoice_id IS NULL
  AND o.bill_closed_at IS NULL
`

export type KotDoc = {
  id: number
  seqNo: number
  createdAt: string
  printedAt: string | null
  items: { name: string; quantity: number }[]
}

function kotsForOrder(orderId: number): KotDoc[] {
  const kots = db
    .prepare('SELECT * FROM kots WHERE order_id = ? ORDER BY seq_no')
    .all(orderId) as any[]
  const items = db
    .prepare(
      `SELECT ki.* FROM kot_items ki
         JOIN kots k ON k.id = ki.kot_id
        WHERE k.order_id = ?`,
    )
    .all(orderId) as any[]
  return kots.map((k) => ({
    id: k.id,
    seqNo: k.seq_no,
    createdAt: k.created_at,
    printedAt: k.printed_at,
    items: items.filter((i) => i.kot_id === k.id).map((i) => ({ name: i.name, quantity: i.quantity })),
  }))
}

function orderCard(o: any) {
  const items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
    .all(o.id) as any[]
  return {
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    serviceMode: o.service_mode ?? 'dine_in',
    customerName: o.customer_name,
    customerPhone: o.contact_phone ?? '',
    note: o.note ?? '',
    createdAt: o.created_at,
    totalCents: o.total_cents,
    paymentStatus: o.payment_status,
    /** Raised here rather than by a customer — no yes is owed to anybody. */
    placedByStaff: o.payment_method === 'counter' && !o.user_id && o.service_mode === 'counter',
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      accepted: i.accepted === null ? null : !!i.accepted,
      /** Null means the kitchen has not been told about this one yet. */
      kotId: i.kot_id ?? null,
    })),
    kots: kotsForOrder(o.id),
  }
}

export type FloorBoard = ReturnType<typeof floorBoard>

/**
 * Every table, and what is happening at it.
 *
 * Tables with nothing on them are included and say so. An empty table is not
 * noise on this screen — it is the answer to "where can I put these four
 * people", which is asked far more often than anything else here.
 */
export function floorBoard(restaurantId: number) {
  const tables = db
    .prepare('SELECT * FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id')
    .all(restaurantId) as any[]

  const open = db
    .prepare(`SELECT * FROM orders o WHERE o.restaurant_id = ? AND ${OPEN_SQL} ORDER BY o.created_at`)
    .all(restaurantId) as any[]

  const cardsFor = (rows: any[]) => {
    const orders = rows.map(orderCard)
    const totalCents = orders.reduce((n, o) => n + o.totalCents, 0)
    const paid = rows.reduce((n, o) => n + paidCents(o.id), 0)
    return {
      orders,
      totalCents,
      paidCents: paid,
      claimedCents: rows.reduce((n, o) => n + claimedCents(o.id), 0),
      dueCents: Math.max(0, totalCents - paid),
      /** Orders the kitchen has not answered yet — the reason to look here. */
      waiting: orders.filter((o) => o.status === 'REQUESTED' || o.status === 'NEW').length,
      /**
       * Dishes ordered and never sent to the range — counted as plates, not
       * as lines. "2 not sent" has to mean two things somebody is waiting to
       * eat, or the number on the button is answering a question nobody asked.
       */
      unsent: orders.reduce(
        (n, o) =>
          n +
          o.items
            .filter((i) => i.kotId === null && i.accepted !== false)
            .reduce((q, i) => q + i.quantity, 0),
        0,
      ),
      since: orders.length ? orders[0].createdAt : null,
    }
  }

  return {
    tables: tables.map((t) => ({
      id: t.id,
      label: t.label,
      seats: t.seats,
      ...cardsFor(open.filter((o) => o.table_id === t.id)),
    })),
    /**
     * Everything with no table: the counter, takeaway, a car outside.
     *
     * Kept on the same screen rather than a different one, because the person
     * watching the floor is the person handing over a takeaway bag, and making
     * them change screens to find out whether one is waiting is how a bag sits
     * on the counter going cold.
     */
    elsewhere: cardsFor(open.filter((o) => !o.table_id)),
  }
}

/**
 * Sends the next round to the kitchen.
 *
 * Only what has not been sent before. The whole point of recording a round is
 * that the second press does not reprint the first one — a kitchen that gets a
 * second copy of the starters makes them twice, and nobody finds out until the
 * plates arrive.
 *
 * Items the restaurant has already said no to are left off: the kitchen should
 * never see a dish that is off the menu tonight.
 */
export function openKot(
  restaurantId: number,
  orderId: number,
  actorId: number | null,
): { ok: true; kot: KotDoc; order: any } | { ok: false; status: number; error: string } {
  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?')
    .get(orderId, restaurantId) as any
  if (!order) return { ok: false, status: 404, error: 'That order is not on your board.' }

  const pending = db
    .prepare(
      `SELECT * FROM order_items
        WHERE order_id = ? AND kot_id IS NULL AND (accepted IS NULL OR accepted = 1)
        ORDER BY id`,
    )
    .all(orderId) as any[]

  if (!pending.length) {
    return {
      ok: false,
      status: 409,
      error: 'Everything on this order has already gone to the kitchen.',
    }
  }

  const seq =
    ((db.prepare('SELECT MAX(seq_no) AS n FROM kots WHERE order_id = ?').get(orderId) as any)?.n ?? 0) + 1

  const kotId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO kots (restaurant_id, order_id, seq_no, note, printed_at, created_by)
         VALUES (?, ?, ?, ?, datetime('now'), ?)`,
      )
      .run(restaurantId, orderId, seq, order.note ?? '', actorId)
    const id = Number(info.lastInsertRowid)
    const addItem = db.prepare(
      'INSERT INTO kot_items (kot_id, order_item_id, name, quantity) VALUES (?, ?, ?, ?)',
    )
    const stamp = db.prepare('UPDATE order_items SET kot_id = ? WHERE id = ?')
    for (const i of pending) {
      addItem.run(id, i.id, i.name, i.quantity)
      stamp.run(id, i.id)
    }
    return id
  })()

  const kot = kotsForOrder(orderId).find((k) => k.id === kotId)!
  return { ok: true, kot, order }
}

/** A round already sent, so it can be printed again when a slip is lost. */
export function kotById(restaurantId: number, kotId: number): KotDoc | null {
  const row = db
    .prepare('SELECT * FROM kots WHERE id = ? AND restaurant_id = ?')
    .get(kotId, restaurantId) as any
  if (!row) return null
  return kotsForOrder(row.order_id).find((k) => k.id === kotId) ?? null
}

/**
 * The whole table, as one bill.
 *
 * Shaped exactly like a single order's bill, because it is printed by the same
 * code and read by the same customer. Everything open at that table is added
 * together and the same dish ordered in two rounds appears once, with the
 * quantities summed — a bill listing "1 x Masala Chai" four times is arithmetic
 * the customer is being asked to check.
 */
export function tableBill(restaurantId: number, tableId: number) {
  const table = db
    .prepare('SELECT * FROM restaurant_tables WHERE id = ? AND restaurant_id = ?')
    .get(tableId, restaurantId) as any
  if (!table) return null

  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId) as any
  const orders = db
    .prepare(
      `SELECT * FROM orders o WHERE o.restaurant_id = ? AND o.table_id = ? AND ${OPEN_SQL}
        ORDER BY o.created_at`,
    )
    .all(restaurantId, tableId) as any[]

  const merged = new Map<string, { id: number; name: string; quantity: number; unitPriceCents: number }>()
  let itemCents = 0
  for (const o of orders) {
    const items = db
      .prepare(
        'SELECT * FROM order_items WHERE order_id = ? AND (accepted IS NULL OR accepted = 1) ORDER BY id',
      )
      .all(o.id) as any[]
    for (const i of items) {
      const key = `${i.name}|${i.unit_price_cents}`
      const at = merged.get(key)
      if (at) at.quantity += i.quantity
      else merged.set(key, { id: i.id, name: i.name, quantity: i.quantity, unitPriceCents: i.unit_price_cents })
      itemCents += i.unit_price_cents * i.quantity
    }
  }

  const deliveryFeeCents = orders.reduce((n, o) => n + (o.delivery_fee_cents ?? 0), 0)
  const totalCents = itemCents + deliveryFeeCents
  const paid = orders.reduce((n, o) => n + paidCents(o.id), 0)

  return {
    tableId: table.id,
    restaurant: {
      name: restaurant.name,
      address: restaurant.address,
      phone: restaurant.phone,
      taxEnabled: !!restaurant.tax_enabled,
      gstin: restaurant.gstin || '',
      legalName: restaurant.legal_name || '',
    },
    /** The table is the bill's identity here — there is no single order. */
    orderNumber: table.label,
    orderIds: orders.map((o) => o.id),
    orderNumbers: orders.map((o) => o.order_number),
    tableLabel: table.label,
    customerName: orders[0]?.customer_name ?? '',
    customerPhone: orders.find((o) => o.contact_phone)?.contact_phone ?? '',
    note: orders.map((o) => o.note).filter(Boolean).join(' · '),
    placedAt: orders[0]?.created_at ?? null,
    items: [...merged.values()],
    rounds: orders.length,
    deliveryFeeCents,
    subtotalCents: itemCents,
    totalCents,
    paidCents: paid,
    claimedCents: orders.reduce((n, o) => n + claimedCents(o.id), 0),
    dueCents: Math.max(0, totalCents - paid),
  }
}

/**
 * Closes the whole table at once.
 *
 * Settling one order at a time is how half a table ends up paid: the bill was
 * added up across four orders, the money came in once, and each order still
 * believes it is owed something. One press, one payment, every order on that
 * table closed against it.
 */
export function settleTable(
  restaurantId: number,
  tableId: number,
  method: string,
  payerName: string,
  actor: Actor = { id: null, name: 'Counter' },
): { ok: true; settled: number; amountCents: number; invoices: string[] } | { ok: false; status: number; error: string } {
  const bill = tableBill(restaurantId, tableId)
  if (!bill) return { ok: false, status: 404, error: 'No such table.' }
  if (!bill.orderIds.length) return { ok: false, status: 409, error: 'Nothing open on that table.' }

  const orders = db
    .prepare(`SELECT * FROM orders WHERE id IN (${bill.orderIds.map(() => '?').join(',')})`)
    .all(...bill.orderIds) as any[]

  /*
   * Every order on the table becomes a real invoice before a rupee is taken.
   *
   * This used to write a payment row straight against the order and close the
   * bill, which took the money correctly and produced no tax invoice at all —
   * no number, no tax lines, nothing that survives the menu being edited. The
   * per-order route had done it properly all along; the table route, which is
   * the one dine-in actually uses, had never been connected to it.
   *
   * finaliseInvoice is idempotent, so a table settled twice — a cashier
   * tapping again, a dropped connection retried — reuses the invoice it
   * already has rather than taking a second number out of the series.
   */
  let taken = 0
  const numbers: string[] = []
  const failed: string[] = []

  for (const o of orders) {
    const made = finaliseInvoice({ orderId: o.id, actor, customerName: payerName || o.customer_name })
    if (!made.ok) {
      // An order with nothing on it cannot be billed, and must not stop the
      // rest of the table being settled.
      failed.push(`${o.order_number}: ${made.error}`)
      continue
    }
    const invoice = made.invoice
    numbers.push(invoice.number)

    /* The invoice total, not the order's — it is the one carrying tax and
       rounding, and the customer is paying what the printed bill says. */
    const due = Math.max(0, invoice.total_cents - paidOnInvoice(invoice.id))
    if (due > 0) {
      const took = takePayment({
        invoiceId: invoice.id,
        amountCents: due,
        method,
        actor,
        payerName: payerName || o.customer_name,
      })
      if (took.ok) taken += due
      else failed.push(`${o.order_number}: ${took.error}`)
    }
  }

  if (!numbers.length) {
    return { ok: false, status: 400, error: failed[0] ?? 'Nothing on this table could be billed.' }
  }

  db.transaction(() => {
    for (const o of orders) {
      db.prepare("UPDATE order_items SET paid_at = datetime('now') WHERE order_id = ? AND paid_at IS NULL").run(o.id)
      db.prepare(
        `UPDATE orders SET bill_closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      ).run(o.id)
      // The shared ticket this order opened goes with it. A room left open on
      // a table somebody has paid for and left is exactly the stale handle
      // that strands the next customer's phone.
      db.prepare(
        `UPDATE group_sessions SET status = 'CLOSED', closed_at = datetime('now')
          WHERE order_id = ? AND status <> 'CLOSED'`,
      ).run(o.id)
    }
  })()

  return { ok: true, settled: orders.length, amountCents: taken, invoices: numbers }
}
