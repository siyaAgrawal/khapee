import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import PayPanel from '../components/PayPanel'
import VerifyModal from '../components/VerifyModal'
import { api, ApiError } from '../lib/api'
import { useCart } from '../lib/cart'
import { useSession } from '../lib/session'
import { clearDining, readDining, saveDining, type DiningSession } from '../lib/dining'
import { clearTableContext, readTableContext, rememberReceipt } from '../lib/table-context'
import { EmptyState, LoadingBlock, Modal, money, Spinner, useToast } from '../components/ui'

type Where = 'here' | 'takeaway' | 'later'
type Table = { id: number; label: string; seats: number }

/**
 * One screen, no stages. Everything the restaurant needs is on it at once and
 * can be filled in any order — the only hard requirement is knowing where the
 * food is going, and paying in the app removes even the code step.
 */
export default function Checkout() {
  const { cart, count, totalCents, clear } = useCart()
  const { user } = useSession()
  const navigate = useNavigate()
  const toast = useToast()

  const restaurantId = cart.restaurantId
  const [dining, setDining] = useState<DiningSession | null>(() =>
    restaurantId ? readDining(restaurantId) : null,
  )

  /**
   * Opens on something the customer can actually finish.
   *
   * Eating in is what most people are doing, so it is what opens.
   *
   * This used to guess — "at a table" only if a QR had been scanned or a
   * session was already open, and "collect later" otherwise — because eating
   * in demanded a code or a scan, and sending somebody ordering from home into
   * a path that could not complete was worse than opening on the wrong tab.
   * That demand is gone: choosing the table is now the whole of it. So the
   * guess is gone too, and the common case opens first.
   */
  const [where, setWhere] = useState<Where>('here')
  const [tables, setTables] = useState<Table[] | null>(null)
  // A scanned table QR already answered "which table", so start on its answer
  // rather than an empty grid.
  const scannedTable = restaurantId ? readTableContext(restaurantId) : null
  /** Somebody at a known table asking to sit somewhere else after all. */
  const [changingTable, setChangingTable] = useState(false)
  const [tableId, setTableId] = useState<number | null>(dining?.tableId ?? scannedTable?.tableId ?? null)
  const [tableLabel, setTableLabel] = useState<string | null>(
    dining?.tableLabel ?? scannedTable?.tableLabel ?? null,
  )
  /**
   * Whoever runs this restaurant is not the customer ordering from it.
   *
   * The name is prefilled from the account as a convenience, and the account
   * that runs Revery is called Revery — so every order placed while signed in
   * to it arrived for a customer named after the restaurant. A restaurant's
   * own account gets an empty box, like anybody else standing at the counter.
   */
  const ownsThis = !!user?.restaurants?.some((r) => r.id === restaurantId)
  const [name, setName] = useState(ownsThis ? '' : (user?.name ?? ''))
  /** How the restaurant reaches this order. Not optional — see needsPhone. */
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [note, setNote] = useState('')
  const [payNow, setPayNow] = useState(false)
  const [options, setOptions] = useState<any>(null)

  /**
   * An order going to an address costs more than the dishes on it, and will not
   * go out at all under the area's minimum. Both were being promised on the way
   * in and neither shown here, so the button quoted a total the customer was
   * not going to be charged.
   */
  const isDelivery = dining?.serviceMode === 'delivery'
  const deliveryFeeCents = isDelivery ? (dining?.deliveryFeeCents ?? 0) : 0
  const payableCents = totalCents + deliveryFeeCents
  const shortOfMinimum = isDelivery ? Math.max(0, (dining?.minOrderCents ?? 0) - totalCents) : 0

  /**
   * Someone who came in through the car or delivery door has already said where
   * the food is going, and there is no table involved either way. They were
   * still being shown the table picker and stopped with "choose your table
   * number" — a question with no answer, on the two routes that exist
   * specifically to avoid sitting down.
   */
  const isCar = dining?.serviceMode === 'car'
  // Standing somewhere in a precinct: no table, no address, a landmark.
  const isNearby = dining?.serviceMode === 'precinct'
  const placeDecided = isDelivery || isCar || isNearby

  /**
   * Named for the situation, so "pay later" means something concrete — and it
   * says how, because "pay at the restaurant" reads to a lot of people as
   * cash only, and they choose it or avoid it on that assumption. Every one of
   * these counters takes a phone as readily as a note.
   */
  const payLaterLabel = isDelivery
    ? 'UPI or cash on delivery'
    : isCar
      ? 'UPI or cash at the car'
      : isNearby
        ? 'UPI or cash when it arrives'
        : where === 'later'
          ? 'UPI or cash when you collect'
          : 'UPI or cash at the restaurant'

  /** Eating in and takeaway are ordered at the restaurant; collecting is not. */
  /** Takeaway alone, now that picking a table is proof enough of being at one. */
  const needsPresence = where === 'takeaway'
  const hasPresence = !!dining || !!(restaurantId && readTableContext(restaurantId))

  const [verifyOpen, setVerifyOpen] = useState(false)
  // Set when the customer tapped the main button and only the code was missing:
  // once they verify, the order goes through without a second tap.
  const [placeAfterVerify, setPlaceAfterVerify] = useState(false)
  const [payRequest, setPayRequest] = useState<any>(null)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!restaurantId) return
    api<any>(`/orders/payment-options/${restaurantId}`).then(setOptions).catch(() => setOptions(null))
    api<{ tables: Table[] }>(`/orders/tables/${restaurantId}`)
      .then((r) => {
        setTables(r.tables)
        /**
         * A counter with no tables cannot be ordered to a table.
         *
         * Opening on "At a table" is right for a restaurant that has some,
         * and a dead end for one that has none: the grid is empty, there is
         * nothing to pick, and the order cannot be placed from the tab it
         * opened on. Every place on Khapee has tables today, so this never
         * fires — but the next one added might not, and the failure would be
         * a checkout that simply refuses to continue with nothing on screen
         * explaining why.
         */
        if (!r.tables.length) setWhere((w) => (w === 'here' ? 'later' : w))
      })
      .catch(() => setTables([]))
  }, [restaurantId])

  useEffect(() => {
    if (user?.name && !name && !ownsThis) setName(user.name)
    if (user?.phone && !phone) setPhone(user.phone)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!restaurantId || count === 0) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <EmptyState
            emoji="🛒"
            title="Nothing to order yet"
            body="Add a few things first."
            action={
              <Link className="btn btn-accent" to="/">
                Browse restaurants
              </Link>
            }
          />
        </main>
      </div>
    )
  }

  const seated = tableId ?? dining?.tableId ?? null
  const seatedLabel = tableLabel ?? dining?.tableLabel ?? null
  // Scanning the QR screwed to a table is the proof. The session it opens can
  // lapse over a long meal, and then the customer — still sitting at the table,
  // still holding the QR — was told to scan it again or go and ask staff for a
  // code. Holding its token is the same evidence scanning it again would give.
  const verified = !!dining?.active || !!scannedTable
  const canPayInApp = !!options?.acceptsUpi
  /*
   * Half open: the kitchen has gone home, so the order has to be paid for.
   *
   * Read before the payment choice is drawn rather than discovered when the
   * order is refused — offering "pay at the restaurant" on an order the
   * server will turn down for exactly that reason is the worst version of
   * this feature.
   */
  /*
   * Paying afterwards is not on offer here.
   *
   * Two reasons it can be true: the kitchen has gone home and is serving a
   * short menu it will not carry a no-show on, or this is an order to a car
   * — the one place the food is taken out to somebody already sitting in the
   * thing they will leave in.
   */
  const prepaidOnly = !!options?.prepaidOnly || (isCar && !!options?.carPrepaidOnly)
  useEffect(() => {
    // Nothing to choose when there is only one way to pay.
    if (prepaidOnly && !payNow) setPayNow(true)
  }, [prepaidOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  /** The line under the choice — what it actually means for this order. */
  const paySub = !canPayInApp
    ? 'Cash or UPI at the counter — this place has no UPI ID on Khapee yet'
    : payNow
      ? isDelivery
        ? `${cart.restaurantName} accepts the order first — if they can’t take it, they refund you`
        : where === 'here' && !placeDecided
          ? 'Paying is proof you are here — no code needed'
          : 'Pay from your own UPI app before it is made'
      : 'Cash or UPI, when you get it'

  // What still stands between the customer and their food.
  const needsTable = where === 'here' && !seated && !placeDecided
  /**
   * Takeaway still has to be proved; eating in no longer does.
   *
   * Ordering to a table used to demand a scanned QR, a staff code, or paying
   * up front, and it was asked of somebody already sitting in the room being
   * asked about. Saying which table you are at is the answer to the question
   * that gate was asking — the table is picked from this restaurant's own
   * list, and the food is carried to it — so the gate was two hoops to reach
   * an answer already given.
   *
   * Takeaway keeps it. There is no table to carry anything to, so nothing
   * about that order says the person is on the premises.
   */
  const needsProof = where === 'takeaway' && !verified && !payNow
  const needsName = name.trim().length < 2
  /**
   * A kitchen that cannot ring you has no way to say "we are out of that" or
   * "we cannot find you" — and those are the two calls that actually happen.
   * Delivery and the precinct already collected a number on the way in, so
   * they are not asked twice.
   */
  const needsPhone = !isNearby && !isDelivery && phone.replace(/\D/g, '').length < 10
  const ready = !needsTable && !needsProof && !needsName && !needsPhone

  const startPayment = async () => {
    setPlacing(true)
    setError('')
    try {
      const r = await api<any>('/orders/payment-request', {
        body: {
          restaurantId,
          items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          // So the amount asked for is the amount owed: a delivery adds a fee
          // that the dishes alone do not account for.
          sessionToken: dining?.token ?? null,
        },
      })
      setPayRequest(r)
    } catch (e) {
      const err = e as ApiError
      if ((err as any).status === 409) await place()
      else setError(err.message)
    } finally {
      setPlacing(false)
    }
  }

  const place = async (paymentClaim?: { upiRef: string }, withSession?: string) => {
    setPlacing(true)
    setError('')
    try {
      const r = await api<{ order: any }>('/orders', {
        body: {
          restaurantId,
          type: where === 'later' ? 'pickup' : 'dine_in',
          takeaway: where === 'takeaway',
          items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          customerName: name.trim(),
          contactPhone: phone.trim(),
          note,
          paymentMethod: paymentClaim ? 'app' : 'counter',
          tableId: seated,
          // The scanned QR is itself the proof of being at the table. Without
          // it the server had only the customer's word for the table number,
          // and turned the order away asking them to scan the QR they had
          // already scanned.
          tableToken: where === 'here' ? (scannedTable?.tableToken ?? null) : null,
          sessionToken: withSession ?? dining?.token ?? null,
          paymentClaim: paymentClaim ? { upiRef: paymentClaim.upiRef } : null,
        },
      })
      const order = r.order
      rememberReceipt(order.orderNumber, order.verifyToken)
      /**
       * The room this order opened stays open — and this phone stays out of it.
       *
       * It used to join itself here, on the reasoning that the person who
       * ordered is obviously at the table. The cost of that was invisible and
       * enormous: being in a group changes what the cart does — it stops being
       * an order and becomes a staging area for a shared ticket — so every
       * customer who had ever eaten in was quietly put somewhere that made
       * ordinary ordering impossible on their next visit, having never asked
       * to share anything with anybody. "You are in a group" about a table
       * they were at last week, and no way to place a simple order.
       *
       * Joining a table is now something a person does, by scanning the code
       * or opening the link. The room is still here for them; it just does not
       * reach out and take them.
       */
      if (order.sessionToken) {
        saveDining({
          token: order.sessionToken,
          restaurantId,
          restaurantName: cart.restaurantName,
          restaurantEmoji: '🍽️',
          tableId: seated,
          tableLabel: seatedLabel,
          source: 'payment',
          active: true,
          secondsLeft: 4 * 3600,
        })
      }
      clear()
      // The table is deliberately not forgotten here. A meal is rarely one
      // order — drinks, then food, then coffee — and dropping the scan after
      // the first one sent the customer back to the QR, or to staff for a
      // code, for every round after it. "End" on the dining bar is how you
      // say you have finished.
      // Said on the next screen rather than here, so the confirmation and the
      // thing being confirmed are the same page — a toast on a page that is
      // already disappearing is read by nobody.
      navigate(`/order/${order.orderNumber}`, {
        replace: true,
        state: { justPlaced: true, paid: !!paymentClaim },
      })
    } catch (e) {
      setError((e as ApiError).message)
      setPlacing(false)
      setPayRequest(null)
    }
  }

  return (
    <div className="app">
      <Header />
      <main className="page page-narrow">
        <h1 style={{ marginBottom: 4 }}>Your order</h1>
        <p className="muted mb-2">
          {count} item{count > 1 ? 's' : ''} from {cart.restaurantName}
        </p>

        {error && <div className="form-error">{error}</div>}

        {/* Where is this going? Already answered, if they came by car or asked
            for it to be brought to them. */}
        {placeDecided ? (
          <div className="verified-banner" style={{ marginBottom: 4 }}>
            <span aria-hidden>{isNearby ? '🚶' : isDelivery ? '🛵' : '🚗'}</span>
            <div style={{ flex: 1 }}>
              {isNearby ? (
                <>
                  Bringing it to <strong>{dining?.whereLabel || dining?.spotLabel}</strong>
                  {dining?.lookFor ? ` · ${dining.lookFor}` : ''}
                </>
              ) : isDelivery ? (
                <>
                  Delivering to <strong>{dining?.address || dining?.areaName}</strong>
                </>
              ) : (
                <>
                  Brought out to <strong>{dining?.vehicle || 'your car'}</strong>
                  {dining?.seqNo ? ` · Car ${dining.seqNo}` : ''}
                </>
              )}
            </div>
            <Link
              className="btn btn-ghost btn-sm"
              to={
                isNearby
                  ? `/p/${dining?.precinctSlug ?? ''}`
                  : isDelivery
                    ? `/r/${restaurantId}/delivery`
                    : `/r/${restaurantId}/car`
              }
            >
              Change
            </Link>
          </div>
        ) : (
          <div className="seg" role="group" aria-label="Where are you?">
            <button className={`seg-btn ${where === 'here' ? 'active' : ''}`} onClick={() => setWhere('here')}>
              🍽️ At a table
            </button>
            {options?.acceptsTakeaway !== false && (
              <button
                className={`seg-btn ${where === 'takeaway' ? 'active' : ''}`}
                onClick={() => setWhere('takeaway')}
              >
                🥡 Takeaway
              </button>
            )}
            {options?.acceptsPickup !== false && (
              <button className={`seg-btn ${where === 'later' ? 'active' : ''}`} onClick={() => setWhere('later')}>
                🚶 Collect later
              </button>
            )}
          </div>
        )}

        {!placeDecided && needsPresence && !hasPresence && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Takeaway needs the table QR or a staff code — you order it at the restaurant. To order from
            here, choose <strong>Collect later</strong>.
          </p>
        )}


        <section className="card card-pad">
          {/* Table — only when eating in */}
          {/*
            Already at a table: say so, do not ask again.

            Scanning the QR on table 3 is the customer saying which table they
            are at — completely, and more reliably than a grid of buttons can.
            Showing the grid anyway asked the question a second time, put the
            answer they had already given at risk of a mis-tap, and filled the
            screen of the one person who had done exactly the right thing.

            Kept changeable, because somebody scans a code, then moves to a
            bigger table, and the only thing worse than asking twice is not
            letting them correct it.
          */}
          {where === 'here' && !placeDecided && seated && !changingTable && (
            <div className="field">
              <label>Table</label>
              <div className="seated-at">
                <span>
                  <strong>{seatedLabel ?? `Table ${seated}`}</strong>
                  <em className="tiny muted">
                    {scannedTable ? ' · from the code you scanned' : ' · from your open table'}
                  </em>
                </span>
                <button type="button" className="link-btn" onClick={() => setChangingTable(true)}>
                  Change
                </button>
              </div>
            </div>
          )}

          {where === 'here' && !placeDecided && (!seated || changingTable) && (
            <div className="field">
              <label>Table</label>
              {!tables ? (
                <LoadingBlock />
              ) : (
                <div className="table-grid">
                  {tables.map((t) => (
                    <button
                      key={t.id}
                      className={`table-btn ${seated === t.id ? 'selected' : ''}`}
                      onClick={() => {
                        setTableId(t.id)
                        setTableLabel(t.label)
                        setChangingTable(false)
                        if (dining?.token) {
                          api(`/sessions/${dining.token}/table`, { body: { tableId: t.id } })
                            .then(() => {
                              const next = { ...dining, tableId: t.id, tableLabel: t.label }
                              saveDining(next)
                              setDining(next)
                            })
                            .catch(() => {})
                        }
                      }}
                    >
                      <strong>{t.label}</strong>
                      <span>{t.seats} seats</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="co-name">Name for the order</label>
            <input
              id="co-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Siya"
              autoComplete="name"
            />
          </div>

          {/* How the restaurant reaches this order. A delivery or a spot in
              the area gave a number on the way in and is not asked twice. */}
          {!isNearby && !isDelivery && (
            <div className="field">
              <label htmlFor="co-phone">Mobile number</label>
              <input
                id="co-phone"
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9+ ]/g, '').slice(0, 20))}
                placeholder="98765 43210"
                inputMode="tel"
                autoComplete="tel"
              />
              <span className="hint">
                Your confirmation comes here, and it is how the restaurant reaches you.
              </span>
            </div>
          )}

          <div className="field">
            <label htmlFor="co-note">Anything we should know? (optional)</label>
            <textarea
              id="co-note"
              className="textarea"
              style={{ minHeight: 62 }}
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 300))}
              placeholder="Less spicy, no onions…"
            />
          </div>


          {/* The code — only mentioned when it is actually the missing piece.
              A car or a delivery has said where it is going at the top already. */}
          {placeDecided ? null : verified ? (
            <div className="verified-banner">
              <span>✓</span>
              <div style={{ flex: 1 }}>
                You&rsquo;re at {dining?.restaurantName ?? scannedTable?.restaurantName ?? cart.restaurantName}
                {(dining?.tableLabel ?? scannedTable?.tableLabel)
                  ? ` · ${dining?.tableLabel ?? scannedTable?.tableLabel}`
                  : ''}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  clearDining()
                  clearTableContext()
                  setDining(null)
                  setTableId(null)
                  setTableLabel(null)
                }}
              >
                Change
              </button>
            </div>
          ) : (
            needsProof && (
              <div className="notice">
                <span aria-hidden>🔑</span>
                <div style={{ flex: 1 }}>
                  <strong>One last thing</strong>
                  <p className="tiny">
                    Ask a staff member for the code, or{' '}
                    {canPayInApp ? 'pay in the app and skip it entirely.' : 'scan the QR on your table.'}
                  </p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setVerifyOpen(true)}>
                  Scan / enter
                </button>
              </div>
            )
          )}

          {isDelivery && (
            <>
              <div className="summary-row">
                <span>Dishes</span>
                <span>{money(totalCents)}</span>
              </div>
              <div className="summary-row">
                <span>Delivery{dining?.areaName ? ` to ${dining.areaName}` : ''}</span>
                <span>{deliveryFeeCents > 0 ? money(deliveryFeeCents) : 'Free'}</span>
              </div>
            </>
          )}

          <div className="summary-total" style={{ marginBottom: 14 }}>
            <span>Total</span>
            <span>{money(payableCents)}</span>
          </div>

          {shortOfMinimum > 0 && (
            <div className="notice" style={{ marginBottom: 12 }}>
              <span aria-hidden>🛵</span>
              <div style={{ flex: 1 }}>
                <strong>{money(shortOfMinimum)} more to be delivered</strong>
                <p className="tiny">
                  {dining?.areaName ?? 'This area'} has a {money(dining?.minOrderCents ?? 0)} minimum on
                  the dishes.
                </p>
              </div>
              <Link className="btn btn-secondary btn-sm" to={`/r/${restaurantId}`}>
                Add more
              </Link>
            </div>
          )}

          {/*
            How this is being paid for, immediately above the button that does
            it — the last thing read before committing.

            Both ways are on the page, one under the other, rather than one
            line with a Change button that opened a sheet. A sheet hides the
            choice behind a tap and behind a word: somebody who does not read
            "Change" as a button never learns the other way exists, and
            somebody who does has to open, read, pick and come back to see what
            they picked. Two rows say everything at once.
          */}
          <p className="pay-head-label">Pay using</p>
          <div className="pay-picks">
            <button
              type="button"
              className={`pay-pick ${payNow ? 'on' : ''} ${canPayInApp ? '' : 'off'}`}
              onClick={() => canPayInApp && setPayNow(true)}
              disabled={!canPayInApp}
              aria-pressed={payNow}
            >
              <span className="pay-pick-icon" aria-hidden>
                ⚡
              </span>
              <strong>Any UPI app</strong>
              <span className="pay-pick-sub">
                {canPayInApp
                  ? `GPay, PhonePe, Paytm, FamApp — straight into ${cart.restaurantName}\u2019s account`
                  : `${cart.restaurantName} has not added a UPI ID to Khapee yet`}
              </span>
              <span className="pay-pick-dot" aria-hidden />
            </button>

            <button
              type="button"
              className={`pay-pick ${payNow ? '' : 'on'} ${prepaidOnly ? 'off' : ''}`}
              onClick={() => !prepaidOnly && setPayNow(false)}
              disabled={prepaidOnly}
              aria-pressed={!payNow && !prepaidOnly}
            >
              <span className="pay-pick-icon" aria-hidden>
                💵
              </span>
              <strong>{payLaterLabel}</strong>
              <span className="pay-pick-sub">
                {prepaidOnly
                  ? isCar && options?.carPrepaidOnly && !options?.prepaidOnly
                    ? 'Orders brought out to your car are paid for in the app'
                    : 'Not tonight — the kitchen has closed, so these have to be paid for in the app'
                  : isDelivery
                  ? 'Cash or UPI when it reaches you'
                  : isCar
                    ? 'Cash or UPI at the car'
                    : isNearby
                      ? 'Cash or UPI when they hand it over'
                      : 'Cash or UPI at the counter'}
              </span>
              <span className="pay-pick-dot" aria-hidden />
            </button>
          </div>
          <p className="tiny muted pay-picks-foot">{paySub}</p>

          <button
            className="btn btn-accent btn-lg btn-block"
            disabled={placing}
            onClick={() => {
              if (needsName) {
                document.getElementById('co-name')?.focus()
                toast('Add a name so the kitchen knows whose order it is.', 'info')
                return
              }
              if (needsPhone) {
                document.getElementById('co-phone')?.focus()
                toast('Add your mobile number so the restaurant can reach you.', 'info')
                return
              }
              if (needsTable) {
                document.querySelector('.table-grid')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                toast('Tap your table number.', 'info')
                return
              }
              if (shortOfMinimum > 0) {
                toast(`Add ${money(shortOfMinimum)} more — ${dining?.areaName ?? 'this area'} has a minimum.`, 'info')
                return
              }
              if (needsProof) {
                // Only the code is missing — ask for it here and continue straight on.
                setPlaceAfterVerify(true)
                setVerifyOpen(true)
                return
              }
              if (payNow && canPayInApp) startPayment()
              else place()
            }}
          >
            {placing ? (
              <Spinner />
            ) : shortOfMinimum > 0 ? (
              `Add ${money(shortOfMinimum)} more`
            ) : payNow && canPayInApp ? (
              `Pay ${money(payableCents)}`
            ) : (
              `Place order · ${money(payableCents)}`
            )}
          </button>

          {!ready && !placing && (
            <p className="tiny muted center" style={{ marginTop: 10 }}>
              {needsName
                ? 'We just need a name for the order.'
                : needsPhone
                  ? 'Add your mobile number — the restaurant may need to ring.'
                  : needsTable
                  ? 'Tap your table number above.'
                  : "Tap above and we'll ask for the code — or switch to paying in the app."}
            </p>
          )}
        </section>

        <VerifyModal
          codesEnabled={options?.codesEnabled !== false}
          open={verifyOpen}
          onClose={() => setVerifyOpen(false)}
          restaurantId={restaurantId}
          onVerified={(s) => {
            setDining(s)
            if (s.tableId) {
              setTableId(s.tableId)
              setTableLabel(s.tableLabel)
            }
            if (placeAfterVerify) {
              setPlaceAfterVerify(false)
              // The session is proof enough now; send the order with it.
              setTimeout(() => place(undefined, s.token), 0)
            }
          }}
        />

        <Modal open={!!payRequest} onClose={() => setPayRequest(null)} title="Pay for your order">
          {payRequest && (
            <PayPanel
              amountCents={payRequest.amountCents}
              upiLink={payRequest.upiLink}
              payeeName={payRequest.payeeName}
              vpa={payRequest.vpa}
              busy={placing}
              onPaid={(upiRef) => place({ upiRef })}
              onCancel={() => setPayRequest(null)}
            />
          )}
        </Modal>
      </main>
    </div>
  )
}

