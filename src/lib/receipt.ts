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
  return printDocument(receiptHtml(bill))
}

/**
 * One press, and paper.
 *
 * A web page cannot print silently on its own — every browser insists on its
 * dialog, and no amount of code gets around that. What removes it is how
 * Chrome is started: with --kiosk-printing it prints straight to the default
 * printer and shows nothing at all. That is how a till should be launched,
 * and it turns this into exactly one click. Without it the same click opens
 * the print box, which is the browser's decision and not ours.
 *
 * So the document is printed from a frame nobody sees. Under kiosk printing
 * that is seamless: press KOT, paper comes out, the screen never changes.
 *
 * A visible window is kept for the one case the frame cannot cover — a
 * browser that refuses to print a frame at all — because a button that does
 * nothing visible is indistinguishable from a broken printer, and that cost
 * an evening.
 */
function printDocument(html: string): boolean {
  if (openInFrame(html)) return true
  return openInWindow(withManualPrint(html))
}

/** The fallback window carries its own button; the frame never needs one. */
function withManualPrint(html: string): string {
  return html.replace(
    '</body>',
    `<div class="screen-only" style="margin-top:12px;padding:8px;border:1px dashed #999;font-size:11px;text-align:center">
       <button onclick="window.print()" style="font:inherit;padding:6px 14px;cursor:pointer">Print this</button>
       <div style="margin-top:6px;color:#555">If the print box did not open, press Ctrl&nbsp;+&nbsp;P.</div>
     </div>
     <style>@media print { .screen-only { display: none !important } }</style>
   </body>`,
  )
}

function openInWindow(html: string): boolean {
  try {
    // Narrow, so it sits beside the dashboard rather than covering it.
    const win = window.open('', 'khapee-print', 'width=420,height=680')
    if (!win) return false
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    // After layout, or the dialog can be handed an empty page.
    setTimeout(() => {
      try {
        win.print()
      } catch {
        /* the button in the document is the way out */
      }
    }, 250)
    return true
  } catch {
    return false
  }
}

function openInFrame(html: string): boolean {
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
    doc.write(html)
    doc.close()

    const go = () => {
      try {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
      } finally {
        setTimeout(() => frame.remove(), 60_000)
      }
    }
    if (frame.contentWindow?.document.readyState === 'complete') setTimeout(go, 60)
    else frame.onload = () => setTimeout(go, 60)
    return true
  } catch {
    return false
  }
}


/**
 * The kitchen's copy: what to cook, and nothing about money.
 *
 * A KOT is not a smaller bill. The person reading it is standing at a range
 * with their hands full, glancing at a slip pegged above them — so the
 * quantities are large and to the left where the eye lands, the dish names
 * are set as big as the roll allows, and every rupee is absent. A price on a
 * kitchen ticket is one more thing to read past, and the one thing on a bill
 * the kitchen must never be asked to act on.
 *
 * The note is the loudest thing on it, because "no onions" is the reason the
 * ticket gets misread and the plate comes back.
 */
export function kotHtml(bill: ReceiptBill & { note?: string }): string {
  const when = bill.placedAt
    ? new Date(String(bill.placedAt).replace(' ', 'T') + 'Z').toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const lines = bill.items
    .map((i) => `<tr><td class="q">${esc(i.quantity)}</td><td class="n">${esc(i.name)}</td></tr>`)
    .join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>KOT ${esc(bill.orderNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3mm; width: 80mm; background: #fff; color: #000;
    font-family: ui-monospace, "Courier New", monospace;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 {
    font-size: 20px; margin: 0; text-align: center; letter-spacing: .18em;
    border-bottom: 2px solid #000; padding-bottom: 3px;
  }
  .where { display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; margin: 5px 0; }
  .meta { display: flex; justify-content: space-between; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin: 7px 0 0; }
  td { padding: 4px 0; vertical-align: top; border-bottom: 1px dotted #000; }
  .q { font-size: 20px; font-weight: 700; width: 12mm; }
  .n { font-size: 15px; line-height: 1.25; }
  .note {
    margin-top: 8px; padding: 4px; border: 2px solid #000;
    font-size: 14px; font-weight: 700; text-transform: uppercase;
  }
  .cut { margin-top: 10px; text-align: center; font-size: 10px; }
</style></head>
<body>
  <h1>KOT</h1>
  <div class="where">
    <span>${esc(bill.tableLabel ?? 'COUNTER')}</span>
    <span>#${esc(bill.orderNumber)}</span>
  </div>
  <div class="meta"><span>${esc(when)}</span><span>${esc(bill.customerName ?? '')}</span></div>
  <table><tbody>${lines}</tbody></table>
  ${bill.note ? `<div class="note">${esc(bill.note)}</div>` : ''}
  <p class="cut">— — — — — — — —</p>
</body></html>`
}

/** Same off-screen frame as the receipt; see printReceipt for why. */
export function printKot(bill: ReceiptBill & { note?: string }): boolean {
  return printDocument(kotHtml(bill))
}
