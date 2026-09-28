import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { EmptyState, LoadingBlock, money, useToast } from '../../components/ui'
import { howOrdered } from '../../../shared/orders'
import { thanksText, waAppLink, waLink } from '../../../shared/thanks'

/**
 * Every order this restaurant has taken, and who placed it.
 *
 * The board is about tonight and forgets on purpose. Everything before tonight
 * was reachable only by scrolling it, which meant the questions that actually
 * come in — the lady who ordered on Tuesday and left her scarf, the number that
 * rang about a missing dish, what that regular has every Friday — could not be
 * answered at all. They are all the same question with a different handle on
 * it: a name, a phone number, a date, a dish. So all four find a row.
 */
type Row = {
  id: number
  orderNumber: string
  createdAt: string
  status: string
  serviceMode: string
  serviceType?: string
  place: string
  customerName: string
  customerPhone: string
  items: { name: string; quantity: number }[]
  itemCount: number
  totalCents: number
  paidCents: number
  paymentStatus: string
  methods: string[]
  invoiceNumber: string
}

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 365, label: 'A year' },
]

/** The date, written the way somebody asking about it would say it — with the
    year once it is not this year's, so last Diwali is not mistaken for this. */
function day(iso: string): string {
  const d = new Date(String(iso).replace(' ', 'T') + 'Z')
  return d.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  })
}
function at(iso: string): string {
  return new Date(String(iso).replace(' ', 'T') + 'Z').toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function StaffHistory() {
  const toast = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [days, setDays] = useState(7)
  const [shown, setShown] = useState(50)
  const [busy, setBusy] = useState<number | 'all' | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api<{ rows: Row[]; total: number }>(
        `/staff/history?days=${days}&limit=${shown}&q=${encodeURIComponent(q.trim())}`,
      )
      setRows(r.rows)
      setTotal(r.total)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }, [days, shown, q, toast])

  /** One order out of the history, after saying which one. */
  const removeOne = async (o: Row) => {
    const who = [o.customerName, o.customerPhone].filter(Boolean).join(', ')
    if (
      !window.confirm(
        `Remove order #${o.orderNumber}${who ? ` (${who})` : ''} from ${day(o.createdAt)}?` +
          '\n\nThis cannot be undone. Its invoice, if any, is kept.',
      )
    ) {
      return
    }
    setBusy(o.id)
    try {
      await api(`/staff/orders/${o.id}/remove`, { body: {} })
      toast(`Removed order #${o.orderNumber}.`, 'good')
      await load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(null)
    }
  }

  /**
   * All of it. Counted first and the count shown, including any orders still
   * being made, because those go too — the same as Clear history on the board.
   */
  const removeAll = async () => {
    setBusy('all')
    try {
      const look = await api<{ total: number; active: number }>('/staff/orders/clear', {
        body: { dryRun: true },
      })
      if (!look.total) {
        toast('There is no order history to clear.', 'info')
        return
      }
      const warning = look.active
        ? `\n\n${look.active} of them ${look.active === 1 ? 'is' : 'are'} still in progress and will be deleted too.`
        : ''
      if (
        !window.confirm(
          `Delete all ${look.total} order${look.total === 1 ? '' : 's'} for this restaurant — every date, not just the ones shown?${warning}` +
            '\n\nThis cannot be undone. Invoices are kept.',
        )
      ) {
        return
      }
      const r = await api<{ cleared: number }>('/staff/orders/clear', { body: {} })
      toast(`Cleared ${r.cleared} order${r.cleared === 1 ? '' : 's'}.`, 'good')
      await load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(null)
    }
  }

  // Typing searches, but not on every keystroke — a query per letter across a
  // year of orders is work nobody asked for.
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  return (
    <>
      <div className="staff-controls">
        <input
          className="input input-sm order-search"
          value={q}
          onChange={(e) => {
            setShown(50)
            setQ(e.target.value)
          }}
          placeholder="Name, phone, order number, table or dish…"
          aria-label="Search past orders"
        />
        <div className="tabs" style={{ marginBottom: 0 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={`tab ${days === r.days ? 'active' : ''}`}
              onClick={() => {
                setShown(50)
                setDays(r.days)
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="tiny muted">
          {total} order{total === 1 ? '' : 's'}
        </span>
        <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={removeAll}>
          {busy === 'all' ? 'Clearing…' : 'Clear history'}
        </button>
      </div>

      {!rows ? (
        <LoadingBlock label="Looking back…" />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🔎"
          title={q ? 'Nothing matches that' : 'No orders in this period'}
          body={
            q
              ? 'Try part of a name, the last few digits of a phone number, or a dish.'
              : 'Widen the dates above to look further back.'
          }
        />
      ) : (
        <>
          <div className="card ledger-wrap">
            <table className="ledger ledger-history">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Where</th>
                  <th>What they had</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td className="tiny ledger-when">
                      <strong>{day(o.createdAt)}</strong>
                      <div className="muted">{at(o.createdAt)}</div>
                    </td>
                    <td className="ledger-order">
                      <Link className="mono" to={`/staff/table/${o.id}`}>
                        #{o.orderNumber}
                      </Link>
                      {o.invoiceNumber && <div className="tiny muted mono">{o.invoiceNumber}</div>}
                    </td>
                    <td className="ledger-who">
                      {o.customerName || <span className="muted">—</span>}
                      {/* Tappable, because the reason anybody is on this
                          screen is usually that they need to ring them. */}
                      {o.customerPhone ? (
                        <div className="tiny">
                          <a className="o-phone" href={`tel:${o.customerPhone.replace(/[^0-9+]/g, '')}`}>
                            📞 {o.customerPhone}
                          </a>
                          {/* The same thank-you as on the board, from the
                              restaurant's own WhatsApp — for the regular who
                              came in on Tuesday as much as tonight's table. */}
                          {!!waLink(o.customerPhone, '') && (
                            <a
                              className="btn btn-ghost btn-sm history-thank"
                              href={waAppLink(o.customerPhone, thanksText(o.customerName || 'there'))}
                              target="_blank"
                              rel="noreferrer"
                              title={`Thank ${o.customerName || 'them'} on WhatsApp`}
                            >
                              Thank on WhatsApp
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="tiny muted">No number</div>
                      )}
                    </td>
                    <td className="tiny ledger-place">
                      <span className={`how-tag how-${howOrdered(o.serviceType ?? o.serviceMode).key}`}>
                        <span aria-hidden>{howOrdered(o.serviceType ?? o.serviceMode).icon}</span>{' '}
                        {howOrdered(o.serviceType ?? o.serviceMode).label}
                      </span>
                      {o.place && !/^(Counter|Delivery)$/.test(o.place) && <div className="muted">{o.place}</div>}
                    </td>
                    <td className="ledger-items tiny">
                      {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                    </td>
                    <td className="ledger-total">
                      <strong>{money(o.totalCents)}</strong>
                    </td>
                    <td className="ledger-paid">
                      <span className={`badge ${o.paymentStatus === 'PAID' ? 'badge-open' : 'badge-warn'}`}>
                        {o.paymentStatus === 'PAID' ? 'Paid' : 'Unpaid'}
                      </span>
                      {o.methods.length > 0 && (
                        <div className="tiny muted">{o.methods.join(' + ').toUpperCase()}</div>
                      )}
                    </td>
                    <td className="ledger-remove">
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy !== null}
                        onClick={() => void removeOne(o)}
                        aria-label={`Remove order ${o.orderNumber}`}
                      >
                        {busy === o.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length < total && (
            <div className="center mt-3">
              <button className="btn btn-secondary" onClick={() => setShown((n) => n + 50)}>
                Show 50 more
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
