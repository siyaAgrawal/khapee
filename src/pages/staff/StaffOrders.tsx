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

/** Where this one is going, in the words staff use for it. */
function placeOf(o: any): string {
  if (o.serviceMode === 'delivery' || o.serviceType === 'delivery') return o.deliveryArea || 'Delivery'
  if (o.serviceMode === 'car' || o.serviceType === 'car') return o.zoneName ? `Car · ${o.zoneName}` : 'Car outside'
  if (o.tableLabel) return o.tableLabel
  return SERVICE_LABEL[(o.serviceType ?? o.type) as ServiceType]
}

/** Placed today, read the way the server stores it: "YYYY-MM-DD HH:MM:SS" UTC. */
function isToday(createdAt: string): boolean {
  const d = new Date(String(createdAt).replace(' ', 'T') + 'Z')
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  )
}

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
  // A board needs five columns of width. On a phone it had one, so the queue
  // is what opens there; anything wide enough for the board gets the board.
  const [view, setView] = useState<'queue' | 'board' | 'list'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 860 ? 'queue' : 'board',
  )
  const [openId, setOpenId] = useState<number | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<string | null>(null)
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
  //
  // A phone left on the counter is the normal case, and a backgrounded tab gets
  // its timers throttled to nothing and its event stream dropped. Coming back
  // to it, the board could be minutes stale with no sign of it — which is what
  // made reloading by hand feel necessary. So it also refreshes the moment the
  // screen is looked at again.
  useEffect(() => {
    const close = openStream(() => load())
    const poll = setInterval(load, 8000)
    const onWake = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)
    return () => {
      close()
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
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

  /**
   * The numbers along the top are the quickest way to say what you want to look
   * at, and they were only ever decoration — you read "3 unpaid" and then went
   * hunting for which three. Tapping one now narrows the screen to exactly
   * those orders, and says so in a line you can dismiss.
   */
  const FOCUS: Record<string, { label: string; match: (o: Order) => boolean; asList?: boolean }> = {
    new: { label: 'New orders', match: (o) => o.status === 'NEW' },
    active: {
      label: 'Orders in progress',
      match: (o) => !['COMPLETED', 'PICKED_UP', 'CANCELLED'].includes(o.status),
    },
    today: { label: "Today's orders", match: (o) => isToday(o.createdAt), asList: true },
    paid: {
      label: 'Paid today',
      match: (o) => isToday(o.createdAt) && o.paymentStatus === 'PAID' && o.status !== 'CANCELLED',
      asList: true,
    },
    unpaid: {
      label: 'Waiting to be paid',
      match: (o) => o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED',
      asList: true,
    },
  }

  const focusOn = (key: string) => {
    setFocus(key)
    // History has to be in scope for anything that can include a finished
    // order, or tapping "Today" on a quiet afternoon shows nothing at all.
    if (FOCUS[key]?.asList) {
      setScope('all')
      // The table view is eight columns wide; on a phone that is the thing
      // being escaped, so narrow screens stay in the queue.
      setView(window.innerWidth < 860 ? 'queue' : 'list')
    }
  }

  const visible = useMemo(() => {
    const f = focus ? FOCUS[focus] : null
    const q = query.trim().toLowerCase()
    const hit = (o: Order) =>
      !q ||
      [o.orderNumber, o.customerName, o.tableLabel, placeOf(o), ...o.items.map((i: any) => i.name)]
        .filter(Boolean)
        .some((s: string) => String(s).toLowerCase().includes(q))
    return (orders ?? []).filter(
      (o) => (filter === 'all' || o.type === filter) && (!f || f.match(o)) && hit(o),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, filter, focus, query])

  return (
    <>
      <div className="staff-controls">
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['queue', 'board', 'list'] as const).map((v) => (
            <button
              key={v}
              /* Board and Table both need width they do not have on a phone,
                 and offering them there is offering the problem. */
              className={`tab ${view === v ? 'active' : ''} ${v !== 'queue' ? 'hide-phone' : ''}`}
              onClick={() => setView(v)}
            >
              {v === 'queue' ? 'Queue' : v === 'board' ? 'Board' : 'Table'}
            </button>
          ))}
        </div>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['all', 'dine_in', 'pickup'] as const).map((f) => (
            <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'dine_in' ? 'Dine in' : 'Pickup'}
            </button>
          ))}
        </div>
        {/* On a busy night the board is thirty rows long and the one you are
            being asked about is somewhere in it. Typing any part of the order
            number, the name, or the table finds it. */}
        <input
          className="input input-sm order-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an order…"
          aria-label="Find an order by number, name or table"
        />
        <span className="spacer" />
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
            🔔 <span className="hide-phone">Alert me</span>
          </button>
        )}
      </div>

      {summary && (
        <div className="stat-row">
          {(
            [
              ['new', 'New', summary.newOrders, null],
              ['active', 'In progress', summary.activeOrders, null],
              ['today', 'Today', summary.todayOrders, null],
              ['paid', 'Taken today', money(summary.todayCents), 'paid in full'],
              ['unpaid', 'Unpaid', summary.unpaid, summary.unpaidCents ? money(summary.unpaidCents) : null],
            ] as const
          ).map(([key, label, value, note]) => (
            <button
              key={key}
              type="button"
              className={`stat stat-btn ${focus === key ? 'on' : ''}`}
              aria-pressed={focus === key}
              onClick={() => (focus === key ? setFocus(null) : focusOn(key))}
            >
              <span>{label}</span>
              <strong>{value}</strong>
              {note && <em className="stat-note">{note}</em>}
            </button>
          ))}
        </div>
      )}

      {focus && (
        <div className="focus-bar">
          <strong>{FOCUS[focus]?.label}</strong>
          <span className="tiny muted">
            {visible.length} order{visible.length === 1 ? '' : 's'}
          </span>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setFocus(null)}>
            Show everything
          </button>
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

      {/*
        The queue.

        A board is five columns side by side, which is a shape a phone does not
        have: it became one narrow column you scrolled sideways through, and
        with thirty orders on a Friday night you could not see the one you
        wanted in any of them. This is the same work as one column down the
        page — grouped by what has to happen to it, newest first, each order a
        line you can read at arm's length with its next step on it. Tapping a
        line opens what is in it.
      */}
      {orders && visible.length > 0 && view === 'queue' && (
        <div className="queue">
          {COLUMNS.map((col) => {
            const rows = visible.filter((o) => col.statuses.includes(o.status))
            if (!rows.length) return null
            const done = col.key === 'done'
            return (
              <section key={col.key} className="queue-group">
                <h3 className="queue-head">
                  {col.title}
                  <span className="queue-count">{rows.length}</span>
                </h3>
                {(done && !showDone ? rows.slice(0, 3) : rows).map((o) => {
                  const next = nextStatus(o.serviceType ?? o.type, o.status)
                  const open = openId === o.id
                  return (
                    <article key={o.id} className={`qrow ${o.status === 'NEW' ? 'is-new' : ''} ${open ? 'open' : ''}`}>
                      <button className="qrow-main" onClick={() => setOpenId(open ? null : o.id)}>
                        <span className="qrow-where">
                          <b>{placeOf(o)}</b>
                          <em>
                            #{o.orderNumber} · {o.customerName || 'Guest'}
                          </em>
                        </span>
                        <span className="qrow-meta">
                          <b>{money(o.totalCents)}</b>
                          <em>
                            {o.items.reduce((n: number, i: any) => n + i.quantity, 0)} items ·{' '}
                            {timeAgo(o.createdAt)}
                          </em>
                        </span>
                        {o.paymentStatus !== 'PAID' && <span className="qrow-dot" title="Not paid" />}
                      </button>

                      {next && (
                        <button
                          className="btn btn-accent btn-sm qrow-go"
                          disabled={busyId === o.id}
                          onClick={() => advance(o, next)}
                        >
                          {STATUS_LABEL[next]}
                        </button>
                      )}

                      {open && (
                        <div className="qrow-body">
                          <ul className="qrow-items">
                            {o.items.map((i: any) => (
                              <li key={i.id}>
                                <b>{i.quantity}×</b> {i.name}
                                {i.memberName ? <em> · {i.memberName}</em> : null}
                              </li>
                            ))}
                          </ul>
                          {o.note && <p className="qrow-note">“{o.note}”</p>}
                          <div className="qrow-actions">
                            <button
                              className={`badge ${o.paymentStatus === 'PAID' ? 'badge-open' : 'badge-warn'}`}
                              style={{ border: 0, cursor: 'pointer' }}
                              disabled={busyId === o.id}
                              onClick={() => togglePaid(o)}
                            >
                              {o.paymentStatus === 'PAID' ? 'Paid' : 'Mark paid'}
                            </button>
                            <Link className="btn btn-secondary btn-sm" to={`/staff/table/${o.id}`}>
                              Open bill
                            </Link>
                            <span className="spacer" />
                            {!['COMPLETED', 'PICKED_UP', 'CANCELLED'].includes(o.status) && (
                              <button
                                className="btn btn-danger btn-sm"
                                disabled={busyId === o.id}
                                onClick={() => advance(o, 'CANCELLED')}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
                {done && rows.length > 3 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowDone(!showDone)}>
                    {showDone ? 'Show fewer' : `Show ${rows.length - 3} more`}
                  </button>
                )}
              </section>
            )
          })}
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
