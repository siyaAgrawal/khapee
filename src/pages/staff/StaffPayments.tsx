import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, openStream } from '../../lib/api'
import { EmptyState, LoadingBlock, money, timeAgo, useToast } from '../../components/ui'

type Payment = {
  id: number
  orderNumber: string
  payerName: string
  amountCents: number
  orderTotalCents: number
  method: string
  status: 'CLAIMED' | 'CONFIRMED' | 'REJECTED'
  upiRef: string
  tableLabel: string | null
  groupCode: string | null
  createdAt: string
}

export default function StaffPayments() {
  const toast = useToast()
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    api<{ payments: Payment[] }>('/staff/payments')
      .then((r) => setPayments(r.payments))
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])

  useEffect(() => {
    const close = openStream(() => load())
    const poll = setInterval(load, 10000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [load])

  const settle = async (payment: Payment, accept: boolean) => {
    setBusyId(payment.id)
    try {
      await api(`/staff/payments/${payment.id}/confirm`, { body: { accept } })
      toast(accept ? `₹ payment confirmed for #${payment.orderNumber}` : 'Marked as not received', accept ? 'good' : 'info')
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  const waiting = payments?.filter((p) => p.status === 'CLAIMED') ?? []
  const settled = payments?.filter((p) => p.status !== 'CLAIMED') ?? []

  return (
    <>
      <div className="staff-head">
        <h1>Payments</h1>
        {waiting.length > 0 && <span className="badge badge-warn">{waiting.length} to check</span>}
      </div>

      <div className="notice mb-2">
        <span aria-hidden>🏦</span>
        <div>
          <strong>Money arrives in your own UPI account</strong>
          <p className="tiny">
            Tablo builds the payment request and records what the customer says they sent. Check your
            own UPI app, then confirm here — nothing is marked paid until you do.
          </p>
        </div>
      </div>

      {!payments ? (
        <LoadingBlock />
      ) : payments.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No payments yet"
          body="When a customer pays through the app, their claim shows up here for you to confirm."
        />
      ) : (
        <>
          {waiting.length > 0 && (
            <section className="card card-pad mb-2">
              <h2 style={{ marginBottom: 8 }}>Waiting for you</h2>
              {waiting.map((p) => (
                <div key={p.id} className="list-row">
                  <div style={{ minWidth: 0 }}>
                    <strong>
                      {money(p.amountCents)} · {p.payerName || 'Customer'}
                    </strong>
                    <p className="tiny muted">
                      #{p.orderNumber}
                      {p.tableLabel ? ` · ${p.tableLabel}` : ''}
                      {p.groupCode ? ` · group ${p.groupCode}` : ''} · {timeAgo(p.createdAt)}
                      {p.upiRef ? ` · UTR ${p.upiRef}` : ' · no reference given'}
                    </p>
                  </div>
                  <span className="spacer" />
                  <button className="btn btn-accent btn-sm" disabled={busyId === p.id} onClick={() => settle(p, true)}>
                    Received
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => settle(p, false)}>
                    Not received
                  </button>
                </div>
              ))}
            </section>
          )}

          {settled.length > 0 && (
            <section className="card card-pad">
              <h2 style={{ marginBottom: 8 }}>Settled</h2>
              {settled.map((p) => (
                <div key={p.id} className="list-row">
                  <div style={{ minWidth: 0 }}>
                    <strong>
                      {money(p.amountCents)} · {p.payerName || 'Customer'}
                    </strong>
                    <p className="tiny muted">
                      #{p.orderNumber} · {timeAgo(p.createdAt)}
                      {p.upiRef ? ` · UTR ${p.upiRef}` : ''}
                    </p>
                  </div>
                  <span className="spacer" />
                  <span className={`badge ${p.status === 'CONFIRMED' ? 'badge-open' : 'badge-closed'}`}>
                    {p.status === 'CONFIRMED' ? 'Confirmed' : 'Not received'}
                  </span>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </>
  )
}
