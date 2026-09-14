/**
 * Turning an order into money that has been taken.
 *
 * The rule this file exists to enforce: once an invoice is finalised it is a
 * record of what happened, not a view of current data. It therefore copies
 * everything it needs — dish names, prices, tax rates, HSN codes, and who the
 * restaurant legally was — rather than pointing at rows that can change. Edit
 * the menu tomorrow and last night's bill still reads the same.
 *
 * It also never invents a tax rate. A restaurant that has not switched tax on
 * gets a bill with no tax line, because that is the correct bill for them.
 */
import { db } from './db.ts'
import { computeBill, financialYear, type BillInput } from './tax.ts'

export type Actor = { id: number | null; name: string }

export function audit(
  restaurantId: number | null,
  actor: Actor,
  action: string,
  entity: string,
  entityId: number | null,
  detail: unknown = '',
) {
  db.prepare(
    `INSERT INTO audit_log (restaurant_id, actor_id, actor_name, action, entity, entity_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    restaurantId,
    actor.id,
    actor.name,
    action,
    entity,
    entityId,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
  )
}

/** The rate a dish is taxed at, or nothing when the restaurant has tax off. */
function rateForItem(restaurant: any, menuItemId: number | null): { rateBp: number; inclusive: boolean; hsnSac: string } {
  if (!restaurant.tax_enabled) return { rateBp: 0, inclusive: true, hsnSac: '' }
  const own = menuItemId
    ? (db
        .prepare(
          `SELECT t.* FROM menu_items m JOIN tax_rates t ON t.id = m.tax_rate_id
            WHERE m.id = ? AND t.restaurant_id = ?`,
        )
        .get(menuItemId, restaurant.id) as any)
    : null
  const rate =
    own ??
    (db
      .prepare('SELECT * FROM tax_rates WHERE restaurant_id = ? AND is_default = 1 ORDER BY id LIMIT 1')
      .get(restaurant.id) as any)
  if (!rate) return { rateBp: 0, inclusive: true, hsnSac: '' }
  return { rateBp: rate.rate_bp, inclusive: !!rate.inclusive, hsnSac: rate.hsn_sac ?? '' }
}

/** What an order would come to, priced right now. Nothing is written. */
export function quoteOrder(
  orderId: number,
  opts: { billDiscountCents?: number; charges?: BillInput['charges']; interState?: boolean } = {},
) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any
  if (!order) return null
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(order.restaurant_id) as any
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId) as any[]

  return computeBill({
    lines: items.map((i) => {
      const r = rateForItem(restaurant, i.menu_item_id)
      return {
        name: i.name,
        hsnSac: r.hsnSac,
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
        rateBp: r.rateBp,
        inclusive: r.inclusive,
      }
    }),
    billDiscountCents: opts.billDiscountCents ?? 0,
    charges: opts.charges ?? [],
    interState: opts.interState ?? false,
    roundToRupee: false,
  })
}

/**
 * Takes the next invoice number for a restaurant's financial year.
 *
 * Must be called inside the transaction that writes the invoice. SQLite
 * serialises writers, so two terminals billing at the same moment queue rather
 * than collide — the UPDATE ... RETURNING is what makes the number theirs.
 */
function nextNumber(restaurantId: number, prefix: string, at: Date): { number: string; fy: string; seq: number } {
  const fy = financialYear(at)
  db.prepare('INSERT OR IGNORE INTO invoice_sequences (restaurant_id, fy, last_seq) VALUES (?, ?, 0)').run(
    restaurantId,
    fy,
  )
  const row = db
    .prepare(
      'UPDATE invoice_sequences SET last_seq = last_seq + 1 WHERE restaurant_id = ? AND fy = ? RETURNING last_seq',
    )
    .get(restaurantId, fy) as any
  const seq = Number(row.last_seq)
  return { number: `${prefix || 'ORD'}/${fy}/${String(seq).padStart(6, '0')}`, fy, seq }
}

export type FinaliseInput = {
  orderId: number
  actor: Actor
  billDiscountCents?: number
  discountReason?: string
  charges?: BillInput['charges']
  interState?: boolean
  customerName?: string
  customerPhone?: string
  roundToRupee?: boolean
}

export type FinaliseResult =
  | { ok: true; invoice: any; created: boolean }
  | { ok: false; status: number; error: string }

/**
 * Finalises an order into an invoice.
 *
 * Idempotent on purpose: a cashier who taps twice, or a terminal that retries
 * after a dropped connection, must not produce two invoices for one order. The
 * second call returns the first invoice rather than taking another number.
 */
export function finaliseInvoice(input: FinaliseInput): FinaliseResult {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(input.orderId) as any
  if (!order) return { ok: false, status: 404, error: 'That order no longer exists.' }

  const existing = db
    .prepare("SELECT * FROM invoices WHERE order_id = ? AND status = 'FINAL'")
    .get(order.id) as any
  if (existing) return { ok: true, invoice: existing, created: false }

  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(order.restaurant_id) as any
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id) as any[]
  if (!items.length) return { ok: false, status: 400, error: 'That order has nothing on it to bill.' }

  const bill = computeBill({
    lines: items.map((i) => {
      const r = rateForItem(restaurant, i.menu_item_id)
      return {
        name: i.name,
        hsnSac: r.hsnSac,
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
        rateBp: r.rateBp,
        inclusive: r.inclusive,
      }
    }),
    billDiscountCents: input.billDiscountCents ?? 0,
    // A delivery fee is part of what was charged, so it belongs on the invoice
    // as its own line rather than being left off it or buried in a dish price.
    // It is taken from the order, not from the area, so re-printing an old bill
    // cannot pick up a fee the restaurant has since changed.
    charges: [
      ...(order.delivery_fee_cents > 0 ? [{ name: 'Delivery', amountCents: order.delivery_fee_cents }] : []),
      ...(input.charges ?? []),
    ],
    interState: input.interState ?? false,
    roundToRupee: input.roundToRupee ?? false,
  })

  const at = new Date()
  const place =
    order.service_mode === 'car'
      ? carLabel(order)
      : order.table_label
        ? `Table ${order.table_label}`.replace(/^Table Table /, 'Table ')
        : ''

  const run = db.transaction(() => {
    const { number, fy, seq } = nextNumber(order.restaurant_id, restaurant.invoice_prefix, at)
    const info = db
      .prepare(
        `INSERT INTO invoices
           (restaurant_id, order_id, session_id, number, fy, seq, service_mode, place_label,
            customer_name, customer_phone, subtotal_cents, discount_cents, charge_cents, taxable_cents,
            cgst_cents, sgst_cents, igst_cents, rounding_cents, total_cents, seller_snapshot,
            discount_reason, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        order.restaurant_id,
        order.id,
        order.dining_session_id ?? null,
        number,
        fy,
        seq,
        order.service_mode ?? 'dine_in',
        place,
        input.customerName ?? order.customer_name ?? '',
        input.customerPhone ?? '',
        bill.subtotalCents,
        bill.discountCents,
        bill.chargeCents,
        bill.taxableCents,
        bill.cgstCents,
        bill.sgstCents,
        bill.igstCents,
        bill.roundingCents,
        bill.totalCents,
        // Who the restaurant was when this was issued — a later rename or a new
        // GSTIN must not rewrite bills already given to customers.
        JSON.stringify({
          name: restaurant.name,
          legalName: restaurant.legal_name || restaurant.name,
          address: restaurant.address,
          gstin: restaurant.gstin || '',
          stateCode: restaurant.state_code || '',
          phone: restaurant.phone || '',
          taxEnabled: !!restaurant.tax_enabled,
        }),
        input.discountReason ?? '',
        input.actor.id,
      )
    const invoiceId = Number(info.lastInsertRowid)

    const line = db.prepare(
      `INSERT INTO invoice_lines
         (invoice_id, name, hsn_sac, quantity, unit_price_cents, gross_cents, discount_cents,
          taxable_cents, tax_rate_bp, cgst_cents, sgst_cents, igst_cents, total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const l of bill.lines) {
      line.run(
        invoiceId,
        l.name,
        l.hsnSac,
        l.quantity,
        l.unitPriceCents,
        l.grossCents,
        l.discountCents,
        l.taxableCents,
        l.rateBp,
        l.cgstCents,
        l.sgstCents,
        l.igstCents,
        l.totalCents,
      )
    }
    for (const c of bill.charges) {
      line.run(invoiceId, c.name, '', 1, c.amountCents, c.amountCents, 0, c.amountCents, c.rateBp, 0, 0, 0, c.amountCents + c.taxCents)
    }

    db.prepare("UPDATE orders SET invoice_id = ?, bill_status = 'BILLED', updated_at = datetime('now') WHERE id = ?").run(
      invoiceId,
      order.id,
    )
    return invoiceId
  })

  const invoiceId = run()
  audit(order.restaurant_id, input.actor, 'invoice.finalise', 'invoice', invoiceId, {
    order: order.order_number,
    total: bill.totalCents,
    discount: bill.discountCents,
  })
  return { ok: true, invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId), created: true }
}

function carLabel(order: any): string {
  const s = order.dining_session_id
    ? (db.prepare('SELECT seq_no, vehicle FROM dining_sessions WHERE id = ?').get(order.dining_session_id) as any)
    : null
  if (!s) return 'Roadside'
  return `Car ${s.seq_no ?? ''}${s.vehicle ? ` · ${s.vehicle}` : ''}`.trim()
}

/** Money taken against an invoice, in paise. Refunds count against it. */
export function paidOnInvoice(invoiceId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN refund_of IS NULL THEN amount_cents ELSE -amount_cents END), 0) AS n
         FROM payments WHERE invoice_id = ? AND status <> 'REJECTED'`,
    )
    .get(invoiceId) as any
  return Number(row.n)
}

export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'VOIDED'

export function invoicePaymentStatus(invoice: any): PaymentStatus {
  if (invoice.status === 'VOID') return 'VOIDED'
  const paid = paidOnInvoice(invoice.id)
  const refunded = Number(
    (db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS n FROM payments WHERE invoice_id = ? AND refund_of IS NOT NULL').get(
      invoice.id,
    ) as any).n,
  )
  if (refunded > 0) return paid <= 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
  if (paid <= 0) return 'UNPAID'
  if (paid < invoice.total_cents) return 'PARTIALLY_PAID'
  return 'PAID'
}

