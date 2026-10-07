import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import PayPanel from '../components/PayPanel'
import { api, ApiError, openStream } from '../lib/api'
import { Art, ErrorState, LoadingBlock, Spinner, clockTime, money } from '../components/ui'
import { QRCanvas } from '../lib/qr'
import { receiptToken, rememberReceipt } from '../lib/table-context'
import { currentEndpoint, followOrder, needsHomeScreen, pushSupported } from '../lib/push'
import { useToast } from '../components/ui'
import { flowFor, isAccepted, STATUS_LABEL, type OrderStatus } from '../../shared/orders'

export default function OrderTrack() {
  const { orderNumber = '' } = useParams()
  const navigate = useNavigate()
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
  const [celebrate, setCelebrate] = useState<'accepted' | 'paid' | null>(null)
  /** Which of the two answers on this page is in flight. */
  const [busy, setBusy] = useState('')
  /** The UPI request, once the customer has chosen to pay a prepay-only order online. */
  const [payReq, setPayReq] = useState<any>(null)
  /**
   * Two minutes with no answer.
   *
   * Kept as a ticking clock rather than worked out once on load, because the
   * page is usually opened the second the order is placed and then watched —
   * so the moment that matters always arrives while somebody is looking at it.
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])
  const [confirmedNow, setConfirmedNow] = useState(false)
  const waitingOnPayment = !!placed.justPlaced && !!placed.paid && order?.paymentState === 'sent'

  /**
   * The tick belongs to the restaurant, not to the act of ordering.
   *
   * This screen used to draw a green tick and "Order placed" the instant
   * checkout handed over. Placing an order is not a restaurant agreeing to
   * cook it — the order was sitting on a board nobody had looked at yet, and
   * could still be turned down — so the tick was a promise made on the
   * kitchen's behalf without asking it. Somebody who saw it and then read
   * "could not be taken" was told two opposite things by the same screen.
   *
   * So the tick waits for the yes, which arrives here on its own over the live
   * stream. Until then there is a plainly unfinished state saying what is
   * actually happening: it has been sent, and they are looking at it.
   */
  const accepted = !!order && isAccepted(order.status as OrderStatus)
  /**
   * Whether the yes happened while somebody was watching.
   *
   * Opening the link to a week-old order is not a moment to celebrate, and a
   * tick thrown across the screen on arrival would be celebrating the act of
   * opening a page. The tick is for the transition, so there has to have been
   * something to transition from.
   */
  const sawWaiting = useRef(false)
  const tickShown = useRef(false)
  useEffect(() => {
    if (order && !accepted) sawWaiting.current = true
  }, [order, accepted])

  useEffect(() => {
    if (!accepted || tickShown.current) return
    if (!sawWaiting.current && !placed.justPlaced) return
    tickShown.current = true
    setCelebrate('accepted')
  }, [accepted, placed.justPlaced])

  useEffect(() => {
    if (!placed.justPlaced || !placed.paid) return
    if (order?.paymentState !== 'paid' || confirmedNow) return
    setConfirmedNow(true)
    setCelebrate('paid')
  }, [order?.paymentState, placed.justPlaced, placed.paid, confirmedNow])

  useEffect(() => {
    if (!celebrate) return
    const done = setTimeout(() => setCelebrate(null), 2600)
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
    const number = orderNumber.toUpperCase()
    const close = openStream(
      (_type, payload) => {
        if (payload?.order?.orderNumber === number) setOrder(payload.order)
      },
      // Follows this one order even with no account, so a refused dish or a
      // refused order reaches the screen the moment it happens rather than on
      // the next poll. See openStream.
      { orderNumber: number, receipt: receiptToken(number) ?? '' },
    )
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
  /**
   * The restaurant said no — to the whole order, not to a dish.
   *
   * DECLINED and a restaurant-side CANCELLED are the same news to whoever is
   * waiting for the food, so they read the same. A cancellation the customer
   * asked for themselves is not news and says nothing.
   */
  const turnedDown =
    order.status === 'DECLINED' ||
    (cancelled && order.declinedReason && !/customer/i.test(order.declinedReason))
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

  /*
   * Two minutes is not an arbitrary number: it is about how long somebody
   * will watch a spinner before deciding the restaurant has not seen it and
   * reaching for the phone. Offering the answer at that moment is the whole
   * point; offering it at thirty seconds would send orders again that were
   * about to be accepted.
   */
  const placedAt = Date.parse(`${String(order.createdAt ?? '').replace(' ', 'T')}Z`)
  const noAnswer =
    (order.status === 'REQUESTED' || order.status === 'NEW') &&
    !order.needsCustomerOk &&
    !order.needsPrepay &&
    Number.isFinite(placedAt) &&
    now - placedAt > 120_000

  const agree = async () => {
    setBusy('agree')
    try {
      const r = await api<{ order: any }>(`/orders/${order.orderNumber}/agree`, {
        body: { token: receiptToken(order.orderNumber) },
      })
      setOrder(r.order)
      toast('Thanks — they can carry on.', 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  /**
   * The kitchen asked for this car order to be paid online first. Opening the
   * UPI request is the first tap; the reference from their UPI app is the
   * second, and sends the order back to the kitchen marked paid.
   */
  const openPrepay = async () => {
    setBusy('prepay')
    try {
      const r = await api<any>(`/orders/${order.orderNumber}/payment-request`, {
        body: { token: receiptToken(order.orderNumber) },
      })
      setPayReq(r)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }
  const sendPrepay = async (upiRef: string) => {
    setBusy('prepay')
    try {
      const r = await api<{ order: any }>(`/orders/${order.orderNumber}/pay`, {
        body: { token: receiptToken(order.orderNumber), upiRef },
      })
      setOrder(r.order)
      setPayReq(null)
      toast(`Paid — ${order.restaurantName} has your order.`, 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const callOff = async () => {
    if (!window.confirm(`Cancel order #${order.orderNumber}? ${order.restaurantName} will be told not to make it.`)) return
    setBusy('cancel')
    try {
      await api(`/orders/${order.orderNumber}/cancel`, { body: { token: receiptToken(order.orderNumber) } })
      toast('Cancelled.', 'info')
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const resend = async () => {
    setBusy('resend')
    try {
      const r = await api<{ order: any }>(`/orders/${order.orderNumber}/resend`, {
        body: { token: receiptToken(order.orderNumber) },
      })
      rememberReceipt(r.order.orderNumber, r.order.verifyToken)
      toast('Sent again.', 'good')
      navigate(`/order/${r.order.orderNumber}`, { replace: true, state: { justPlaced: true } })
    } catch (e) {
      // The restaurant may have answered in the same second. That is good
      // news, not an error, so the page simply catches up.
      toast((e as ApiError).message, 'info')
      load()
    } finally {
      setBusy('')
    }
  }

  /*
   * Whether there is an arrival to announce.
   *
   * Only for an order placed before setting off — a table order is placed by
   * somebody already sitting at one — and only once the kitchen has agreed to
   * make it, because announcing yourself for an order nobody has accepted
   * tells a counter about somebody they cannot serve.
   */
  const canArrive =
    (order.serviceType === 'pickup' || order.type === 'pickup') &&
    accepted &&
    !order.arrivedAt &&
    !done &&
    !cancelled &&
    order.status !== 'DECLINED'

  const arrive = async (choice: 'takeaway' | 'dine_in') => {
    setBusy(choice)
    try {
      const r = await api<{ order: any }>(`/orders/${order.orderNumber}/arrived`, {
        body: { token: receiptToken(order.orderNumber), choice },
      })
      setOrder(r.order)
      toast(choice === 'dine_in' ? 'They know — find a seat.' : 'They know — it will be bagged up.', 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const canFollow = pushSupported() && !!followKey?.available && !done && !cancelled

  return (
    <div className="app">
      <Header />
      {celebrate && (
        <div className="placed" role="status" aria-live="polite" onClick={() => setCelebrate(null)}>
          <div className="placed-mark">
            <svg viewBox="0 0 80 80" aria-hidden>
              <circle className="placed-ring" cx="40" cy="40" r="34" />
              <path className="placed-tick" d="M24 41 L35 52 L57 29" />
            </svg>
          </div>
          <strong>{celebrate === 'paid' ? 'Payment confirmed' : 'Order accepted'}</strong>
          <p>
            {celebrate === 'paid'
              ? `${order.restaurantName} has your ${money(order.totalCents)}.`
              : `${order.restaurantName} is making it.`}
          </p>
          <span className="tiny muted">#{order.orderNumber}</span>
        </div>
      )}
      {/* Unfinished on purpose, and it stays until the kitchen answers. The
          honest picture of an order nobody has said yes to yet. */}
      {/*
        The kitchen cannot make something, and is waiting on an answer.

        Ahead of the "sent, waiting" strip, because this order is no longer
        waiting on them — it is waiting on the person reading this, and until
        they answer nothing else on the page is the point.
      */}
      {/*
        Turned down, said plainly and first.

        There was nothing here at all: a declined order simply stopped showing
        the "waiting for them to accept it" strip, and the page went quiet.
        From the customer's side that is indistinguishable from the order
        having evaporated — they are left looking at a receipt for food nobody
        is making, with no idea whether to wait, ring, or order again.
      */}
      {turnedDown && (
        <div className="declined" role="alert">
          <span className="declined-mark" aria-hidden>
            ✕
          </span>
          <div>
            <strong>{order.restaurantName} can&rsquo;t take this order</strong>
            <p className="tiny">
              {order.declinedReason
                ? `They said: “${order.declinedReason}”`
                : 'No reason was given.'}{' '}
              You have not been charged. Nothing is being made.
            </p>
            <Link className="btn btn-accent btn-sm mt-2" to="/">
              Order somewhere else
            </Link>
          </div>
        </div>
      )}

      {/*
        Arriving, for somebody who ordered before setting off.

        Two things in one tap, because to the person holding the phone they
        are one thing: the counter is told they are in the building, and they
        say whether they are taking it with them or sitting down. That choice
        belongs here and not at checkout — nobody twenty minutes away knows
        whether there will be a free table.
      */}
      {canArrive && (
        <div className="arrived-ask" role="group" aria-label="Let them know you are here">
          <div>
            <strong>Are you at {order.restaurantName}?</strong>
            <p className="tiny">
              Tell them you&rsquo;re here and how you want it. They&rsquo;ll bring it to you either way.
            </p>
          </div>
          <div className="arrived-acts">
            <button className="btn btn-accent" disabled={busy !== ''} onClick={() => void arrive('takeaway')}>
              {busy === 'takeaway' ? <Spinner /> : '🥡 Taking it away'}
            </button>
            <button className="btn btn-secondary" disabled={busy !== ''} onClick={() => void arrive('dine_in')}>
              {busy === 'dine_in' ? <Spinner /> : '🍽️ Eating in'}
            </button>
          </div>
        </div>
      )}

      {/* Said back, so nobody taps it twice wondering whether it went. */}
      {order.arrivedAt && !done && !cancelled && (
        <div className="arrived-done" role="status">
          <span aria-hidden>✓</span>
          <span>
            {order.restaurantName} knows you&rsquo;re here —{' '}
            <strong>
              {order.arrivalChoice === 'dine_in'
                ? order.tableLabel
                  ? `eating in at ${order.tableLabel}`
                  : 'eating in'
                : 'taking it away'}
            </strong>
            .
          </span>
        </div>
      )}

      {order.needsCustomerOk && !cancelled && (
        <div className="decided" role="alert">
          <div>
            <strong>
              {order.restaurantName} can&rsquo;t make {order.declinedItems || 'one of your items'}
            </strong>
            <p className="tiny">
              The rest is fine. Your new total is {money(order.totalCents)}.
            </p>
          </div>
          {/*
            Two answers, each saying what it does rather than what it is
            called. "Cancel the order" and "Yes, go ahead" read as a pair of
            opposites only if you already know what is being asked; spelled
            out, nobody has to work it out while their food waits.
          */}
          <div className="decided-acts">
            <button className="btn btn-accent" disabled={busy !== ''} onClick={agree}>
              {busy === 'agree' ? <Spinner /> : 'Send the rest'}
            </button>
            <button className="btn btn-ghost" disabled={busy !== ''} onClick={callOff}>
              Cancel everything
            </button>
          </div>
        </div>
      )}

      {/* The money version of a refused dish: this car order can go ahead only
          if it is paid for online. Pay, or call it off — nothing else. */}
      {order.needsPrepay && !cancelled && order.paymentState === 'unpaid' && (
        <div className="decided" role="alert">
          <div>
            <strong>{order.restaurantName} is only taking online payment for this order right now</strong>
            <p className="tiny">
              Pay {money(order.totalCents)} by UPI and your order goes straight to the kitchen — or cancel it.
            </p>
          </div>
          {payReq ? (
            <PayPanel
              amountCents={payReq.amountCents}
              upiLink={payReq.upiLink}
              payeeName={payReq.payeeName}
              vpa={payReq.vpa}
              busy={busy === 'prepay'}
              onPaid={(upiRef) => void sendPrepay(upiRef)}
              onCancel={() => setPayReq(null)}
            />
          ) : (
            <div className="decided-acts">
              <button className="btn btn-accent" disabled={busy !== ''} onClick={() => void openPrepay()}>
                {busy === 'prepay' ? <Spinner /> : 'Pay online (UPI)'}
              </button>
              <button className="btn btn-ghost" disabled={busy !== ''} onClick={callOff}>
                Cancel order
              </button>
            </div>
          )}
        </div>
      )}

      {!accepted && !cancelled && order.status !== 'DECLINED' && !order.needsCustomerOk && !order.needsPrepay && (
        <div className="paying" role="status" aria-live="polite">
          <span className="paying-spin" aria-hidden />
          <div>
            <strong>
              {order.upiOnly && order.paymentState === 'sent' ? 'Payment sent' : `Sent to ${order.restaurantName}`}
            </strong>
            <p className="tiny">
              {order.upiOnly && order.paymentState === 'sent'
                ? `${order.restaurantName} is checking your UPI payment. Once it shows up in their UPI app they accept your order \u2014 this page updates itself.`
                : noAnswer
                ? `${order.restaurantName} hasn't answered for two minutes. They may not be at the screen.`
                : 'Waiting for them to accept it. You\u2019ll see a tick here the moment they do — this page updates itself.'}
            </p>
            {/*
              Two minutes of a spinner is the point at which somebody starts
              wondering whether to ring the restaurant. Sending it again is
              the same dishes, the same table, nothing retyped — because
              anybody who has already chosen five things and then watched a
              spinner has done their part twice already.
            */}
            <div className="paying-acts">
              {noAnswer && (
                <button className="btn btn-accent btn-sm" disabled={busy !== ''} onClick={resend}>
                  {busy === 'resend' ? <Spinner /> : 'Send it again'}
                </button>
              )}
              {/* Changed their mind, or ordered from the wrong place: fine
                  until the restaurant has said yes. Not once money has been
                  sent — that is the restaurant's to cancel and refund. */}
              {order.paymentState === 'unpaid' && (order.status === 'REQUESTED' || order.status === 'NEW') && (
                <button className="btn btn-ghost btn-sm" disabled={busy !== ''} onClick={callOff}>
                  {busy === 'cancel' ? <Spinner /> : 'Cancel order'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* UPI only says this once, in the box above. */}
      {waitingOnPayment && !(order.upiOnly && !accepted) && (
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
        {/* UPI only: the ticket — "Pickup order", the number, the QR to show at
            the counter — only exists once the restaurant has accepted it. Until
            then there is nothing to collect and nothing to show anybody. */}
        {!(order.upiOnly && !accepted && !cancelled) && (
        <div className="card receipt">
          <span className={`badge ${order.type === 'pickup' ? 'badge-info' : 'badge-accent'}`}>
            {/* Where it is going, in the words the board uses. This only knew
                pickup or a table, so a car order read "Dine in · null". */}
            {order.type === 'pickup'
              ? 'Pickup order'
              : order.serviceMode && order.serviceMode !== 'dine_in'
                ? order.serviceMode === 'car'
                  ? `Car${order.zoneName ? ` · ${order.zoneName}` : ''}`
                  : order.whereLabel || (order.serviceMode === 'delivery' ? 'Delivery' : 'On its way to you')
                : order.tableLabel
                  ? `Dine in · ${order.tableLabel}`
                  : 'Dine in'}
          </span>
          <div className="receipt-number">#{order.orderNumber}</div>
          <p className="muted tiny">
            {order.restaurantName} · {order.customerName}
          </p>

          {/*
            The promise, in the words it was made in.

            An order placed for later has a moment attached to it, and the
            whole reason somebody chose that moment is that they will not be
            there before it. A tracking page that only counts up from "sent"
            is answering a question they did not ask.
          */}
          {order.wantedAt && !done && !cancelled && <ReadyFor at={order.wantedAt} />}

          <QRCanvas value={`KHAPEE:ORDER:${order.orderNumber}:${order.verifyToken}`} size={168} />
          <p className="tiny muted">
            {order.type === 'pickup' ? 'Show at the counter' : 'Show if asked'}
          </p>

        </div>
        )}

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

        {/* Saving the number, as one tap.
            The thank-you arrives on WhatsApp from eleven digits nobody
            recognises, and "Thanks for ordering" from an unknown number reads
            like the opening of a scam. WhatsApp shows a business name instead
            of its number only on Meta's paid platform, after verification and
            a display-name review — but a contact somebody has saved beats all
            of that, for nothing, forever. The obstacle was never permission;
            it was that saving a number by hand is four fiddly steps. This is
            the same four, already done. */}
        {order.restaurantHasPhone && (
          <a className="follow save-us" href={`/r/${order.restaurantId}/khapee.vcf`}>
            <span className="follow-bell" aria-hidden>
              💬
            </span>
            <span>
              <strong>Save {order.restaurantName} to your contacts</strong>
              <span className="tiny">
                So our WhatsApp message shows a name and not a strange number. One tap — your phone
                fills it in.
              </span>
            </span>
          </a>
        )}
        {pushSupported() === false && needsHomeScreen() && !done && (
          <p className="tiny muted center follow-on">
            To be told when it&rsquo;s ready: tap Share, then Add to Home Screen, and open Khapee from
            there.
          </p>
        )}

        <div className="card card-pad mt-3">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <h2>
              {order.status === 'DECLINED'
                ? 'Not taken'
                : cancelled
                  ? 'Order cancelled'
                  : done
                    ? 'All done'
                    : 'Live status'}
            </h2>
            {!cancelled && !done && order.status !== 'DECLINED' && (
              <span className="badge badge-accent badge-live">Live</span>
            )}
          </div>

          {cancelled || order.status === 'DECLINED' ? (
            <p className="muted tiny">
              {order.declinedReason
                ? `${order.restaurantName} said: “${order.declinedReason}”`
                : `This order was cancelled. Please speak to ${order.restaurantName} if that wasn’t expected.`}
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
            {/* The link rather than /group, because this phone is not in the
                room until somebody says so. Opening it is that saying-so. */}
            <div className="center">
              <Link className="btn btn-secondary btn-sm" to={`/g/${order.roomCode}`}>
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
                {item.options && <span className="tiny item-options">{item.options}</span>}
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
                ? 'UPI or cash on delivery'
                : order.serviceMode === 'car'
                  ? 'UPI or cash when they bring it out'
                  : order.serviceMode === 'precinct'
                    ? 'UPI or cash when they hand it over'
                    : 'UPI or cash at the restaurant'}
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

/**
 * "Ready for 9:30."
 *
 * Stated as a time rather than a countdown. A countdown on a page somebody
 * checks twice while driving is a thing to watch; a time is a thing to plan
 * around, and planning around it is the entire point of having chosen it.
 */
function ReadyFor({ at }: { at: string }) {
  const when = new Date(`${String(at).replace(' ', 'T')}Z`)
  if (Number.isNaN(when.getTime())) return null
  return (
    <p className="ready-for">
      Ready for <strong>{when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong>
      <span className="tiny muted">You don’t wait for it. It waits for you.</span>
    </p>
  )
}
