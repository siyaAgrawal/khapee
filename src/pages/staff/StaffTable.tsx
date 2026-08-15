import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, openStream } from '../../lib/api'
import { LoadingBlock, money, Modal, Spinner, clockTime, useToast } from '../../components/ui'
import { nextStatus, STATUS_LABEL, type OrderStatus } from '../../../shared/orders'

type Bill = any
type Item = { id: number; name: string; section: string; priceCents: number }

/**
 * One table, everything on it: what was ordered through the app, what a waiter
 * added by hand, who owes what, and the bill to settle at the counter.
 */
export default function StaffTable() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [bill, setBill] = useState<Bill | null>(null)
  const [order, setOrder] = useState<any>(null)
  const [menu, setMenu] = useState<Item[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [b, orders] = await Promise.all([
        api<{ bill: Bill }>(`/staff/bill/${id}`),
        api<{ orders: any[] }>('/staff/orders?scope=all'),
      ])
      setBill(b.bill)
      setOrder(orders.orders.find((o) => String(o.id) === id) ?? null)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }, [id, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const close = openStream(() => load())
    return () => close()
  }, [load])

  useEffect(() => {
    api<{ categories: any[] }>('/staff/menu')
      .then((r) =>
        setMenu(
          r.categories.flatMap((c: any) =>
            c.items.map((i: any) => ({ id: i.id, name: i.name, section: c.name, priceCents: i.priceCents })),
          ),
        ),
      )
      .catch(() => setMenu([]))
  }, [])

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? menu.filter((i) => i.name.toLowerCase().includes(q)) : menu
    return list.slice(0, 60)
  }, [menu, search])

  const pickedCount = Object.values(picked).reduce((n, q) => n + q, 0)

  const addItems = async () => {
    setBusy(true)
    try {
      await api(`/staff/orders/${id}/items`, {
        body: { items: Object.entries(picked).map(([menuItemId, quantity]) => ({ menuItemId, quantity })) },
      })
      setPicked({})
      setAddOpen(false)
      await load()
      toast('Added to the table', 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const settle = async (method: string) => {
    setBusy(true)
    try {
      await api(`/staff/bill/${id}/settle`, { body: { method } })
      await load()
      toast('Bill settled', 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const advance = async (to: OrderStatus) => {
    setBusy(true)
    try {
      await api(`/staff/orders/${id}/status`, { body: { status: to } })
      await load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  if (!bill) return <LoadingBlock />

  const next = order ? nextStatus(order.serviceType ?? order.type, order.status) : null

  return (
    <>
      <div className="staff-head">
        <button className="icon-btn" onClick={() => navigate('/staff/orders')} aria-label="Back">
          ←
        </button>
        <h1>{bill.tableLabel ?? 'Counter'}</h1>
        <span className="mono tiny muted">#{bill.orderNumber}</span>
        <div className="spacer" />
        {order && <span className="badge">{STATUS_LABEL[order.status as OrderStatus]}</span>}
        {next && (
          <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => advance(next)}>
            {STATUS_LABEL[next]}
          </button>
        )}
      </div>

      <div className="edit-grid">
        <section className="card card-pad">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2>On the table</h2>
            <button className="btn btn-secondary btn-sm" onClick={() => setAddOpen(true)}>
              + Add
            </button>
          </div>

          {bill.byPerson.map((person: any) => (
            <div key={person.name} className="group-member">
              <strong>{person.name}</strong>
              <ul className="group-items">
                {person.items.map((i: any) => (
                  <li key={i.id}>
                    <span>
                      {i.quantity} × {i.name}
                      {i.addedByStaff && <span className="tiny muted"> · added here</span>}
                    </span>
                    <span className={i.paid ? 'muted' : ''}>
                      {money(i.lineTotal)}
                      {i.paid && ' ✓'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="summary-total">
            <span>Total</span>
            <span>{money(bill.totalCents)}</span>
          </div>
          {bill.paidCents > 0 && (
            <div className="summary-row">
              <span>Paid</span>
              <span>{money(bill.paidCents)}</span>
            </div>
          )}
          {bill.claimedCents > 0 && (
            <div className="summary-row">
              <span>Awaiting confirmation</span>
              <span>{money(bill.claimedCents)}</span>
            </div>
          )}
        </section>

        <section className="card card-pad">
          <h2 style={{ marginBottom: 10 }}>Bill</h2>
          <div className="bill-due">
            <span className="tiny muted">Due</span>
            <strong>{money(bill.dueCents)}</strong>
          </div>

          {bill.closed ? (
            <span className="badge badge-open">Settled</span>
          ) : (
            <div className="stack">
              {(['Cash', 'Card', 'UPI'] as const).map((m) => (
                <button
                  key={m}
                  className={m === 'Cash' ? 'btn btn-accent' : 'btn btn-secondary'}
                  disabled={busy}
                  onClick={() => settle(m.toLowerCase())}
                >
                  {busy ? <Spinner /> : `Settle · ${m}`}
                </button>
              ))}
            </div>
          )}

          <button className="btn btn-ghost btn-block mt-3" onClick={() => window.print()}>
            Print
          </button>

          <div className="bill-print">
            <h3>{bill.restaurant.name}</h3>
            <p className="tiny">{bill.restaurant.address}</p>
            <p className="tiny">
              #{bill.orderNumber} · {bill.tableLabel ?? 'Counter'} · {clockTime(bill.placedAt)}
            </p>
            <table>
              <tbody>
                {bill.items.map((i: any) => (
                  <tr key={i.id}>
                    <td>{i.quantity}×</td>
                    <td>{i.name}</td>
                    <td>{money(i.unitPriceCents * i.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <strong>Total {money(bill.totalCents)}</strong>
            </p>
          </div>
        </section>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add to this table" wide>
        <input
          className="input"
          placeholder="Search the menu"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="add-list">
          {results.map((i) => (
            <div key={i.id} className="list-row">
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{i.name}</strong>
                <p className="tiny muted">
                  {i.section} · {money(i.priceCents)}
                </p>
              </div>
              <span className="spacer" />
              {picked[i.id] ? (
                <div className="stepper">
                  <button
                    onClick={() =>
                      setPicked((p) => {
                        const n = { ...p }
                        if (n[i.id] > 1) n[i.id]--
                        else delete n[i.id]
                        return n
                      })
                    }
                  >
                    −
                  </button>
                  <span>{picked[i.id]}</span>
                  <button onClick={() => setPicked((p) => ({ ...p, [i.id]: p[i.id] + 1 }))}>+</button>
                </div>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={() => setPicked((p) => ({ ...p, [i.id]: 1 }))}>
                  Add
                </button>
              )}
            </div>
          ))}
        </div>
        <button className="btn btn-accent btn-lg btn-block" disabled={!pickedCount || busy} onClick={addItems}>
          {busy ? <Spinner /> : `Add ${pickedCount || ''}`.trim()}
        </button>
      </Modal>
    </>
  )
}
