import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, openStream } from '../../lib/api'
import { EmptyState, LoadingBlock, Modal, Spinner, useToast } from '../../components/ui'
import { money } from '../../../shared/orders'

type OpenBill = {
  orderId: number
  orderNumber: string
  serviceMode: string
  place: string
  status: string
  customerName: string
  totalCents: number
  createdAt: string
}
type AwaitingBill = {
  invoiceId: number
  number: string
  place: string
  serviceMode: string
  totalCents: number
  paidCents: number
  dueCents: number
  paymentStatus: string
}
type Quote = {
  lines: { name: string; quantity: number; unitPriceCents: number; grossCents: number; taxableCents: number; rateBp: number; cgstCents: number; sgstCents: number; igstCents: number }[]
  subtotalCents: number
  discountCents: number
  taxableCents: number
  cgstCents: number
  sgstCents: number
  igstCents: number
  taxCents: number
  totalCents: number
}
type Invoice = {
  id: number
  number: string
  paymentStatus: string
  totalCents: number
  paidCents: number
  dueCents: number
  payments: { amountCents: number; method: string; isRefund: boolean; changeCents: number | null }[]
}

const MODE_ICON: Record<string, string> = {
  dine_in: '🍽',
  car: '🚗',
  takeaway: '🥡',
  counter: '🧾',
  pickup: '🥡',
  delivery: '🛵',
}

/**
 * The till.
 *
 * Everything billable is an order that already exists — the customer's own, or
 * one a cashier rang up a moment ago — so nothing here re-enters a menu that
 * the kitchen has already seen. The screen is one column of things owed and one
 * panel to settle them, because at a busy counter the cost that matters is taps.
 */
