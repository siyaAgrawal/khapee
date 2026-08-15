import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import PayPanel from '../components/PayPanel'
import { api, ApiError, openStream } from '../lib/api'
import { clearGroup, readGroup } from '../lib/group'
import { EmptyState, LoadingBlock, Modal, money, Spinner, useToast } from '../components/ui'
import { QRCanvas } from '../lib/qr'
import { STATUS_LABEL, type OrderStatus } from '../../shared/orders'

type PayScope = 'mine' | 'all' | 'amount'

export default function GroupSession() {
  const handle = readGroup()
  const navigate = useNavigate()
  const toast = useToast()
  const [session, setSession] = useState<any>(null)
  const [memberId, setMemberId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [payScope, setPayScope] = useState<PayScope | null>(null)
  const [payRequest, setPayRequest] = useState<any>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!handle) return
    try {
      const r = await api<{ session: any; memberId: number }>(
        `/groups/session/state?groupToken=${encodeURIComponent(handle.token)}`,
      )
      setSession(r.session)
      setMemberId(r.memberId)
      setError('')
    } catch (e) {
      setError((e as ApiError).message)
    }
  }, [handle?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const close = openStream(() => load())
    const poll = setInterval(load, 5000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [load])

  if (!handle) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <EmptyState
            emoji="👥"
            title="You're not in a group"
            body="Start one from a restaurant page, or scan a friend's group QR to join theirs."
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

  if (error && !session) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <EmptyState
            emoji="⚠️"
            title="That group is no longer available"
            body={error}
            action={
              <button
                className="btn btn-accent"
                onClick={() => {
                  clearGroup()
                  navigate('/restaurants')
                }}
              >
                Leave group
              </button>
            }
          />
        </main>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <LoadingBlock label="Loading your table…" />
        </main>
      </div>
    )
  }

  const me = session.members.find((m: any) => m.id === memberId)
  const isHost = !!me?.isHost
  const closed = session.status === 'CLOSED'
  const joinUrl = `${window.location.origin}/g/${session.code}`

  const requestPayment = async (scope: PayScope) => {
    setBusy(true)
    try {
      const body: any = { groupToken: handle.token, scope }
      if (scope === 'amount') body.amountCents = Math.round(Number(customAmount) * 100)
      const r = await api<any>('/groups/session/payment-request', { body })
      setPayRequest(r)
      setPayScope(scope)
    } catch (e) {
      const err = e as ApiError
      if ((err as any).status === 409) toast(err.message, 'info')
      else toast(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const confirmPaid = async (upiRef: string) => {
    setBusy(true)
    try {
      const body: any = { groupToken: handle.token, scope: payScope, upiRef }
      if (payScope === 'amount') body.amountCents = Math.round(Number(customAmount) * 100)
      const r = await api<{ session: any }>('/groups/session/paid', { body })
      setSession(r.session)
      setPayRequest(null)
      setPayScope(null)
      toast('Sent to the restaurant to confirm', 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const closeSession = async () => {
    setBusy(true)
    try {
      const r = await api<{ session: any }>('/groups/session/close', { body: { groupToken: handle.token } })
      setSession(r.session)
      toast('Group closed', 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <Header />
      <main className="page page-narrow">
        <div className="card card-pad group-head">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <span className="tiny muted">{session.restaurantName}</span>
              <h1 style={{ fontSize: 26 }}>{session.tableLabel}</h1>
            </div>
            <span className={`badge ${closed ? 'badge-closed' : 'badge-accent badge-live'}`}>
              {closed ? 'Closed' : 'Open'}
            </span>
          </div>

          <div className="row row-wrap" style={{ marginTop: 12, gap: 10 }}>
            <span className="group-code mono">{session.code}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setShareOpen(true)}>
              Invite the table
            </button>
            {session.order && (
              <Link className="btn btn-ghost btn-sm" to={`/order/${session.order.orderNumber}`}>
                #{session.order.orderNumber}
              </Link>
            )}
          </div>

          {session.order && (
            <p className="tiny muted" style={{ marginTop: 10 }}>
              <strong>{STATUS_LABEL[session.order.status as OrderStatus]}</strong>
            </p>
          )}
        </div>

        {!closed && (
          <div className="row" style={{ margin: '14px 0' }}>
            <Link className="btn btn-accent btn-block" to={`/r/${session.restaurantId}`}>
              Add food to this table
            </Link>
          </div>
        )}

        <section className="card card-pad">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2>Table order</h2>
            <span className="tiny muted">{session.members.length} people</span>
          </div>

          {session.totalCents === 0 && (
            <p className="tiny muted">Nothing ordered yet</p>
          )}

          {session.members.map((m: any) => (
            <div key={m.id} className={`group-member ${m.id === memberId ? 'is-me' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>
                  {m.name}
                  {m.isHost && <span className="badge badge-info" style={{ marginLeft: 8 }}>Host</span>}
                  {m.id === memberId && <span className="tiny muted" style={{ marginLeft: 8 }}>you</span>}
                </strong>
                {m.totalCents > 0 && (
                  <span className={`badge ${m.paid ? 'badge-open' : 'badge-warn'}`}>
                    {m.paid ? 'Paid' : 'Unpaid'}
                  </span>
                )}
              </div>
              {m.items.length === 0 ? (
                <p className="tiny muted" style={{ marginTop: 4 }}>
                  Hasn&rsquo;t ordered yet
                </p>
              ) : (
                <ul className="group-items">
                  {m.items.map((i: any) => (
                    <li key={i.id}>
                      <span>
                        {i.quantity} × {i.name}
                      </span>
                      <span className={i.paid ? 'muted' : ''}>
                        {money(i.unitPriceCents * i.quantity)}
                        {i.paid && ' ✓'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {m.totalCents > 0 && (
                <div className="group-member-total tiny">
                  <span>Subtotal</span>
                  <strong>{money(m.totalCents)}</strong>
                </div>
              )}
            </div>
          ))}

          <div className="summary-total">
            <span>Group total</span>
            <span>{money(session.totalCents)}</span>
          </div>
          {session.claimedCents > 0 && (
            <div className="summary-row">
              <span>Awaiting confirmation</span>
              <span>{money(session.claimedCents)}</span>
            </div>
          )}
          <div className="summary-row">
            <span>Still to pay</span>
            <span>{money(session.remainingCents)}</span>
          </div>
        </section>

        {!closed && session.totalCents > 0 && (
          <section className="card card-pad mt-3">
            <h2 style={{ marginBottom: 4 }}>Settle up</h2>
            <p className="tiny muted mb-2">
              {session.acceptsUpi
                ? 'Pay by UPI, or tell the restaurant you paid at the counter.'
                : 'This restaurant takes payment at the counter.'}
            </p>
            <div className="stack">
              <button
                className="btn btn-accent"
                disabled={busy || !me || me.unpaidCents === 0}
                onClick={() => requestPayment('mine')}
              >
                Pay for my items{me && me.unpaidCents > 0 ? ` · ${money(me.unpaidCents)}` : ''}
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy || session.remainingCents === 0}
                onClick={() => requestPayment('all')}
              >
                Pay the whole group bill · {money(Math.max(0, session.remainingCents - session.claimedCents))}
              </button>
              <div className="row">
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="Split — enter an amount"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                />
                <button
                  className="btn btn-ghost"
                  disabled={busy || !Number(customAmount)}
                  onClick={() => requestPayment('amount')}
                >
                  Pay
                </button>
              </div>
            </div>
          </section>
        )}

        {isHost && !closed && (
          <div className="center mt-3">
            <button className="btn btn-ghost" onClick={closeSession} disabled={busy}>
              {busy ? <Spinner /> : 'End group session'}
            </button>
          </div>
        )}

        {closed && (
          <div className="center mt-3">
            <p className="tiny muted mb-2">This table is settled and closed.</p>
            <button
              className="btn btn-secondary"
              onClick={() => {
                clearGroup()
                navigate('/restaurants')
              }}
            >
              Done
            </button>
          </div>
        )}

        <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Invite the table">
          <div className="center">
            <div className="code-display">{session.code}</div>
            <div style={{ display: 'grid', placeItems: 'center', margin: '16px 0' }}>
              <QRCanvas value={joinUrl} size={220} />
            </div>
            <p className="tiny mono muted" style={{ wordBreak: 'break-all' }}>
              {joinUrl}
            </p>
          </div>
        </Modal>

        <Modal
          open={!!payRequest}
          onClose={() => {
            setPayRequest(null)
            setPayScope(null)
          }}
          title="Pay"
        >
          {payRequest && (
            <PayPanel
              amountCents={payRequest.amountCents}
              upiLink={payRequest.upiLink}
              payeeName={payRequest.payeeName}
              vpa={payRequest.vpa}
              busy={busy}
              onPaid={confirmPaid}
              label={payScope === 'mine' ? 'Your items' : payScope === 'all' ? 'Whole group bill' : 'Your share'}
            />
          )}
        </Modal>
      </main>
    </div>
  )
}
