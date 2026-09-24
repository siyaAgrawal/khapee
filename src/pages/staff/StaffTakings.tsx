import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, openStream } from '../../lib/api'
import { EmptyState, LoadingBlock, money, useToast } from '../../components/ui'

/**
 * What came in, and how it came in.
 *
 * At the end of a night somebody counts the drawer. A single "taken today"
 * figure cannot be checked against anything — it is right or wrong as a whole,
 * and when it is wrong there is nowhere to start. Split by method it
 * reconciles against two things a person can hold: the notes in the drawer,
 * and the UPI app on the phone beside it. That is the whole reason this screen
 * exists, so the split is the first thing on it and the biggest.
 */
type Payment = {
  id: number
  at: string
  amountCents: number
  method: string
  status: 'CLAIMED' | 'CONFIRMED' | 'REJECTED'
  isRefund: boolean
  payerName: string
  upiRef: string
  orderNumber: string
  tableLabel: string | null
  customerName: string
  customerPhone: string
  invoiceNumber: string
  changeCents: number | null
  reason: string
}
type Takings = {
  netCents: number
  takenCents: number
  refundedCents: number
  byMethod: { method: string; count: number; amountCents: number }[]
  awaitingCents: number
  awaitingCount: number
  payments: Payment[]
}

const RANGES = [
  { days: 0, label: 'Today' },
  { days: 6, label: '7 days' },
  { days: 29, label: '30 days' },
]

const METHOD_LOOK: Record<string, { label: string; emoji: string }> = {
  cash: { label: 'Cash', emoji: '💵' },
  upi: { label: 'UPI', emoji: '📲' },
  card: { label: 'Card', emoji: '💳' },
  app: { label: 'In the app', emoji: '📱' },
}
const look = (m: string) => METHOD_LOOK[m] ?? { label: m.toUpperCase(), emoji: '•' }

function at(iso: string): string {
  return new Date(String(iso).replace(' ', 'T') + 'Z').toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function StaffTakings() {
  const toast = useToast()
  const [data, setData] = useState<Takings | null>(null)
  const [days, setDays] = useState(0)
  const [method, setMethod] = useState('all')

  const load = useCallback(async () => {
    try {
      setData(await api<Takings>(`/staff/takings?days=${days}&method=${method}`))
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }, [days, method, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const close = openStream(() => void load())
    const poll = setInterval(() => void load(), 20000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [load])

  if (!data) return <LoadingBlock label="Counting up…" />

  /* Methods that took nothing are still shown once they exist, because a zero
     beside Cash is an answer — "no cash today" — and a missing row is not. */
  const methods = ['cash', 'upi', 'card'].map(
    (m) => data.byMethod.find((x) => x.method === m) ?? { method: m, count: 0, amountCents: 0 },
  )
  const extra = data.byMethod.filter((x) => !['cash', 'upi', 'card'].includes(x.method))

  return (
    <>
      <div className="staff-controls">
        <div className="tabs" style={{ marginBottom: 0 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={`tab ${days === r.days ? 'active' : ''}`}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="tiny muted">Money that reached you, less anything refunded.</span>
      </div>

      <div className="takings-split">
        <div className="takings-total">
          <span>Taken</span>
          <strong>{money(data.netCents)}</strong>
          {data.refundedCents > 0 && (
            <em className="tiny muted">after {money(data.refundedCents)} refunded</em>
          )}
        </div>
        {[...methods, ...extra].map((m) => (
          <button
            key={m.method}
            type="button"
            className={`takings-method ${method === m.method ? 'on' : ''}`}
            aria-pressed={method === m.method}
            onClick={() => setMethod(method === m.method ? 'all' : m.method)}
            title={`Show only ${look(m.method).label}`}
          >
            <span className="takings-emoji" aria-hidden>
              {look(m.method).emoji}
            </span>
            <span>{look(m.method).label}</span>
            <strong>{money(m.amountCents)}</strong>
            <em className="tiny muted">
              {m.count} payment{m.count === 1 ? '' : 's'}
            </em>
          </button>
        ))}
      </div>

      {data.awaitingCount > 0 && (
        <div className="notice mb-2 mt-3">
          <span aria-hidden>⏳</span>
          <div>
            <strong>
              {money(data.awaitingCents)} says it has been sent and nobody has checked
            </strong>
            <p className="tiny">
              {data.awaitingCount} customer{data.awaitingCount === 1 ? '' : 's'} paid through the app.
              Check your UPI app and confirm it under <strong>To confirm</strong> — it is not counted
              above until you do.
            </p>
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', margin: '18px 0 10px' }}>
        <h2 style={{ margin: 0 }}>
          {method === 'all' ? 'Every payment' : `${look(method).label} only`}
        </h2>
        {method !== 'all' && (
          <button className="btn btn-ghost btn-sm" onClick={() => setMethod('all')}>
            Show all
          </button>
        )}
      </div>

      {data.payments.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="Nothing here yet"
          body={
            method === 'all'
              ? 'Payments appear the moment you take one at the till.'
              : `No ${look(method).label.toLowerCase()} payments in this period.`
          }
        />
      ) : (
        <div className="card ledger-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>When</th>
                <th>Amount</th>
                <th>How</th>
                <th>Order</th>
                <th>Who</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className={p.isRefund ? 'is-refund' : ''}>
                  <td className="tiny muted">{at(p.at)}</td>
                  <td>
                    <strong>
                      {p.isRefund ? '−' : ''}
                      {money(p.amountCents)}
                    </strong>
                    {p.changeCents ? (
                      <div className="tiny muted">change {money(p.changeCents)}</div>
                    ) : null}
                  </td>
                  <td>
                    <span className="badge">{look(p.method).label}</span>
                    {p.status === 'CLAIMED' && (
                      <div className="tiny muted">not confirmed</div>
                    )}
                    {p.isRefund && <div className="tiny muted">refund</div>}
                  </td>
                  <td className="mono tiny">
                    {p.orderNumber ? `#${p.orderNumber}` : p.invoiceNumber || '—'}
                    {p.tableLabel && <div className="muted">{p.tableLabel}</div>}
                  </td>
                  <td className="tiny">
                    {p.payerName || p.customerName || '—'}
                    {p.customerPhone && <div className="muted">{p.customerPhone}</div>}
                  </td>
                  <td className="tiny muted mono">{p.upiRef || p.reason || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