export default function StaffPos() {
  const toast = useToast()
  const [open, setOpen] = useState<{ unbilled: OpenBill[]; awaitingPayment: AwaitingBill[] } | null>(null)
  const [active, setActive] = useState<OpenBill | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [discount, setDiscount] = useState('')
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<{ unbilled: OpenBill[]; awaitingPayment: AwaitingBill[] }>('/staff/pos/open')
      .then(setOpen)
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])
  useEffect(() => {
    const close = openStream(() => load())
    const poll = setInterval(load, 10_000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [load])

  const discountCents = Math.max(0, Math.round(Number(discount || 0) * 100))

  // Re-priced by the server on every change: the total a cashier reads must be
  // the one the backend will actually charge, never one the browser worked out.
  useEffect(() => {
    if (!active) return setQuote(null)
    let cancelled = false
    api<{ bill: Quote }>('/staff/pos/quote', { body: { orderId: active.orderId, discountCents } })
      .then((r) => !cancelled && setQuote(r.bill))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, discountCents])

  const finalise = async () => {
    if (!active) return
    setBusy(true)
    try {
      const r = await api<{ invoice: Invoice }>('/staff/pos/finalise', {
        body: { orderId: active.orderId, discountCents, discountReason: discountCents ? 'Counter discount' : '' },
      })
      setInvoice(r.invoice)
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const openInvoice = async (invoiceId: number) => {
    try {
      const r = await api<{ invoice: Invoice }>(`/staff/pos/invoice/${invoiceId}`)
      setActive(null)
      setInvoice(r.invoice)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  const grouped = useMemo(() => {
    const g = new Map<string, OpenBill[]>()
    for (const b of open?.unbilled ?? []) {
      const key = b.serviceMode === 'car' ? 'Roadside' : b.serviceMode === 'dine_in' ? 'Dine-in' : 'Counter & takeaway'
      g.set(key, [...(g.get(key) ?? []), b])
    }
    return [...g.entries()]
  }, [open])

  if (!open) return <LoadingBlock label="Loading the till…" />

  const nothing = open.unbilled.length === 0 && open.awaitingPayment.length === 0

  return (
    <>
      <div className="staff-head">
        <div className="spacer" />
        <span className="tiny muted">
          {open.unbilled.length} to bill · {open.awaitingPayment.length} awaiting payment
        </span>
      </div>

      {nothing ? (
        <EmptyState emoji="🧾" title="Nothing to settle" body="Orders appear here the moment they are placed." />
      ) : (
        <div className="pos">
          <div className="pos-list">
            {open.awaitingPayment.length > 0 && (
              <section className="pos-group">
                <h2 className="pos-group-head">Billed, not paid</h2>
                {open.awaitingPayment.map((b) => (
                  <button key={b.invoiceId} className="pos-row due" onClick={() => openInvoice(b.invoiceId)}>
                    <span className="pos-row-icon">{MODE_ICON[b.serviceMode] ?? '🧾'}</span>
                    <span className="pos-row-main">
                      <span className="pos-row-title">{b.place || b.number}</span>
                      <span className="tiny muted mono">{b.number}</span>
                    </span>
                    <span className="pos-row-money">
                      <span className="pos-due">{money(b.dueCents)}</span>
                      {b.paidCents > 0 && <span className="tiny muted">{money(b.paidCents)} paid</span>}
                    </span>
                  </button>
                ))}
              </section>
            )}

            {grouped.map(([label, bills]) => (
              <section key={label} className="pos-group">
                <h2 className="pos-group-head">{label}</h2>
                {bills.map((b) => (
                  <button
                    key={b.orderId}
                    className={`pos-row ${active?.orderId === b.orderId ? 'on' : ''}`}
                    onClick={() => {
                      setInvoice(null)
                      setDiscount('')
                      setActive(b)
                    }}
                  >
                    <span className="pos-row-icon">{MODE_ICON[b.serviceMode] ?? '🧾'}</span>
                    <span className="pos-row-main">
                      <span className="pos-row-title">{b.place}</span>
                      <span className="tiny muted mono">
                        {b.orderNumber} · {b.status.toLowerCase()}
                      </span>
                    </span>
                    <span className="pos-row-money">{money(b.totalCents)}</span>
                  </button>
                ))}
              </section>
            ))}
          </div>

          <aside className="pos-panel">
            {invoice ? (
              <PaymentPanel
                invoice={invoice}
                onPaid={(inv) => {
                  setInvoice(inv)
                  load()
                }}
                onDone={() => {
                  setInvoice(null)
                  setActive(null)
                  load()
                }}
              />
            ) : !active ? (
              <p className="muted pos-hint">Pick a bill on the left.</p>
            ) : (
              <>
                <header className="pos-panel-head">
                  <span className="pos-panel-place">{active.place}</span>
                  <span className="tiny muted mono">{active.orderNumber}</span>
                </header>

                {!quote ? (
                  <LoadingBlock />
                ) : (
                  <>
                    <ul className="pos-items">
                      {quote.lines.map((l, i) => (
                        <li key={i}>
                          <span>
                            {l.quantity} × {l.name}
                          </span>
                          <span className="mono">{money(l.grossCents)}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="field">
                      <label htmlFor="disc">Discount (₹)</label>
                      <input
                        id="disc"
                        className="input"
                        value={discount}
                        onChange={(e) => setDiscount(e.target.value.replace(/[^0-9.]/g, ''))}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </div>

                    <dl className="pos-totals">
                      <div>
                        <dt>Subtotal</dt>
                        <dd>{money(quote.subtotalCents)}</dd>
                      </div>
                      {quote.discountCents > 0 && (
                        <div className="off">
                          <dt>Discount</dt>
                          <dd>−{money(quote.discountCents)}</dd>
                        </div>
                      )}
                      {quote.taxCents > 0 && (
                        <>
                          <div>
                            <dt>Taxable</dt>
                            <dd>{money(quote.taxableCents)}</dd>
                          </div>
                          {quote.cgstCents > 0 && (
                            <>
                              <div>
                                <dt>CGST</dt>
                                <dd>{money(quote.cgstCents)}</dd>
                              </div>
                              <div>
                                <dt>SGST</dt>
                                <dd>{money(quote.sgstCents)}</dd>
                              </div>
                            </>
                          )}
                          {quote.igstCents > 0 && (
                            <div>
                              <dt>IGST</dt>
                              <dd>{money(quote.igstCents)}</dd>
                            </div>
                          )}
                        </>
                      )}
                      <div className="grand">
                        <dt>Total</dt>
                        <dd>{money(quote.totalCents)}</dd>
                      </div>
                    </dl>

                    <button className="btn btn-accent btn-lg btn-block" disabled={busy} onClick={finalise}>
                      {busy ? <Spinner /> : 'Bill & take payment'}
                    </button>
                  </>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </>
  )
}

const METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'upi', label: 'UPI' },
  { key: 'card', label: 'Card' },
]

/** Taking the money. Split is simply more than one payment on the same bill. */
function PaymentPanel({
  invoice,
  onPaid,
  onDone,
}: {
  invoice: Invoice
  onPaid: (i: Invoice) => void
  onDone: () => void
}) {
  const toast = useToast()
  const [method, setMethod] = useState('cash')
  const [amount, setAmount] = useState('')
  const [tendered, setTendered] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setAmount((invoice.dueCents / 100).toFixed(2))
  }, [invoice.dueCents])

  const amountCents = Math.round(Number(amount || 0) * 100)
  const tenderedCents = Math.round(Number(tendered || 0) * 100)
  const change = method === 'cash' && tenderedCents > amountCents ? tenderedCents - amountCents : 0
  const settled = invoice.dueCents <= 0

  const take = async () => {
    setBusy(true)
    try {
      const r = await api<{ invoice: Invoice; changeCents: number }>('/staff/pos/pay', {
        body: {
          invoiceId: invoice.id,
          amountCents,
          method,
          tenderedCents: method === 'cash' && tenderedCents > 0 ? tenderedCents : undefined,
        },
      })
      if (r.changeCents > 0) toast(`Change ${money(r.changeCents)}`, 'info')
      setTendered('')
      onPaid(r.invoice)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="pos-panel-head">
        <span className="pos-panel-place mono">{invoice.number}</span>
        <span className={`badge ${settled ? 'badge-open' : ''}`}>{invoice.paymentStatus.replace(/_/g, ' ')}</span>
      </header>

      <dl className="pos-totals">
        <div className="grand">
          <dt>Total</dt>
          <dd>{money(invoice.totalCents)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>{money(invoice.paidCents)}</dd>
        </div>
        <div className={invoice.dueCents > 0 ? 'off' : ''}>
          <dt>Balance</dt>
          <dd>{money(invoice.dueCents)}</dd>
        </div>
      </dl>

      {invoice.payments.filter((p) => !p.isRefund).length > 0 && (
        <ul className="pos-taken">
          {invoice.payments
            .filter((p) => !p.isRefund)
            .map((p, i) => (
              <li key={i}>
                {p.method.toUpperCase()} {money(p.amountCents)}
                {p.changeCents ? <span className="tiny muted"> · change {money(p.changeCents)}</span> : null}
              </li>
            ))}
        </ul>
      )}

      {settled ? (
        <button className="btn btn-accent btn-lg btn-block" onClick={onDone}>
          Done
        </button>
      ) : (
        <>
          <div className="pos-methods">
            {METHODS.map((m) => (
              <button
                key={m.key}
                className={`pos-method ${method === m.key ? 'on' : ''}`}
                onClick={() => setMethod(m.key)}
                aria-pressed={method === m.key}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="field">
            <label htmlFor="amt">Amount (₹)</label>
            <input
              id="amt"
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
            />
            <p className="tiny muted">Take less than the balance to split across methods.</p>
          </div>

          {method === 'cash' && (
            <div className="field">
              <label htmlFor="tend">Cash received (₹)</label>
              <input
                id="tend"
                className="input"
                value={tendered}
                onChange={(e) => setTendered(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="optional"
              />
              {change > 0 && <p className="pos-change">Change {money(change)}</p>}
            </div>
          )}

          <button
            className="btn btn-accent btn-lg btn-block"
            disabled={busy || amountCents <= 0}
            onClick={take}
          >
            {busy ? <Spinner /> : `Take ${money(amountCents)}`}
          </button>
        </>
      )}
    </>
  )
}