/**
 * Records money taken. Split payments are simply several of these against one
 * invoice — there is no second bill, which is what keeps the split honest.
 */
export function takePayment(opts: {
  invoiceId: number
  amountCents: number
  method: string
  actor: Actor
  tenderedCents?: number
  payerName?: string
  reference?: string
}): { ok: true; paymentId: number; changeCents: number } | { ok: false; status: number; error: string } {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(opts.invoiceId) as any
  if (!invoice) return { ok: false, status: 404, error: 'That bill no longer exists.' }
  if (invoice.status === 'VOID') return { ok: false, status: 409, error: 'That bill was voided.' }

  const amount = Math.floor(opts.amountCents)
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, status: 400, error: 'Enter an amount to take.' }

  const outstanding = invoice.total_cents - paidOnInvoice(invoice.id)
  if (amount > outstanding) {
    return { ok: false, status: 400, error: `That is more than the ${money(outstanding)} still owed.` }
  }

  // Cash is handed over in notes, so the change is worked out here rather than
  // in the cashier's head.
  const tendered = opts.tenderedCents ?? amount
  const change = opts.method === 'cash' ? Math.max(0, tendered - amount) : 0

  const info = db
    .prepare(
      `INSERT INTO payments
         (order_id, session_id, member_id, payer_name, amount_cents, method, status, upi_ref,
          invoice_id, tendered_cents, change_cents, taken_by)
       VALUES (?, ?, NULL, ?, ?, ?, 'CONFIRMED', ?, ?, ?, ?, ?)`,
    )
    .run(
      invoice.order_id,
      invoice.session_id,
      opts.payerName ?? '',
      amount,
      opts.method,
      opts.reference ?? '',
      invoice.id,
      opts.method === 'cash' ? tendered : null,
      change,
      opts.actor.id,
    )

  syncOrderFromInvoice(invoice.id)
  audit(invoice.restaurant_id, opts.actor, 'payment.take', 'invoice', invoice.id, {
    amount,
    method: opts.method,
  })
  return { ok: true, paymentId: Number(info.lastInsertRowid), changeCents: change }
}

