import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError, openStream } from '../lib/api'
import { Art, ErrorState, LoadingBlock, clockTime, money } from '../components/ui'
import { QRCanvas } from '../lib/qr'
import { receiptToken } from '../lib/table-context'
import { readGroup } from '../lib/group'
import { flowFor, STATUS_LABEL, type OrderStatus } from '../../shared/orders'

export default function OrderTrack() {
  const { orderNumber = '' } = useParams()
  const [order, setOrder] = useState<any>(null)
  const [error, setError] = useState('')

  /**
   * The moment the order lands.
   *
   * Checkout used to hand straight over to this page, which opens on a
   * receipt and a progress bar — accurate, and no answer at all to the only
   * question being asked in that second, which is "did that work?". Shown
   * once, on arrival, and only when this page was reached by placing an order
   * rather than by opening the link again later.
   */
  const placed = (useLocation().state ?? {}) as { justPlaced?: boolean; paid?: boolean }
  const [celebrate, setCelebrate] = useState(!!placed.justPlaced)
  useEffect(() => {
    if (!celebrate) return
    const done = setTimeout(() => setCelebrate(false), 2100)
    return () => clearTimeout(done)
  }, [celebrate])

  const load = useCallback(async () => {
    try {
      const token = receiptToken(orderNumber.toUpperCase())
      const r = await api<{ order: any }>(
        `/orders/${orderNumber.toUpperCase()}${token ? `?token=${encodeURIComponent(token)}` : ''}`,
      )
      setOrder(r.order)
      setError('')
    } catch (e) {
      setError((e as ApiError).message)
    }
  }, [orderNumber])

  useEffect(() => {
    load()
  }, [load])

  // Live updates when signed in; a slow poll keeps guests current too.
  useEffect(() => {
    const close = openStream((_type, payload) => {
      if (payload?.order?.orderNumber === orderNumber.toUpperCase()) setOrder(payload.order)
    })
    const poll = setInterval(load, 6000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [load, orderNumber])

  if (error && !order) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <ErrorState message={error} onRetry={load} />
          <div className="center">
            <Link className="btn btn-secondary" to="/">
              Back to restaurants
            </Link>
          </div>
        </main>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <LoadingBlock label="Fetching your order…" />
        </main>
      </div>
    )
  }

  /**
   * The steps this order will go through, from where it actually started.
   *
   * An unpaid order waits on the kitchen's yes whatever the mode, but only
   * delivery's flow begins there — so a table or a pickup order sat at
   * REQUESTED, which appeared nowhere in its own list of steps, and the
   * tracker showed every step as "Waiting" with none of them current. The
   * customer could not tell whether anything had happened at all.
   */
  const base = flowFor(order.serviceType ?? order.type)
  const waited = order.status === 'REQUESTED' || order.events.some((e: any) => e.status === 'REQUESTED')
  // Replacing NEW rather than sitting in front of it: an order that waits for
  // a yes goes REQUESTED then ACCEPTED, so leaving NEW in the list added a
  // step that was never going to happen and would sit there unticked forever.
  const flow =
    waited && base[0] === 'NEW' ? (['REQUESTED', ...base.slice(1)] as OrderStatus[]) : base
  const currentIndex = flow.indexOf(order.status as OrderStatus)
  const cancelled = order.status === 'CANCELLED'
  const done = currentIndex === flow.length - 1

  const eventAt = (status: string) => order.events.find((e: any) => e.status === status)?.at

  return (
    <div className="app">
      <Header />
      {celebrate && (
        <div className="placed" role="status" aria-live="polite" onClick={() => setCelebrate(false)}>
          <div className="placed-mark">
            <svg viewBox="0 0 80 80" aria-hidden>
              <circle className="placed-ring" cx="40" cy="40" r="34" />
              <path className="placed-tick" d="M24 41 L35 52 L57 29" />
            </svg>
          </div>
          <strong>Order placed</strong>
          <p>
            {placed.paid
              ? `${money(order.totalCents)} sent to ${order.restaurantName}.`
              : order.status === 'REQUESTED'
                ? `${order.restaurantName} is looking at it now.`
                : `${order.restaurantName} has it.`}
          </p>
          <span className="tiny muted">#{order.orderNumber}</span>
        </div>
      )}
      <main className="page page-narrow">
        <div className="card receipt">
          <span className={`badge ${order.type === 'pickup' ? 'badge-info' : 'badge-accent'}`}>
            {order.type === 'pickup' ? 'Pickup order' : `Dine in · ${order.tableLabel}`}
          </span>
          <div className="receipt-number">#{order.orderNumber}</div>
          <p className="muted tiny">
            {order.restaurantName} · {order.customerName}
          </p>

          <QRCanvas value={`ORDRO:ORDER:${order.orderNumber}:${order.verifyToken}`} size={168} />
          <p className="tiny muted">
            {order.type === 'pickup' ? 'Show at the counter' : 'Show if asked'}
          </p>

        </div>

        <div className="card card-pad mt-3">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <h2>{cancelled ? 'Order cancelled' : done ? 'All done' : 'Live status'}</h2>
            {!cancelled && !done && <span className="badge badge-accent badge-live">Live</span>}
          </div>

          {cancelled ? (
            <p className="muted tiny">
              This order was cancelled by the restaurant. Please speak to a staff member if that wasn&rsquo;t
              expected.
            </p>
          ) : (
            <div className="track">
              {flow.map((status, i) => {
                const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : ''
                const at = eventAt(status)
                return (
                  <div key={status} className={`track-step ${state}`}>
                    <div className="track-rail">
                      <span className="track-bullet">{i < currentIndex ? '✓' : i + 1}</span>
                      {i < flow.length - 1 && <span className="track-line" />}
                    </div>
                    <div className="track-body">
                      <strong>{STATUS_LABEL[status]}</strong>
                      <span>
                        {at
                          ? clockTime(at)
                          : i === currentIndex + 1
                            ? 'Up next'
                            : i <= currentIndex
                              ? ''
                              : 'Waiting'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {order.roomCode && (
          <div className="card card-pad mt-3 room-card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <h2>Anyone else eating?</h2>
              <span className="group-code mono">{order.roomCode}</span>
            </div>
            <p className="tiny muted mb-2">
              They scan this and add their own food to this same table — no new order, one bill,
              and everyone can pay for just their own bit.
            </p>
            <div style={{ display: 'grid', placeItems: 'center', margin: '6px 0 10px' }}>
              <QRCanvas value={`${window.location.origin}/g/${order.roomCode}`} size={150} />
            </div>
            <div className="center">
              <Link className="btn btn-secondary btn-sm" to="/group">
                Open the table
              </Link>
            </div>
          </div>
        )}

        <div className="card card-pad mt-3">
          <h2 style={{ marginBottom: 10 }}>Your order</h2>
          {order.items.map((item: any) => (
            <div key={item.id} className="cart-line">
              <Art emoji={item.emoji} hue={200} className="cart-line-art" rounded={14} />
              <div className="cart-line-body">
                <strong>{item.name}</strong>
                <span className="tiny muted">
                  {item.quantity} × {money(item.unitPriceCents)}
                  {item.memberName ? ` · ${item.memberName}` : ''}
                </span>
              </div>
              <strong>{money(item.unitPriceCents * item.quantity)}</strong>
            </div>
          ))}
          {order.note && (
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Note: {order.note}
            </p>
          )}
          {/* Without this line the dishes add up to less than the total, and it
              reads as an arithmetic mistake rather than a delivery charge. */}
          {order.deliveryFeeCents > 0 && (
            <div className="summary-row" style={{ marginTop: 8 }}>
              <span>Delivery{order.deliveryArea ? ` to ${order.deliveryArea}` : ''}</span>
              <span>{money(order.deliveryFeeCents)}</span>
            </div>
          )}
          <div className="summary-total">
            <span>Total</span>
            <span>{money(order.totalCents)}</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span className="tiny muted">Payment</span>
            {/* "Sent" is its own answer. Telling somebody who has just paid
                that their order is UNPAID is wrong in the only way that
                matters to them. */}
            <span
              className={`badge ${
                order.paymentState === 'paid'
                  ? 'badge-open'
                  : order.paymentState === 'sent'
                    ? 'badge-info'
                    : 'badge-warn'
              }`}
            >
              {order.paymentState === 'paid' ? 'PAID' : order.paymentState === 'sent' ? 'PAID · UPI' : 'UNPAID'}
            </span>
          </div>
          {order.paymentState === 'sent' && (
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Sent{order.upiRef ? ` · ref ${order.upiRef}` : ''}. {order.restaurantName} confirms it against
              their own UPI app — nothing more for you to do.
            </p>
          )}
          {order.paymentState === 'unpaid' && (
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {order.serviceMode === 'delivery'
                ? 'Pay on delivery'
                : order.serviceMode === 'car'
                  ? 'Pay when they bring it out'
                  : order.serviceMode === 'precinct'
                    ? 'Pay when they hand it over'
                    : 'Pay at the restaurant'}
            </p>
          )}
        </div>

        <div className="center mt-3">
          <Link className="btn btn-secondary" to="/">
            Order something else
          </Link>
        </div>
      </main>
    </div>
  )
}
