/**
 * The one place money is worked out.
 *
 * Everything here is integer paise and integer basis points — 5% is 500 bp, not
 * 0.05 — because a float is the classic way to end up a paisa short on a bill
 * you have already printed. Nothing in this file reads the database or knows
 * about HTTP: it takes numbers and returns numbers, so it can be tested exactly
 * and so a bill computed here can never disagree with one computed elsewhere.
 *
 * Rates are never assumed. A restaurant with no tax registration passes no
 * rate and gets a bill with no tax line, which is the correct bill for them.
 */

export type TaxLineInput = {
  name: string
  hsnSac?: string
  quantity: number
  unitPriceCents: number
  /** Basis points. 500 = 5%. Zero means this line is not taxed. */
  rateBp: number
  /** True when the menu price already contains the tax. */
  inclusive: boolean
  /** Money off this line specifically, in paise. */
  discountCents?: number
}

export type TaxLine = {
  name: string
  hsnSac: string
  quantity: number
  unitPriceCents: number
  grossCents: number
  discountCents: number
  taxableCents: number
  rateBp: number
  cgstCents: number
  sgstCents: number
  igstCents: number
  totalCents: number
}

export type BillInput = {
  lines: TaxLineInput[]
  /** Money off the whole bill, spread across lines by value. */
  billDiscountCents?: number
  /** Charges the restaurant has configured, e.g. packaging. */
  charges?: { name: string; amountCents: number; rateBp?: number }[]
  /**
   * Same state as the restaurant, so the tax splits into CGST + SGST. A
   * different state is one IGST line at the full rate.
   */
  interState?: boolean
  /** Round the payable total to the nearest rupee, as most bills do. */
  roundToRupee?: boolean
}

export type Bill = {
  lines: TaxLine[]
  charges: { name: string; amountCents: number; rateBp: number; taxCents: number }[]
  subtotalCents: number
  discountCents: number
  chargeCents: number
  taxableCents: number
  cgstCents: number
  sgstCents: number
  igstCents: number
  taxCents: number
  roundingCents: number
  totalCents: number
  /** Tax grouped by rate, which is what a GST bill has to show. */
  taxBreakdown: { rateBp: number; taxableCents: number; cgstCents: number; sgstCents: number; igstCents: number }[]
}

/** Half-up on .5, which is what a person doing this by hand would do. */
function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

/**
 * Strips tax out of a price that already contains it.
 * taxable = gross × 10000 ÷ (10000 + rate)
 */
export function taxableFromInclusive(grossCents: number, rateBp: number): number {
  if (rateBp <= 0) return grossCents
  return roundHalfUp((grossCents * 10000) / (10000 + rateBp))
}

/**
 * Splits a bill discount across lines in proportion to their value, giving any
 * rounding remainder to the largest line. Spreading it matters: the discount has
 * to reduce the taxable value of each line, not be subtracted after tax, or the
 * tax charged is higher than the tax actually due.
 */
function spreadDiscount(lineValues: number[], discountCents: number): number[] {
  const total = lineValues.reduce((a, b) => a + b, 0)
  if (discountCents <= 0 || total <= 0) return lineValues.map(() => 0)
  const capped = Math.min(discountCents, total)
  const shares = lineValues.map((v) => Math.floor((v * capped) / total))
  let remainder = capped - shares.reduce((a, b) => a + b, 0)
  // Hand the leftover paise to the biggest lines, one each, largest first.
  const order = lineValues.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (remainder <= 0) break
    shares[i]++
    remainder--
  }
  return shares
}

