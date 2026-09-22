/**
 * Printing a bill, in a window of its own.
 *
 * The first version printed the dashboard: a @media print block hid every
 * element on the page and un-hid the receipt. That works in a demo and is
 * fragile in a shop. The whole application's stylesheet is still loaded and
 * still applies — dark backgrounds, flex layouts, web fonts, a sidebar that
 * is merely invisible rather than absent — and a thermal driver handed that
 * to lay out on an 80mm roll can quite reasonably produce nothing at all.
 * Which is what happened: the bill on screen, and blank paper.
 *
 * So the receipt is written into a window that contains nothing else. No app
 * CSS, no framework, no theme — one small document with its own styles, laid
 * out for the paper it is going onto. What the printer receives is what is in
 * here and not one rule more.
 */
export type ReceiptBill = {
  restaurant: {
    name: string
    address?: string
    phone?: string
    taxEnabled?: boolean
    gstin?: string
    legalName?: string
  }
  orderNumber: string
  tableLabel?: string | null
  customerName?: string
  placedAt?: string
  items: { id: number; name: string; quantity: number; unitPriceCents: number }[]
  deliveryFeeCents?: number
  totalCents: number
  paidCents?: number
  dueCents?: number
}

/** Rupees from paise, as a string, because money is not a float. */
function money(paise: number): string {
  const n = Math.round(Number(paise) || 0)
  return `₹${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function receiptHtml(bill: ReceiptBill): string {
  /**
   * What the document calls itself turns on one thing: whether the restaurant
   * is registered for GST. A business that is not must not hand out a
   * document headed "Tax Invoice", must not print a GST number and must not
   * show a tax line — most small cafes are under the threshold, and a bill
   * implying a registration nobody has is a worse problem than a plain one.
   */
  const registered = !!bill.restaurant.taxEnabled && !!bill.restaurant.gstin
  const when = bill.placedAt
    ? new Date(String(bill.placedAt).replace(' ', 'T') + 'Z').toLocaleString()
    : new Date().toLocaleString()

  const lines = bill.items
    .map(
      (i) =>
        `<tr><td>${esc(i.quantity)} × ${esc(i.name)}</td><td class="amt">${money(
          i.unitPriceCents * i.quantity,
        )}</td></tr>`,
    )
    .join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(bill.restaurant.name)} — ${esc(bill.orderNumber)}</title>
<style>
  /* An 80mm roll: as wide as the paper, as long as the bill needs. */
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3mm;
    width: 80mm;
    background: #fff;
    color: #000;
    font-family: ui-monospace, "Courier New", monospace;
    font-size: 11px;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { font-size: 15px; margin: 0 0 2px; text-align: center; }
  h2 {
    font-size: 11px; margin: 8px 0; text-align: center;
    text-transform: uppercase; letter-spacing: .12em;
    border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 3px 0;
  }
  p { margin: 0; text-align: center; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  td { padding: 1px 0; vertical-align: top; }
  .amt { text-align: right; white-space: nowrap; padding-left: 6px; }
  .row { display: flex; justify-content: space-between; font-size: 10px; }
  .total {
    display: flex; justify-content: space-between; font-weight: 700; font-size: 13px;
    border-top: 1px dashed #000; margin-top: 5px; padding-top: 4px;
  }
  .foot { margin-top: 10px; font-size: 10px; }
</style></head>
<body>
  <h1>${esc(bill.restaurant.name)}</h1>
  ${registered && bill.restaurant.legalName ? `<p>${esc(bill.restaurant.legalName)}</p>` : ''}
  ${bill.restaurant.address ? `<p>${esc(bill.restaurant.address)}</p>` : ''}
  ${bill.restaurant.phone ? `<p>${esc(bill.restaurant.phone)}</p>` : ''}
  ${registered ? `<p>GSTIN: ${esc(bill.restaurant.gstin)}</p>` : ''}

  <h2>${registered ? 'Tax Invoice' : 'Bill'}</h2>

  <div class="row"><span>#${esc(bill.orderNumber)}</span><span>${esc(when)}</span></div>
  <div class="row"><span>${esc(bill.tableLabel ?? 'Counter')}</span><span>${esc(bill.customerName ?? '')}</span></div>

  <table><tbody>${lines}</tbody></table>

  ${
    bill.deliveryFeeCents
      ? `<div class="row"><span>Delivery</span><span>${money(bill.deliveryFeeCents)}</span></div>`
      : ''
  }
  <div class="total"><span>Total</span><span>${money(bill.totalCents)}</span></div>
  ${bill.paidCents ? `<div class="row"><span>Paid</span><span>${money(bill.paidCents)}</span></div>` : ''}
  ${bill.dueCents ? `<div class="row"><span>Due</span><span>${money(bill.dueCents)}</span></div>` : ''}

  <p class="foot">Thank you — ordered through Khapee</p>
</body></html>`
}

/**
 * Opens the receipt and asks the printer for it.
 *
 * A hidden iframe rather than a pop-up window: a pop-up is blocked often
 * enough to matter behind a counter, and a blocked one is indistinguishable
 * from a printer that did nothing. An iframe is part of the page, so nothing
 * can refuse it.
 *
 * Returns false when even that fails, so the caller can say so rather than
 * leaving somebody watching a printer that was never asked for anything.
 */
export function printReceipt(bill: ReceiptBill): boolean {
  try {
    const frame = document.createElement('iframe')
    // Off-screen rather than display:none — a frame that is not laid out has
    // nothing to print in some browsers.
    frame.setAttribute('aria-hidden', 'true')
    frame.style.position = 'fixed'
    frame.style.right = '100%'
    frame.style.bottom = '100%'
    frame.style.width = '80mm'
    frame.style.height = '200mm'
    frame.style.border = '0'
    document.body.appendChild(frame)

    const doc = frame.contentDocument
    if (!doc) {
      frame.remove()
      return false
    }
    doc.open()
    doc.write(receiptHtml(bill))
    doc.close()

    const go = () => {
      try {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
      } finally {
        // Left long enough for the print dialog to take its copy of the
        // document; removed so a second print does not find two of them.
        setTimeout(() => frame.remove(), 60_000)
      }
    }
    // Fonts and layout first: printing an empty document is the failure this
    // whole file exists to avoid.
    if (frame.contentWindow?.document.readyState === 'complete') setTimeout(go, 60)
    else frame.onload = () => setTimeout(go, 60)
    return true
  } catch {
    return false
  }
}
