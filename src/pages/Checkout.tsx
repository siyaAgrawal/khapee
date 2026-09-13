import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import PayPanel from '../components/PayPanel'
import VerifyModal from '../components/VerifyModal'
import { api, ApiError } from '../lib/api'
import { useCart } from '../lib/cart'
import { useSession } from '../lib/session'
import { clearDining, readDining, saveDining, type DiningSession } from '../lib/dining'
import { saveGroup } from '../lib/group'
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
   * Eating in and takeaway both need proof you are at the restaurant — a table
   * QR, a staff code, or paying up front — because the kitchen starts on them
   * straight away. Collecting later needs none of that. Defaulting everyone to
   * "at a table" sent anyone ordering from home into the one path that cannot
   * complete, and answered them with an instruction to scan a QR they are
   * nowhere near.
   */
  const [where, setWhere] = useState<Where>(() => {
    const session = restaurantId ? readDining(restaurantId) : null
    const atTheRestaurant = !!session || !!(restaurantId && readTableContext(restaurantId))
    return atTheRestaurant ? 'here' : 'later'
  })
  const [tables, setTables] = useState<Table[] | null>(null)
  const [tableId, setTableId] = useState<number | null>(dining?.tableId ?? null)
  const [tableLabel, setTableLabel] = useState<string | null>(dining?.tableLabel ?? null)
  const [name, setName] = useState(user?.name ?? '')
  const [note, setNote] = useState('')
  const [payNow, setPayNow] = useState(false)
  const [options, setOptions] = useState<any>(null)

  /** Eating in and takeaway are ordered at the restaurant; collecting is not. */
  const needsPresence = where === 'here' || where === 'takeaway'
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
      .then((r) => setTables(r.tables))
      .catch(() => setTables([]))
  }, [restaurantId])

  useEffect(() => {
    if (user?.name && !name) setName(user.name)
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
  const verified = !!dining?.active
  const canPayInApp = !!options?.acceptsUpi

  // What still stands between the customer and their food.
  const needsTable = where === 'here' && !seated
  const needsProof = where !== 'later' && !verified && !payNow
  const needsName = name.trim().length < 2
  const ready = !needsTable && !needsProof && !needsName

  const startPayment = async () => {
    setPlacing(true)
    setError('')
    try {
      const r = await api<any>('/orders/payment-request', {
        body: {
          restaurantId,
          items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
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
          note,
          paymentMethod: paymentClaim ? 'app' : 'counter',
          tableId: seated,
          sessionToken: withSession ?? dining?.token ?? null,
          paymentClaim: paymentClaim ? { upiRef: paymentClaim.upiRef } : null,
        },
      })
      const order = r.order
      rememberReceipt(order.orderNumber, order.verifyToken)
      // The room this order opened — so friends can join without any extra step.
      if (order.groupToken && order.roomCode) {
        saveGroup({ token: order.groupToken, code: order.roomCode, restaurantId })
      }
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
      clearTableContext()
      navigate(`/order/${order.orderNumber}`, { replace: true })
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

        {/* Where is this going? */}
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

        {needsPresence && !hasPresence && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {where === 'here' ? 'Eating in' : 'Takeaway'} needs the table QR or a staff code — you order it at the
            restaurant. To order from here, choose <strong>Collect later</strong>.
          </p>
        )}

        <section className="card card-pad">
          {/* Table — only when eating in */}
          {where === 'here' && (
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

          {/* Payment — and the shortcut it unlocks */}
          {where !== 'later' && (
            <div className="field">
              <label>Paying</label>
              <div className="seg" style={{ margin: 0 }}>
                <button className={`seg-btn ${!payNow ? 'active' : ''}`} onClick={() => setPayNow(false)}>
                  At the restaurant
                </button>
                {canPayInApp && (
                  <button className={`seg-btn ${payNow ? 'active' : ''}`} onClick={() => setPayNow(true)}>
                    Now, in the app
                  </button>
                )}
              </div>
              {canPayInApp ? (
                <span className="hint">No code needed.</span>
              ) : (
                <span className="hint">UPI not set up here.</span>
              )}
            </div>
          )}

          {/* The code — only mentioned when it is actually the missing piece */}
          {verified ? (
            <div className="verified-banner">
              <span>✓</span>
              <div style={{ flex: 1 }}>
                You&rsquo;re at {dining!.restaurantName}
                {dining!.tableLabel ? ` · ${dining!.tableLabel}` : ''}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  clearDining()
                  setDining(null)
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

          <div className="summary-total" style={{ marginBottom: 14 }}>
            <span>Total</span>
            <span>{money(totalCents)}</span>
          </div>

          <button
            className="btn btn-accent btn-lg btn-block"
            disabled={placing}
            onClick={() => {
              if (needsName) {
                document.getElementById('co-name')?.focus()
                toast('Add a name so the kitchen knows whose order it is.', 'info')
                return
              }
              if (needsTable) {
                document.querySelector('.table-grid')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                toast('Tap your table number.', 'info')
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
            ) : payNow && canPayInApp ? (
              `Pay ${money(totalCents)}`
            ) : needsProof ? (
              `Place order · ${money(totalCents)}`
            ) : (
              `Place order · ${money(totalCents)}`
            )}
          </button>

          {!ready && !placing && (
            <p className="tiny muted center" style={{ marginTop: 10 }}>
              {needsName
                ? 'We just need a name for the order.'
                : needsTable
                  ? 'Tap your table number above.'
                  : "Tap above and we'll ask for the code — or switch to paying in the app."}
            </p>
          )}
        </section>

        <VerifyModal
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
