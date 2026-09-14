import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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

  const flow = flowFor(order.serviceType ?? order.type)
  const currentIndex = flow.indexOf(order.status as OrderStatus)
  const cancelled = order.status === 'CANCELLED'
  const done = currentIndex === flow.length - 1

  const eventAt = (status: string) => order.events.find((e: any) => e.status === status)?.at

  return (
    <div className="app">
      <Header />
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
            <span className={`badge ${order.paymentStatus === 'PAID' ? 'badge-open' : 'badge-warn'}`}>
              {order.paymentStatus}
            </span>
          </div>
          {order.paymentStatus !== 'PAID' && (
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {order.paymentMethod === 'app'
                ? 'Staff will confirm'
                : order.serviceMode === 'delivery'
                  ? 'Pay on delivery'
                  : order.serviceMode === 'car'
                    ? 'Pay when they bring it out'
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
