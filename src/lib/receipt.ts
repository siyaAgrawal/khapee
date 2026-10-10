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
  items: { id: number; name: string; quantity: number; unitPriceCents: number; options?: string }[]
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
        `<tr><td>${esc(i.quantity)} × ${esc(i.name)}${i.options ? `<br><small>${esc(i.options)}</small>` : ''}</td><td class="amt">${money(
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
 * What happened when we asked for paper.
 *
 * "It printed" and "we asked and nothing answered" have to be different
 * answers. The first version returned true the moment a frame had been
 * created, which is not the same thing as a printer being asked for anything
 * — so a till where printing silently failed looked exactly like one where it
 * worked, and the only symptom was no paper.
 */
export type PrintOutcome =
  /** The browser started printing. Under kiosk printing this means paper. */
  | 'printed'
  /** The frame would not print, so the bill is open in a window to print by hand. */
  | 'window'
  /** Nothing could be opened at all — a blocked pop-up on a locked-down browser. */
  | 'failed'

/** Prints the bill. See printDocument for how this is made to actually happen. */
export function printReceipt(bill: ReceiptBill): Promise<PrintOutcome> {
  return printDocument(receiptHtml(bill), `Bill ${bill.orderNumber}`)
}

/**
 * One press, and paper — and a way to know whether it happened.
 *
 * A web page cannot print silently on its own. Every browser insists on its
 * dialog and no amount of code gets around that; what removes it is how Chrome
 * is started, with --kiosk-printing, which prints straight to the default
 * printer and shows nothing. That is how a till should be launched and it
 * makes this exactly one click.
 *
 * Two things are done differently here, both learned the hard way on a real
 * counter where this button did nothing at all:
 *
 * The document prints itself. The parent reaching into a frame and calling
 * print() on it is the version that failed — a frame written through
 * document.write is not reliably ready when the parent thinks it is, and a
 * print() against a half-built document is a no-op that reports nothing. An
 * inline script inside the document runs when that document is ready, which is
 * the only moment that is actually knowable.
 *
 * And the result is checked. The document says so itself, immediately before
 * it calls print — not through beforeprint, because which window that event
 * is delivered to differs between browsers, and a success signal that is
 * merely usually delivered would open a second copy in a window and invite
 * somebody to print the same bill twice. A message the document sends on its
 * way into print() is plain fact: the browser was asked.
 *
 * If that has not arrived shortly after, the frame did not get there — and
 * rather than leave somebody watching a silent printer, the bill opens in a
 * visible window they can print by hand.
 */
const PRINT_PING = 'khapee:printing'

function printDocument(html: string, title: string): Promise<PrintOutcome> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.setAttribute('title', title)
    // Off the side of the page at its true size. display:none and zero-sized
    // frames are laid out by nobody, and a frame with no layout has no pages
    // to print.
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:80mm;height:250mm;border:0;visibility:visible'
    document.body.appendChild(frame)

    let settled = false
    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) {
      frame.remove()
      return resolve(openInWindow(html) ? 'window' : 'failed')
    }

    const heard = (e: MessageEvent) => {
      if (settled || e.data !== PRINT_PING || e.source !== win) return
      settled = true
      window.removeEventListener('message', heard)
      // Kept alive well past the dialog: removing the frame while the browser
      // is still spooling the job cancels it.
      setTimeout(() => frame.remove(), 60_000)
      resolve('printed')
    }
    window.addEventListener('message', heard)

    doc.open()
    doc.write(selfPrinting(html))
    doc.close()

    // Nothing has started printing, so the frame is not going to. Fall back to
    // something the person can see and press Ctrl+P on.
    setTimeout(() => {
      if (settled) return
      settled = true
      window.removeEventListener('message', heard)
      frame.remove()
      resolve(openInWindow(html) ? 'window' : 'failed')
    }, 2500)
  })
}

/**
 * The script that makes the document print itself, once it is really ready.
 *
 * Deliberately not DOMContentLoaded: layout is still settling at that point,
 * and a receipt handed to a thermal driver mid-layout comes out as blank
 * paper — which is the fault this whole file exists because of.
 */
function selfPrinting(html: string): string {
  return html.replace(
    '</body>',
    `<script>
       (function () {
         var done = false
         function go() {
           if (done) return
           done = true
           try { window.focus() } catch (e) {}
           try { parent.postMessage('${PRINT_PING}', '*') } catch (e) {}
           /*
            * print() blocks. Under kiosk printing it returns at once, but with
            * a print dialog it does not return until somebody dismisses it —
            * and it blocks the page that opened it too, because they share a
            * thread. So the till sat on a spinner, apparently frozen, behind
            * a dialog the cashier had not noticed.
            *
            * A timeout of zero is enough to fix it: the message above is
            * delivered and the screen has finished updating before print is
            * ever called.
            */
           setTimeout(function () { window.print() }, 0)
         }
         if (document.readyState === 'complete') setTimeout(go, 60)
         else window.addEventListener('load', function () { setTimeout(go, 60) })
       })()
     </script></body>`,
  )
}

/**
 * The visible fallback: the bill in a window of its own, with a button.
 *
 * Only reached when the frame would not print. It still tries to print itself,
 * because usually it will — but a button that is there to be pressed is the
 * difference between a slow evening and an impossible one.
 */
function openInWindow(html: string): boolean {
  try {
    // Narrow, so it sits beside the dashboard rather than covering it.
    const win = window.open('', 'khapee-print', 'width=420,height=680')
    if (!win) return false
    win.document.open()
    win.document.write(selfPrinting(withManualPrint(html)))
    win.document.close()
    win.focus()
    return true
  } catch {
    return false
  }
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
    .map((i) => `<tr><td class="q">${esc(i.quantity)}</td><td class="n">${esc(i.name)}${i.options ? `<br><small>${esc(i.options)}</small>` : ''}</td></tr>`)
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

/** Same off-screen frame as the receipt; see printDocument for why. */
export function printKot(bill: ReceiptBill & { note?: string }): Promise<PrintOutcome> {
  return printDocument(kotHtml(bill), `KOT ${bill.orderNumber}`)
}

/**
 * A slip that proves the printer works, without needing an order.
 *
 * "It is not printing" is three different faults wearing the same clothes:
 * the browser never asked, the browser asked and Windows sent it to a PDF, or
 * the roll is in wrong. Trying it on a real bill tells you which one it was
 * only by elimination, in the middle of service. This is the same path a bill
 * takes — same frame, same paper size — with nothing else that can be blamed.
 */
export function printTestSlip(restaurantName: string): Promise<PrintOutcome> {
  const when = new Date().toLocaleString()
  return printDocument(
    `<!doctype html>