export function computeBill(input: BillInput): Bill {
  const interState = !!input.interState

  // 1. What each line is worth before anything is taken off.
  const prepared = input.lines.map((l) => {
    const quantity = Math.max(0, Math.floor(l.quantity))
    const gross = Math.max(0, Math.floor(l.unitPriceCents)) * quantity
    return { input: l, quantity, gross, ownDiscount: Math.max(0, Math.floor(l.discountCents ?? 0)) }
  })

  // 2. A bill-level discount is spread over what is left after line discounts.
  const afterOwn = prepared.map((p) => Math.max(0, p.gross - p.ownDiscount))
  const spread = spreadDiscount(afterOwn, Math.max(0, Math.floor(input.billDiscountCents ?? 0)))

  // 3. Each line: discount first, then tax on what remains.
  const lines: TaxLine[] = prepared.map((p, i) => {
    const discount = p.ownDiscount + spread[i]
    const net = Math.max(0, p.gross - discount)
    const rateBp = Math.max(0, Math.floor(p.input.rateBp ?? 0))

    // An inclusive price already contains its tax, so the taxable value is
    // recovered from it rather than the tax being added a second time.
    const taxable = p.input.inclusive ? taxableFromInclusive(net, rateBp) : net
    const tax = rateBp > 0 ? roundHalfUp((taxable * rateBp) / 10000) : 0

    // CGST and SGST are halves of one rate; a split that rounds twice can end a
    // paisa away from the total, so one half is derived from the other.
    const cgst = interState ? 0 : Math.floor(tax / 2)
    const sgst = interState ? 0 : tax - cgst
    const igst = interState ? tax : 0

    return {
      name: p.input.name,
      hsnSac: p.input.hsnSac ?? '',
      quantity: p.quantity,
      unitPriceCents: p.input.unitPriceCents,
      grossCents: p.gross,
      discountCents: discount,
      taxableCents: taxable,
      rateBp,
      cgstCents: cgst,
      sgstCents: sgst,
      igstCents: igst,
      totalCents: taxable + tax,
    }
  })

  // 4. Charges, which may carry their own rate.
  const charges = (input.charges ?? []).map((c) => {
    const rateBp = Math.max(0, Math.floor(c.rateBp ?? 0))
    const amount = Math.max(0, Math.floor(c.amountCents))
    return { name: c.name, amountCents: amount, rateBp, taxCents: rateBp > 0 ? roundHalfUp((amount * rateBp) / 10000) : 0 }
  })

  const sum = (f: (l: TaxLine) => number) => lines.reduce((n, l) => n + f(l), 0)
  const chargeCents = charges.reduce((n, c) => n + c.amountCents, 0)
  const chargeTax = charges.reduce((n, c) => n + c.taxCents, 0)
  const chargeCgst = interState ? 0 : Math.floor(chargeTax / 2)
  const chargeSgst = interState ? 0 : chargeTax - chargeCgst

  const cgst = sum((l) => l.cgstCents) + chargeCgst
  const sgst = sum((l) => l.sgstCents) + chargeSgst
  const igst = sum((l) => l.igstCents) + (interState ? chargeTax : 0)
  const taxCents = cgst + sgst + igst
  const taxableCents = sum((l) => l.taxableCents) + chargeCents

  const beforeRounding = taxableCents + taxCents
  const rounded = input.roundToRupee ? Math.round(beforeRounding / 100) * 100 : beforeRounding

  // Tax has to be presented grouped by rate on a GST bill.
  const byRate = new Map<number, { rateBp: number; taxableCents: number; cgstCents: number; sgstCents: number; igstCents: number }>()
  for (const l of lines) {
    if (l.rateBp <= 0) continue
    const g = byRate.get(l.rateBp) ?? { rateBp: l.rateBp, taxableCents: 0, cgstCents: 0, sgstCents: 0, igstCents: 0 }
    g.taxableCents += l.taxableCents
    g.cgstCents += l.cgstCents
    g.sgstCents += l.sgstCents
    g.igstCents += l.igstCents
    byRate.set(l.rateBp, g)
  }

  return {
    lines,
    charges,
    subtotalCents: sum((l) => l.grossCents),
    discountCents: sum((l) => l.discountCents),
    chargeCents,
    taxableCents,
    cgstCents: cgst,
    sgstCents: sgst,
    igstCents: igst,
    taxCents,
    roundingCents: rounded - beforeRounding,
    totalCents: rounded,
    taxBreakdown: [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp),
  }
}

/** The Indian financial year a date falls in: April to March. */
export function financialYear(date: Date): string {
  const y = date.getFullYear()
  const start = date.getMonth() >= 3 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}
