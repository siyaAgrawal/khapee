import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { useCart } from '../lib/cart'
import { useSession } from '../lib/session'
import { EmptyState, LoadingBlock, Modal, money, Spinner, useToast, mmss } from '../components/ui'
import { QRScanner } from '../lib/qr'
import { clearTableContext, readTableContext, rememberReceipt, saveTableContext } from '../lib/table-context'
import PayPanel from '../components/PayPanel'
import VerifyModal from '../components/VerifyModal'
import { clearDining, readDining, saveDining, type DiningSession } from '../lib/dining'

type Mode = 'dine_in' | 'pickup'
type Table = { id: number; label: string; seats: number }

export default function Checkout() {
  const { cart, count, totalCents, clear } = useCart()
  const { user } = useSession()
  const navigate = useNavigate()
  const toast = useToast()

  const restaurantId = cart.restaurantId
  const [mode, setMode] = useState<Mode | null>(null)

  // dine-in verification
  const scanned = restaurantId ? readTableContext(restaurantId) : null
  const [verifiedCode, setVerifiedCode] = useState<string | null>(null)
  const [codeSeconds, setCodeSeconds] = useState(0)
  const [tableToken, setTableToken] = useState<string | null>(scanned?.tableToken ?? null)
  const [tableId, setTableId] = useState<number | null>(scanned?.tableId ?? null)
  const [tableLabel, setTableLabel] = useState<string | null>(scanned?.tableLabel ?? null)
  const [entryTab, setEntryTab] = useState<'code' | 'scan'>('code')
  const [codeInput, setCodeInput] = useState('')
  const [checking, setChecking] = useState(false)

  const [tables, setTables] = useState<Table[] | null>(null)
  const [name, setName] = useState(user?.name ?? '')
  const [note, setNote] = useState('')
  const [payMethod, setPayMethod] = useState<'counter' | 'app'>('counter')
  const [error, setError] = useState('')
  const [placing, setPlacing] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [takeaway, setTakeaway] = useState(false)
  const [options, setOptions] = useState<any>(null)
  const [payRequest, setPayRequest] = useState<any>(null)
  const [dining, setDining] = useState<DiningSession | null>(() =>
    restaurantId ? readDining(restaurantId) : null,
  )
  const [verifyOpen, setVerifyOpen] = useState(false)

  useEffect(() => {
    if (user?.name && !name) setName(user.name)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!restaurantId) return
    api<any>(`/orders/payment-options/${restaurantId}`)
      .then(setOptions)
      .catch(() => setOptions(null))
  }, [restaurantId])

  useEffect(() => {
    if (mode !== 'dine_in' || !restaurantId) return
    api<{ tables: Table[] }>(`/orders/tables/${restaurantId}`)
      .then((r) => setTables(r.tables))
      .catch(() => setTables([]))
  }, [mode, restaurantId])

  // Live countdown so the customer can see their code is about to lapse.
  useEffect(() => {
    if (!verifiedCode || codeSeconds <= 0) return
    const t = setInterval(() => setCodeSeconds((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [verifiedCode, codeSeconds])

  const verified = !!verifiedCode || !!tableToken || !!dining?.active

  const submitCode = async (value: string) => {
    if (!restaurantId) return
    const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    setError('')
    setChecking(true)
    try {
      const r = await api<{ ok: true; code: string; secondsLeft: number }>('/orders/verify-code', {
        body: { restaurantId, code },
      })
      setVerifiedCode(r.code)
      setCodeSeconds(r.secondsLeft)
      toast('Code accepted — pick your table', 'good')
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setChecking(false)
    }
  }

  const handleScan = useCallback(
    async (value: string) => {
      setScanOpen(false)
      setError('')
      try {
        const r = await api<any>('/resolve', { body: { value } })
        if (r.restaurantId !== restaurantId) {
          setError(`That QR belongs to ${r.restaurantName}, not ${cart.restaurantName}.`)
          return
        }
        if (r.kind === 'table') {
          setTableToken(r.tableToken)
          setTableId(r.tableId)
          setTableLabel(r.tableLabel)
          saveTableContext({
            restaurantId: r.restaurantId,
            restaurantName: r.restaurantName,
            tableId: r.tableId,
            tableLabel: r.tableLabel,
            tableToken: r.tableToken,
          })
          toast(`Scanned ${r.tableLabel}`, 'good')
        } else {
          await submitCode(r.code)
        }
      } catch (e) {
        setError((e as ApiError).message)
      }
    },
    [restaurantId, cart.restaurantName], // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** Pickup and pay-now orders show the UPI request before the order is sent. */
  const startPayment = async () => {
    if (!restaurantId) return
    setError('')
    setPlacing(true)
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
      if ((err as any).status === 409) {
        // No UPI set up — fall back to paying at the restaurant.
        setPayMethod('counter')
        await placeOrder()
        return
      }
      setError(err.message)
    } finally {
      setPlacing(false)
    }
  }

  const effectiveTableId = tableId ?? dining?.tableId ?? null
  const effectiveTableLabel = tableLabel ?? dining?.tableLabel ?? null

  const placeOrder = async (paymentClaim?: { upiRef: string }) => {
    if (!restaurantId) return
    setError('')
    setPlacing(true)
    try {
      const r = await api<{ order: any }>('/orders', {
        body: {
          restaurantId,
          type: mode,
          takeaway: mode === 'dine_in' && takeaway,
          items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          customerName: name.trim(),
          note,
          paymentMethod: paymentClaim ? 'app' : mode === 'dine_in' ? payMethod : 'counter',
          accessCode: verifiedCode,
          tableToken,
          tableId: effectiveTableId,
          sessionToken: dining?.token ?? null,
          paymentClaim: paymentClaim ? { upiRef: paymentClaim.upiRef } : null,
        },
      })
      rememberReceipt(r.order.orderNumber, r.order.verifyToken)
      if (r.order.sessionToken) {
        saveDining({
          token: r.order.sessionToken,
          restaurantId: restaurantId!,
          restaurantName: cart.restaurantName,
          restaurantEmoji: '🍽️',
          tableId: effectiveTableId,
          tableLabel: effectiveTableLabel,
          source: 'payment',
          active: true,
          secondsLeft: 4 * 3600,
        })
      }
      clear()
      clearTableContext()
      navigate(`/order/${r.order.orderNumber}`, { replace: true })
    } catch (e) {
      setError((e as ApiError).message)
      setPlacing(false)
      setPayRequest(null)
    }
  }

  if (!restaurantId || count === 0) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <EmptyState
            emoji="🛒"
            title="Nothing to check out"
            body="Add a few items to your cart first."
            action={
              <Link className="btn btn-accent" to="/restaurants">
                Browse restaurants
              </Link>
            }
          />
        </main>
      </div>
    )
  }

  const payingNow = mode === 'dine_in' && payMethod === 'app' && options?.acceptsUpi
  const canPlace =
    !!mode &&
    name.trim().length >= 2 &&
    (mode === 'pickup' ||
      ((verified || payingNow) && (takeaway || !!effectiveTableId))) &&
    !placing

  const step = !mode ? 1 : mode === 'pickup' ? 2 : (verified || payingNow) && (effectiveTableId || takeaway) ? 3 : 2
  const payNow = mode === 'pickup' || payMethod === 'app'

  return (
    <div className="app">
      <Header />
      <main className="page page-narrow">
        <h1 style={{ marginBottom: 4 }}>Checkout</h1>
        <p className="muted mb-2">
          {count} item{count > 1 ? 's' : ''} from {cart.restaurantName} · {money(totalCents)}
        </p>

        <div className="steps">
          <div className={`step ${step > 1 ? 'done' : 'current'}`}>
            <span className="step-dot">{step > 1 ? '✓' : '1'}</span> Where
          </div>
          <span className="step-line" />
          <div className={`step ${step > 2 ? 'done' : step === 2 ? 'current' : ''}`}>
            <span className="step-dot">{step > 2 ? '✓' : '2'}</span> Verify
          </div>
          <span className="step-line" />
          <div className={`step ${step === 3 ? 'current' : ''}`}>
            <span className="step-dot">3</span> Confirm
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="mode-grid">
          <button
            className={`mode-card ${mode === 'dine_in' ? 'selected' : ''}`}
            onClick={() => {
              setMode('dine_in')
              setError('')
            }}
          >
            <span className="mode-emoji">🍽️</span>
            <strong>I&rsquo;m at the restaurant</strong>
            <span>Scan the table QR or enter the staff access code, then pick your table.</span>
          </button>
          {options?.acceptsPickup !== false && (
            <button
              className={`mode-card ${mode === 'pickup' ? 'selected' : ''}`}
              onClick={() => {
                setMode('pickup')
                setError('')
              }}
            >
              <span className="mode-emoji">🥡</span>
              <strong>Order for pickup</strong>
              <span>We&rsquo;ll have it ready. Show your order number when you arrive.</span>
            </button>
          )}
        </div>

        {mode === 'dine_in' && options?.acceptsTakeaway !== false && (
          <div className="seg" role="group" aria-label="How are you eating?">
            <button className={`seg-btn ${!takeaway ? 'active' : ''}`} onClick={() => setTakeaway(false)}>
              🍽️ Eat at the table
            </button>
            <button className={`seg-btn ${takeaway ? 'active' : ''}`} onClick={() => setTakeaway(true)}>
              🥡 Takeaway
            </button>
          </div>
        )}

        {mode === 'dine_in' && (
          <section className="card card-pad mt-3">
            {dining?.active ? (
              <div className="verified-banner">
                <span>✓</span>
                <div style={{ flex: 1 }}>
                  You&rsquo;re at {dining.restaurantName}
                  {dining.tableLabel ? ` · ${dining.tableLabel}` : ''}
                  <span className="tiny" style={{ display: 'block', fontWeight: 500 }}>
                    {dining.source === 'payment'
                      ? 'Verified by your payment'
                      : 'Session open — no code needed'}
                  </span>
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
            ) : verified ? (
              <div className="verified-banner">
                <span>✓</span>
                <div style={{ flex: 1 }}>
                  {tableToken && tableLabel ? `${tableLabel} confirmed by QR` : `Access code ${verifiedCode} accepted`}
                  {verifiedCode && codeSeconds > 0 && (
                    <span className="tiny" style={{ display: 'block', fontWeight: 500 }}>
                      Valid for another <span className="countdown">{mmss(codeSeconds)}</span>
                    </span>
                  )}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setVerifiedCode(null)
                    setTableToken(null)
                    setTableId(null)
                    setTableLabel(null)
                    clearTableContext()
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <h2 style={{ marginBottom: 4 }}>Confirm you&rsquo;re here</h2>
                <p className="tiny muted mb-2">
                  Ask a staff member for the access code, or scan the QR on your table.
                </p>
                <div className="stack mb-2">
                  <button className="btn btn-accent" onClick={() => setVerifyOpen(true)}>
                    Scan QR or enter code
                  </button>
                  {options?.acceptsUpi && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setPayMethod('app')
                        setError('')
                      }}
                    >
                      …or just pay through the app
                    </button>
                  )}
                  <p className="tiny muted">
                    Paying through the app verifies you at the table — no code needed.
                  </p>
                </div>

                <div className="tabs">
                  <button className={`tab ${entryTab === 'code' ? 'active' : ''}`} onClick={() => setEntryTab('code')}>
                    Enter code
                  </button>
                  <button className={`tab ${entryTab === 'scan' ? 'active' : ''}`} onClick={() => setEntryTab('scan')}>
                    Scan QR
                  </button>
                </div>

                {entryTab === 'code' ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      submitCode(codeInput)
                    }}
                  >
                    <div className="field">
                      <input
                        className="input input-code"
                        value={codeInput}
                        onChange={(e) => setCodeInput(e.target.value.toUpperCase().slice(0, 6))}
                        placeholder="K7X92P"
                        maxLength={6}
                        autoComplete="off"
                        autoCapitalize="characters"
                        aria-label="Restaurant access code"
                      />
                      <span className="hint">Six characters, shown on the restaurant&rsquo;s screen.</span>
                    </div>
                    <button className="btn btn-accent btn-block" disabled={codeInput.length !== 6 || checking}>
                      {checking ? <Spinner /> : 'Verify code'}
                    </button>
                  </form>
                ) : (
                  <>
                    <QRScanner onResult={handleScan} />
                    <p className="tiny muted center">
                      Camera blocked?{' '}
                      <button className="btn btn-ghost btn-sm" onClick={() => setEntryTab('code')}>
                        Type the code instead
                      </button>
                    </p>
                  </>
                )}
              </>
            )}

            {(verified || payingNow) && takeaway && (
              <p className="tiny muted" style={{ marginTop: 14 }}>
                Takeaway — we&rsquo;ll call your order number at the counter, no table needed.
              </p>
            )}

            {(verified || payingNow) && !takeaway && (
              <>
                <h2 style={{ margin: '18px 0 4px' }}>Your table</h2>
                <p className="tiny muted mb-2">Tap the number on your table.</p>
                {!tables ? (
                  <LoadingBlock label="Loading tables…" />
                ) : tables.length === 0 ? (
                  <p className="tiny muted">This restaurant has no tables set up yet. Ask a staff member.</p>
                ) : (
                  <div className="table-grid">
                    {tables.map((t) => (
                      <button
                        key={t.id}
                        className={`table-btn ${tableId === t.id ? 'selected' : ''}`}
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
              </>
            )}
          </section>
        )}

        {mode && (verified || payingNow || mode === 'pickup') && (
          <section className="card card-pad mt-3">
            <h2 style={{ marginBottom: 12 }}>{mode === 'pickup' ? 'Pickup details' : 'Almost there'}</h2>
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
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 300))}
                placeholder="Less spicy, no onions…"
              />
            </div>

            {mode === 'dine_in' && (
              <div className="field">
                <label>How would you like to pay?</label>
                <div className="mode-grid" style={{ margin: '4px 0 0' }}>
                  <button
                    className={`mode-card ${payMethod === 'counter' ? 'selected' : ''}`}
                    style={{ padding: '14px 16px' }}
                    onClick={() => setPayMethod('counter')}
                  >
                    <strong style={{ fontSize: 15 }}>Pay at the restaurant</strong>
                    <span>Cash, card or UPI — however they normally take it.</span>
                  </button>
                  <button
                    className={`mode-card ${payMethod === 'app' ? 'selected' : ''}`}
                    style={{ padding: '14px 16px' }}
                    onClick={() => setPayMethod('app')}
                  >
                    <strong style={{ fontSize: 15 }}>Pay through the app</strong>
                    <span>Staff confirm and mark your bill paid on their side.</span>
                  </button>
                </div>
              </div>
            )}

            <div className="summary-total" style={{ marginBottom: 16 }}>
              <span>Total</span>
              <span>{money(totalCents)}</span>
            </div>

            <button
              className="btn btn-accent btn-lg btn-block"
              disabled={!canPlace}
              onClick={() => (payNow && options?.acceptsUpi ? startPayment() : placeOrder())}
            >
              {placing ? (
                <Spinner />
              ) : payNow && options?.acceptsUpi ? (
                `Pay ${money(totalCents)} with UPI`
              ) : (
                `Place order · ${money(totalCents)}`
              )}
            </button>
            {mode === 'dine_in' && !takeaway && !tableId && (
              <p className="tiny muted center" style={{ marginTop: 10 }}>
                Choose your table to continue.
              </p>
            )}
            {mode === 'pickup' && !options?.acceptsUpi && (
              <p className="tiny muted center" style={{ marginTop: 10 }}>
                This restaurant takes payment when you collect.
              </p>
            )}
          </section>
        )}

        <VerifyModal
          open={verifyOpen}
          onClose={() => setVerifyOpen(false)}
          restaurantId={restaurantId}
          onVerified={(sess) => setDining(sess)}
        />

        <Modal open={scanOpen} onClose={() => setScanOpen(false)} title="Scan QR">
          <QRScanner onResult={handleScan} />
        </Modal>

        <Modal open={!!payRequest} onClose={() => setPayRequest(null)} title="Pay for your order">
          {payRequest && (
            <PayPanel
              amountCents={payRequest.amountCents}
              upiLink={payRequest.upiLink}
              payeeName={payRequest.payeeName}
              vpa={payRequest.vpa}
              busy={placing}
              onPaid={(upiRef) => placeOrder({ upiRef })}
              onCancel={() => setPayRequest(null)}
            />
          )}
        </Modal>
      </main>
    </div>
  )
}