<html><head><meta charset="utf-8"><title>Printer test</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  body {
    margin: 0; padding: 3mm; width: 80mm; background: #fff; color: #000;
    font-family: ui-monospace, "Courier New", monospace; font-size: 12px; line-height: 1.5;
  }
  h1 { font-size: 16px; margin: 0 0 6px; text-align: center; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .wide { font-size: 15px; font-weight: 700; }
</style></head>
<body>
  <h1>PRINTER TEST</h1>
  <p style="text-align:center;margin:0">${esc(restaurantName)}</p>
  <hr>
  <div class="wide">If you are holding this,</div>
  <div class="wide">printing works.</div>
  <hr>
  <div>80mm roll · full width check:</div>
  <div>||||||||||||||||||||||||||||||||</div>
  <hr>
  <div>${esc(when)}</div>
  <p style="text-align:center;margin-top:10px">— — — — — — — —</p>
</body></html>`,
    'Printer test',
  )
}

/**
 * What to tell somebody, in their own terms, about what just happened.
 *
 * The three outcomes need three different sentences: one is nothing to say,
 * one is a browser that would not print by itself, and one is a click that
 * went nowhere. Saying "printed" when no paper came out is the failure this
 * whole file was written to stop.
 */
export function printWord(outcome: PrintOutcome, what: string): [string, 'good' | 'bad' | 'info'] {
  if (outcome === 'printed') return [`${what} sent to the printer.`, 'good']
  if (outcome === 'window') {
    return [`${what} is open in a window — press Print there, or Ctrl + P.`, 'info']
  }
  return ['The browser would not open the printer. Allow pop-ups for khapee.com, then try again.', 'bad']
}
