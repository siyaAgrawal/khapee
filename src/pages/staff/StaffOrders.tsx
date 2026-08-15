import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, openStream } from '../../lib/api'
import { EmptyState, LoadingBlock, money, timeAgo, useToast, clockTime } from '../../components/ui'
import { Link } from 'react-router-dom'
import { announceOrder, askToNotify, notifyPermission } from '../../lib/notify'
import {
  nextStatus,
  SERVICE_LABEL,
  STATUS_LABEL,
  type OrderStatus,
  type ServiceType,
} from '../../../shared/orders'

/** Keeps each person's items together on a shared group ticket. */
function groupByPerson(items: any[]): { name: string; items: any[] }[] {
  const buckets = new Map<string, any[]>()
  for (const item of items) {
    const key = item.memberName ?? 'Table'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(item)
  }
  return [...buckets.entries()].map(([name, list]) => ({ name, items: list }))
}

type Order = any

const COLUMNS: { key: string; title: string; statuses: OrderStatus[] }[] = [
  { key: 'new', title: 'New', statuses: ['NEW'] },
  { key: 'accepted', title: 'Accepted', statuses: ['ACCEPTED'] },
  { key: 'preparing', title: 'Preparing', statuses: ['PREPARING'] },
  { key: 'ready', title: 'Ready', statuses: ['READY', 'READY_FOR_PICKUP'] },
  { key: 'done', title: 'Completed', statuses: ['COMPLETED', 'PICKED_UP', 'CANCELLED'] },
]

