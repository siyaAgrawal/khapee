import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError, openStream } from '../lib/api'
import { Art, ErrorState, LoadingBlock, clockTime, money } from '../components/ui'
import { QRCanvas } from '../lib/qr'
import { receiptToken } from '../lib/table-context'
import { currentEndpoint, followOrder, needsHomeScreen, pushSupported } from '../lib/push'
import { useToast } from '../components/ui'
import { readGroup } from '../lib/group'
import { flowFor, STATUS_LABEL, type OrderStatus } from '../../shared/orders'

export default function OrderTrack() {
  const { orderNumber = '' } = useParams()
  const [order, setOrder] = useState<any>(null)
  const [error, setError] = useState('')
  const toast = useToast()

  /**
   * Being told when it is ready, without anybody paying per message.
   *
   * WhatsApp bills a business for messaging somebody who has not messaged them
   * first, and there is no free allowance for it. A push notification through
   * the browser this page is already open in costs nothing, now or ever, and
   * lands on the same locked screen — so it is offered here, once, on the
   * screen somebody is looking at while they wait.
   */
  const [followKey, setFollowKey] = useState<{ available: boolean; publicKey: string } | null>(null)
  const [following, setFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)

  useEffect(() => {
    if (!pushSupported()) return
    api<{ available: boolean; publicKey: string }>('/orders/notify-key')
      .then(setFollowKey)
      .catch(() => setFollowKey(null))
    void currentEndpoint().then((e) => setFollowing(!!e))
  }, [])

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
  /**
   * Nothing here can check a UPI payment.
   *
   * The money goes from the customer's bank to the restaurant's and Khapee is
   * not in the middle of it; verifying it would need a payment gateway sitting
   * between them, taking a cut of every order. The only party who can see it
   * arrive is the restaurant, looking at their own app.
   *
   * So a tick is not claimed on the customer's word. An order paid at the
   * counter is settled the moment it is placed and says so; one paid through
   * the app waits, visibly, and the tick is drawn when the restaurant ticks it
   * off — which arrives here on its own over the live stream.
   */
  const [celebrate, setCelebrate] = useState(!!placed.justPlaced && !placed.paid)
  const [confirmedNow, setConfirmedNow] = useState(false)
  const waitingOnPayment = !!placed.justPlaced && !!placed.paid && order?.paymentState === 'sent'

  useEffect(() => {
    if (!placed.justPlaced || !placed.paid) return
    if (order?.paymentState !== 'paid' || confirmedNow) return
    setConfirmedNow(true)
    setCelebrate(true)
  }, [order?.paymentState, placed.justPlaced, placed.paid, confirmedNow])

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

  const follow = async () => {
    setFollowBusy(true)
    const r = await followOrder(orderNumber.toUpperCase(), receiptToken(orderNumber.toUpperCase()) ?? '', followKey?.publicKey ?? '')
    setFollowBusy(false)
    if (!r.ok) return toast(r.error ?? 'Could not switch updates on.', 'bad')
    setFollowing(true)
    toast(`We'll tell you when ${order.restaurantName} has it ready.`, 'good')
  }

  const canFollow = pushSupported() && !!followKey?.available && !done && !cancelled

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
          <strong>{confirmedNow ? 'Payment confirmed' : 'Order placed'}</strong>
          <p>
            {confirmedNow
              ? `${order.restaurantName} has your ${money(order.totalCents)}.`
              : order.status === 'REQUESTED'
                ? `${order.restaurantName} is looking at it now.`
                : `${order.restaurantName} has it.`}
          </p>
          <span className="tiny muted">#{order.orderNumber}</span>
        </div>
      )}
      {waitingOnPayment && (
        <div className="paying" role="status" aria-live="polite">
          <span className="paying-spin" aria-hidden />
          <div>
            <strong>Checking your payment</strong>
            <p className="tiny">
              {order.restaurantName} is matching {money(order.totalCents)}
              {order.upiRef ? ` · ref ${order.upiRef}` : ''} against their UPI app. Your order is
              already with them — this page updates itself.
            </p>
          </div>
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

        {/* Free, and the only free way to reach somebody who has closed the
            page. Offered while there is still something to be told about. */}
        {canFollow && !following && (
          <button className="follow" onClick={follow} disabled={followBusy}>
            <span className="follow-bell" aria-hidden>
              🔔
            </span>
            <span>
              <strong>Tell me when it&rsquo;s ready</strong>
              <span className="tiny">
                On this phone, even with Khapee closed. Free — no number needed.
              </span>
            </span>
          </button>
        )}
        {canFollow && following && (
          <p className="tiny muted center follow-on">
            🔔 You&rsquo;ll be told on this phone when it&rsquo;s ready.
          </p>
        )}
        {pushSupported() === false && needsHomeScreen() && !done && (
          <p className="tiny muted center follow-on">
            To be told when it&rsquo;s ready: tap Share, then Add to Home Screen, and open Khapee from
            there.
          </p>
        )}

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