/** Keeps the order's own payment flag in step with what the invoice has taken. */
export function syncOrderFromInvoice(invoiceId: number) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any
  if (!invoice?.order_id) return
  const status = invoicePaymentStatus(invoice)
  db.prepare("UPDATE orders SET payment_status = ?, bill_status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status === 'PAID' ? 'PAID' : 'UNPAID',
    status,
    invoice.order_id,
  )
}

/**
 * Voids an invoice. The row stays, its number is never reused, and the order
 * returns to being billable — which is how a duplicate bill is corrected
 * without anybody editing a figure.
 */
export function voidInvoice(invoiceId: number, reason: string, actor: Actor) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any
  if (!invoice) return { ok: false as const, status: 404, error: 'That bill no longer exists.' }
  if (invoice.status === 'VOID') return { ok: false as const, status: 409, error: 'That bill is already void.' }
  if (paidOnInvoice(invoice.id) > 0) {
    return { ok: false as const, status: 409, error: 'Money has been taken on this bill — refund it instead.' }
  }
  if (!reason.trim()) return { ok: false as const, status: 400, error: 'Give a reason for voiding it.' }

  db.prepare(
    "UPDATE invoices SET status = 'VOID', voided_at = datetime('now'), voided_by = ?, void_reason = ? WHERE id = ?",
  ).run(actor.id, reason.trim().slice(0, 200), invoice.id)
  if (invoice.order_id) {
    db.prepare("UPDATE orders SET invoice_id = NULL, bill_status = 'OPEN' WHERE id = ?").run(invoice.order_id)
  }
  audit(invoice.restaurant_id, actor, 'invoice.void', 'invoice', invoice.id, { reason })
  return { ok: true as const }
}