export default function StaffOrders() {
  const toast = useToast()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [summary, setSummary] = useState<any>(null)
  const [filter, setFilter] = useState<'all' | 'dine_in' | 'pickup'>('all')
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<'board' | 'list'>('board')
  const [alerts, setAlerts] = useState(notifyPermission())
  const knownIds = useRef<Set<number>>(new Set())
  const firstLoad = useRef(true)

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([
        api<{ orders: Order[] }>(`/staff/orders?scope=${scope}`),
        api<{ summary: any }>('/staff/summary'),
      ])
      if (!firstLoad.current) {
        const fresh = o.orders.filter((x) => x.status === 'NEW' && !knownIds.current.has(x.id))
        if (fresh.length === 1) toast(`New order #${fresh[0].orderNumber}`, 'good')
        else if (fresh.length > 1) toast(`${fresh.length} new orders came in`, 'good')
        for (const order of fresh) {
          const where = order.serviceType === 'dine_in' ? order.tableLabel : 'Counter'
          announceOrder(
            order.orderNumber,
            `${where} · ${order.customerName} · ${order.items.reduce((n: number, i: any) => n + i.quantity, 0)} items · ${money(order.totalCents)}`,
          )
        }
      }
      knownIds.current = new Set(o.orders.map((x) => x.id))
      firstLoad.current = false
      setOrders(o.orders)
      setSummary(s.summary)
      setError('')
    } catch (e) {
      setError((e as ApiError).message)
    }
  }, [scope, toast])

  useEffect(() => {
    load()
  }, [load])

  // Live push from the server, with a slow poll as a safety net.
  useEffect(() => {
    const close = openStream(() => load())
    const poll = setInterval(load, 8000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [load])

  const advance = async (order: Order, to: OrderStatus) => {
    setBusyId(order.id)
    try {
      const r = await api<{ order: Order }>(`/staff/orders/${order.id}/status`, { body: { status: to } })
      setOrders((prev) => prev?.map((o) => (o.id === r.order.id ? r.order : o)) ?? null)
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  const togglePaid = async (order: Order) => {
    setBusyId(order.id)
    try {
      const r = await api<{ order: Order }>(`/staff/orders/${order.id}/payment`, {
        body: { paymentStatus: order.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID' },
      })
      setOrders((prev) => prev?.map((o) => (o.id === r.order.id ? r.order : o)) ?? null)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  const visible = useMemo(
    () => (orders ?? []).filter((o) => filter === 'all' || o.type === filter),
    [orders, filter],
  )

  return (
    <>
      <div className="staff-head">
        <h1>Orders</h1>
        <span className="badge badge-accent badge-live">Live</span>
        <div className="spacer" />
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['all', 'dine_in', 'pickup'] as const).map((f) => (
            <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'dine_in' ? 'Dine in' : 'Pickup'}
            </button>
          ))}
        </div>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={`tab ${view === 'board' ? 'active' : ''}`} onClick={() => setView('board')}>
            Board
          </button>
          <button className={`tab ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
            All orders
          </button>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setScope(scope === 'active' ? 'all' : 'active')}
        >
          {scope === 'active' ? 'Show history' : 'Active only'}
        </button>
        {alerts !== 'granted' && alerts !== 'unsupported' && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => setAlerts((await askToNotify()) ? 'granted' : notifyPermission())}
          >
            🔔 Alert me
          </button>
        )}
      </div>

      {summary && (
        <div className="stat-row">
          <div className="stat">
            <span>New</span>
            <strong>{summary.newOrders}</strong>
          </div>
          <div className="stat">
            <span>In progress</span>
            <strong>{summary.activeOrders}</strong>
          </div>
          <div className="stat">
            <span>Today</span>
            <strong>{summary.todayOrders}</strong>
          </div>
          <div className="stat">
            <span>Today&rsquo;s sales</span>
            <strong>{money(summary.todayCents)}</strong>
          </div>
          <div className="stat">
            <span>Unpaid</span>
            <strong>{summary.unpaid}</strong>
          </div>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
      {!orders && <LoadingBlock label="Loading the board…" />}

      {orders && visible.length === 0 && (
        <EmptyState
          emoji="✨"
          title="No orders right now"
          body="New orders appear here the moment a customer places one."
        />
      )}

      {orders && visible.length > 0 && view === 'list' && (
        <div className="card ledger-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Order</th>
                <th>Where</th>
                <th>Who</th>
                <th>Items</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Status</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id} className={o.status === 'NEW' ? 'is-new' : ''}>
                  <td>
                    <Link className="mono" to={`/staff/table/${o.id}`}>
                      <strong>#{o.orderNumber}</strong>
                    </Link>
                    {o.isGroup && <span className="o-group-tag" style={{ marginLeft: 6 }}>GROUP</span>}
                  </td>
                  <td>
                    {o.serviceType === 'dine_in' ? o.tableLabel : SERVICE_LABEL[(o.serviceType ?? o.type) as ServiceType]}
                  </td>
                  <td>{o.customerName}</td>
                  <td className="ledger-items">
                    {groupByPerson(o.items).map((person) => (
                      <div key={person.name}>
                        {o.isGroup && <span className="tiny muted">{person.name}: </span>}
                        {person.items.map((i: any) => `${i.quantity}× ${i.name}`).join(', ')}
                      </div>
                    ))}
                  </td>
                  <td>
                    <strong>{money(o.totalCents)}</strong>
                  </td>
                  <td>
                    <button
                      className={`badge ${o.paymentStatus === 'PAID' ? 'badge-open' : 'badge-warn'}`}
                      style={{ border: 0, cursor: 'pointer' }}
                      disabled={busyId === o.id}
                      onClick={() => togglePaid(o)}
                    >
                      {o.paymentStatus}
                    </button>
                    {o.claimedCents > 0 && o.paymentStatus !== 'PAID' && (
                      <span className="tiny muted"> claim {money(o.claimedCents)}</span>
                    )}
                  </td>
                  <td>
                    <span className="badge">{STATUS_LABEL[o.status as OrderStatus]}</span>
                  </td>
                  <td className="tiny muted">{clockTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {orders && visible.length > 0 && view === 'board' && (
        <div className="board">
          {COLUMNS.map((col) => {
            const cards = visible.filter((o) => col.statuses.includes(o.status))
            return (
              <section key={col.key} className="board-col">
                <div className="board-col-head">
                  <h3>{col.title}</h3>
                  <span className="board-col-count">{cards.length}</span>
                </div>
                {cards.length === 0 ? (
                  <div className="board-empty">Nothing here</div>
                ) : (
                  cards.map((o) => {
                    const next = nextStatus(o.serviceType ?? o.type, o.status)
                    return (
                      <article key={o.id} className={`o-card ${o.status === 'NEW' ? 'is-new' : ''}`}>
                        <div className="o-card-top">
                          <Link className="o-number" to={`/staff/table/${o.id}`}>
                            #{o.orderNumber}
                          </Link>
                          <span className={`badge ${o.serviceType === 'dine_in' ? 'badge-accent' : 'badge-info'}`}>
                            {SERVICE_LABEL[(o.serviceType ?? o.type) as ServiceType]}
                          </span>
                          {o.isGroup && <span className="o-group-tag">GROUP</span>}
                          <span className="spacer" />
                          <span className="tiny muted">{timeAgo(o.createdAt)}</span>
                        </div>

                        <div className="o-where">
                          {o.serviceType === 'dine_in' ? o.tableLabel : 'Counter'}
                        </div>
                        <div className="o-name">
                          {o.customerName} · {clockTime(o.createdAt)}
                        </div>

                        <div className="o-items">
                          {o.isGroup
                            ? groupByPerson(o.items).map((person) => (
                                <div key={person.name}>
                                  <div className="o-person">{person.name}</div>
                                  {person.items.map((i: any) => (
                                    <div key={i.id} className="o-item">
                                      <b>{i.quantity}×</b>
                                      <span>{i.name}</span>
                                      {i.paid && <span className="tiny muted">paid</span>}
                                    </div>
                                  ))}
                                </div>
                              ))
                            : o.items.map((i: any) => (
                                <div key={i.id} className="o-item">
                                  <b>{i.quantity}×</b>
                                  <span>{i.name}</span>
                                </div>
                              ))}
                        </div>

                        {o.note && (
                          <p className="tiny" style={{ color: 'var(--warn)', marginBottom: 8 }}>
                            “{o.note}”
                          </p>
                        )}

                        <div className="o-foot" style={{ marginBottom: 8 }}>
                          <button
                            className={`badge ${o.paymentStatus === 'PAID' ? 'badge-open' : 'badge-warn'}`}
                            style={{ border: 0, cursor: 'pointer' }}
                            disabled={busyId === o.id}
                            onClick={() => togglePaid(o)}
                            title="Tap to change payment status"
                          >
                            {o.paymentStatus}
                          </button>
                          {o.claimedCents > 0 && (
                            <span className="badge badge-info" title="Customer says they paid — confirm under Payments">
                              claim {money(o.claimedCents)}
                            </span>
                          )}
                          <span className="spacer" />
                          <span className="o-total">{money(o.totalCents)}</span>
                        </div>

                        <div className="o-foot">
                          {next ? (
                            <button
                              className="btn btn-accent btn-sm"
                              disabled={busyId === o.id}
                              onClick={() => advance(o, next)}
                            >
                              {STATUS_LABEL[next]}
                            </button>
                          ) : (
                            <span className="badge badge-open">{STATUS_LABEL[o.status as OrderStatus]}</span>
                          )}
                          <span className="spacer" />
                          {o.status !== 'CANCELLED' && !['COMPLETED', 'PICKED_UP'].includes(o.status) && (
                            <button
                              className="btn btn-danger btn-sm"
                              disabled={busyId === o.id}
                              onClick={() => advance(o, 'CANCELLED')}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </article>
                    )
                  })
                )}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
