import { useCallback, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { money, Spinner, clockTime, useToast } from '../../components/ui'
import { QRScanner } from '../../lib/qr'
import { nextStatus, STATUS_LABEL, type OrderStatus } from '../../../shared/orders'

export default function StaffVerify() {
  const toast = useToast()
  const [mode, setMode] = useState<'manual' | 'scan'>('manual')
  const [value, setValue] = useState('')
  const [order, setOrder] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const lookup = useCallback(
    async (raw: string) => {
      setBusy(true)
      setError('')
      try {
        const r = await api<{ order: any; scanned: boolean }>('/staff/verify-order', { body: { value: raw } })
        setOrder(r.order)
        toast(`Found #${r.order.orderNumber}`, 'good')
      } catch (e) {
        setOrder(null)
        setError((e as ApiError).message)
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )

  const advance = async (to: OrderStatus) => {
    if (!order) return
    setBusy(true)
    try {
      const r = await api<{ order: any }>(`/staff/orders/${order.id}/status`, { body: { status: to } })
      setOrder(r.order)
      toast(`#${r.order.orderNumber} → ${STATUS_LABEL[to]}`, 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const markPaid = async () => {
    if (!order) return
    const r = await api<{ order: any }>(`/staff/orders/${order.id}/payment`, {
      body: { paymentStatus: order.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID' },
    })
    setOrder(r.order)
  }

  const next = order ? nextStatus(order.serviceType ?? order.type, order.status) : null

  return (
    <>
      <div className="staff-head">
        <h1>Verify an order</h1>
      </div>

      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(280px, 380px) 1fr', alignItems: 'start' }}>
        <div className="card card-pad">
          <div className="tabs">
            <button className={`tab ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>
              Order number
            </button>
            <button className={`tab ${mode === 'scan' ? 'active' : ''}`} onClick={() => setMode('scan')}>
              Scan QR
            </button>
          </div>

          {mode === 'manual' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                lookup(value)
              }}
            >
              <div className="field">
                <input
                  className="input input-code"
                  placeholder="A482"
                  value={value}
                  onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                  aria-label="Order number"
                />
                <span className="hint">Type the number the customer shows you.</span>
              </div>
              <button className="btn btn-accent btn-block" disabled={!value || busy}>
                {busy ? <Spinner /> : 'Look up order'}
              </button>
            </form>
          ) : (
            <>
              <QRScanner onResult={(v) => lookup(v)} />
              <p className="tiny muted center">
                Camera unavailable?{' '}
                <button className="btn btn-ghost btn-sm" onClick={() => setMode('manual')}>
                  Enter the number
                </button>
              </p>
            </>
          )}

          {error && <div className="form-error" style={{ marginTop: 14 }}>{error}</div>}
        </div>

        <div className="card card-pad">
          {!order ? (
            <div className="state-block" style={{ padding: '40px 10px' }}>
              <div className="state-emoji">🔎</div>
              <h3>No order loaded</h3>
              <p>Scan the customer&rsquo;s QR code or type their order number to pull it up.</p>
            </div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 className="mono">#{order.orderNumber}</h2>
                <span className={`badge ${order.type === 'pickup' ? 'badge-info' : 'badge-accent'}`}>
                  {order.type === 'pickup' ? 'Pickup' : order.tableLabel}
                </span>
              </div>
              <p className="muted tiny" style={{ marginTop: 4 }}>
                {order.customerName} · placed {clockTime(order.createdAt)} · {STATUS_LABEL[order.status as OrderStatus]}
              </p>

              <div className="o-items" style={{ marginTop: 14 }}>
                {order.items.map((i: any) => (
                  <div key={i.id} className="o-item">
                    <b>{i.quantity}×</b>
                    <span>{i.name}</span>
                  </div>
                ))}
              </div>

              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="o-total">{money(order.totalCents)}</span>
                <button
                  className={`badge ${order.paymentStatus === 'PAID' ? 'badge-open' : 'badge-warn'}`}
                  style={{ border: 0, cursor: 'pointer' }}
                  onClick={markPaid}
                >
                  {order.paymentStatus} — tap to change
                </button>
              </div>

              <div className="row mt-3">
                {next && (
                  <button className="btn btn-accent" disabled={busy} onClick={() => advance(next)}>
                    Mark {STATUS_LABEL[next]}
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setOrder(null)
                    setValue('')
                  }}
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