/** A refund is a negative payment, never a deletion of the original. */
export function refund(opts: {
  invoiceId: number
  amountCents: number
  method: string
  reason: string
  actor: Actor
}) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(opts.invoiceId) as any
  if (!invoice) return { ok: false as const, status: 404, error: 'That bill no longer exists.' }
  const paid = paidOnInvoice(invoice.id)
  const amount = Math.floor(opts.amountCents)
  if (amount <= 0) return { ok: false as const, status: 400, error: 'Enter an amount to refund.' }
  if (amount > paid) return { ok: false as const, status: 400, error: `Only ${money(paid)} was taken on this bill.` }
  if (!opts.reason.trim()) return { ok: false as const, status: 400, error: 'Give a reason for the refund.' }

  const original = db
    .prepare("SELECT id FROM payments WHERE invoice_id = ? AND refund_of IS NULL AND status <> 'REJECTED' ORDER BY id LIMIT 1")
    .get(invoice.id) as any

  const info = db
    .prepare(
      `INSERT INTO payments
         (order_id, session_id, member_id, payer_name, amount_cents, method, status, upi_ref,
          invoice_id, taken_by, refund_of, reason)
       VALUES (?, ?, NULL, '', ?, ?, 'CONFIRMED', '', ?, ?, ?, ?)`,
    )
    .run(invoice.order_id, invoice.session_id, amount, opts.method, invoice.id, opts.actor.id, original?.id ?? null, opts.reason.trim().slice(0, 200))

  syncOrderFromInvoice(invoice.id)
  audit(invoice.restaurant_id, opts.actor, 'payment.refund', 'invoice', invoice.id, {
    amount,
    reason: opts.reason,
  })
  return { ok: true as const, paymentId: Number(info.lastInsertRowid) }
}

function money(cents: number): string {
  return '₹' + (cents / 100).toFixed(2)
}

/** The whole bill as it will be shown or printed. Reads only the snapshot. */
export function shapeInvoice(invoiceId: number) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any
  if (!invoice) return null
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(invoiceId) as any[]
  const payments = db
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY id')
    .all(invoiceId) as any[]
  const seller = JSON.parse(invoice.seller_snapshot || '{}')
  const paid = paidOnInvoice(invoiceId)

  const byRate = new Map<number, any>()
  for (const l of lines) {
    if (!l.tax_rate_bp) continue
    const g = byRate.get(l.tax_rate_bp) ?? { rateBp: l.tax_rate_bp, taxableCents: 0, cgstCents: 0, sgstCents: 0, igstCents: 0 }
    g.taxableCents += l.taxable_cents
    g.cgstCents += l.cgst_cents
    g.sgstCents += l.sgst_cents
    g.igstCents += l.igst_cents
    byRate.set(l.tax_rate_bp, g)
  }

  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    paymentStatus: invoicePaymentStatus(invoice),
    createdAt: invoice.created_at,
    serviceMode: invoice.service_mode,
    placeLabel: invoice.place_label,
    customerName: invoice.customer_name,
    customerPhone: invoice.customer_phone,
    orderId: invoice.order_id,
    seller,
    lines: lines.map((l) => ({
      name: l.name,
      hsnSac: l.hsn_sac,
      quantity: l.quantity,
      unitPriceCents: l.unit_price_cents,
      grossCents: l.gross_cents,
      discountCents: l.discount_cents,
      taxableCents: l.taxable_cents,
      rateBp: l.tax_rate_bp,
      cgstCents: l.cgst_cents,
      sgstCents: l.sgst_cents,
      igstCents: l.igst_cents,
      totalCents: l.total_cents,
    })),
    subtotalCents: invoice.subtotal_cents,
    discountCents: invoice.discount_cents,
    discountReason: invoice.discount_reason,
    chargeCents: invoice.charge_cents,
    taxableCents: invoice.taxable_cents,
    cgstCents: invoice.cgst_cents,
    sgstCents: invoice.sgst_cents,
    igstCents: invoice.igst_cents,
    taxCents: invoice.cgst_cents + invoice.sgst_cents + invoice.igst_cents,
    roundingCents: invoice.rounding_cents,
    totalCents: invoice.total_cents,
    paidCents: paid,
    dueCents: Math.max(0, invoice.total_cents - paid),
    taxBreakdown: [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp),
    payments: payments.map((p) => ({
      id: p.id,
      amountCents: p.amount_cents,
      method: p.method,
      isRefund: !!p.refund_of,
      tenderedCents: p.tendered_cents,
      changeCents: p.change_cents,
      reason: p.reason,
      at: p.created_at,
    })),
    voidReason: invoice.void_reason,
  }
}
