import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, openStream } from '../../lib/api'
import { LoadingBlock, Modal, Spinner, useToast } from '../../components/ui'
import { money, STATUS_LABEL, type OrderStatus } from '../../../shared/orders'

type OpsOrder = {
  id: number
  orderNumber: string
  status: OrderStatus
  serviceMode: string
  totalCents: number
  paymentStatus: 'UNPAID' | 'PAID'
  ageMinutes: number
  items: { name: string; quantity: number; addedLater: boolean }[]
  runner: { id: number; name: string } | null
  customerName?: string
  customerPhone?: string
}
type OpsSession = {
  id: number
  token: string
  code: string
  serviceMode: string
  label: string
  vehicle: string
  vehicleNumber: string
  zoneId: number | null
  zoneName: string | null
  partySize: number
  openedByStaff: boolean
  waitingMinutes: number
  orders: OpsOrder[]
  waitingToOrder: boolean
  dueCents: number
}
type Zone = { id: number; name: string; note: string; isActive: boolean }
type Delivery = {
  id: number
  orderNumber: string
  status: OrderStatus
  totalCents: number
  ageMinutes: number
  items: { name: string; quantity: number }[]
  area: string
  /** The address, or the landmark somebody in a precinct is standing at. */
  address: string
  /** What to look for once you are there — precinct orders only. */
  detail?: string
  /** Carried out on foot to somewhere nearby rather than driven to an address. */
  nearby?: boolean
  phone: string
  awaitingAnswer: boolean
}
type Board = {
  deliveries: Delivery[]
  zones: Zone[]
  sessions: OpsSession[]
  unattached: OpsOrder[]
  summary: {
    inside: number
    cars: number
    waitingToOrder: number
    preparing: number
    ready: number
    paymentPending: number
    deliveryRequests: number
    dueCents: number
  }
}

/**
 * The board that replaces remembering.
 *
 * A restaurant serving cars on the road has staff holding all of this in their
 * heads: which car ordered, which hasn't been asked yet, whose food is up, who
 * still owes. Every column here exists to take one of those out of a person's
 * memory. Cars that nobody has been to yet sort to the top, because they are
 * the ones that quietly leave.
 */
export default function StaffOps() {
  const toast = useToast()
  const [board, setBoard] = useState<Board | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    api<Board>('/staff/ops')
      .then(setBoard)
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])

  // Live push from the server, with a poll behind it — the waiting minutes on
  // this board only move when something re-renders, and a floor board that is
  // silently stale is worse than one that costs a request every few seconds.
  useEffect(() => {
    const close = openStream(() => load())
    const poll = setInterval(load, 8000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [load])

  const advance = async (order: OpsOrder, status: OrderStatus) => {
    try {
      await api(`/staff/orders/${order.id}/status`, { body: { status } })
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  const deliver = async (order: OpsOrder) => {
    try {
      await api(`/staff/orders/${order.id}/delivered`, { method: 'POST' })
      toast(`${order.orderNumber} delivered`, 'good')
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  const answer = async (d: Delivery, yes: boolean) => {
    if (!yes) {
      const reason = window.prompt(
        `Tell ${d.orderNumber} why you can't take it — they'll read this.`,
        'Kitchen is full right now',
      )
      if (!reason?.trim()) return
      try {
        await api(`/staff/orders/${d.id}/decline`, { body: { reason: reason.trim() } })
        toast(`${d.orderNumber} declined`, 'info')
        load()
      } catch (e) {
        toast((e as ApiError).message, 'bad')
      }
      return
    }
    try {
      await api(`/staff/orders/${d.id}/accept`, { method: 'POST' })
      toast(`${d.orderNumber} accepted`, 'good')
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  const close = async (s: OpsSession) => {
    try {
      await api(`/staff/sessions/${s.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  if (!board) return <LoadingBlock label="Loading the floor…" />

  const cars = board.sessions.filter((s) => s.serviceMode === 'car')
  // Deliveries have their own panel above; without this they also appear here
  // as nameless tables, and the same order is on the board twice.
  const inside = board.sessions.filter((s) => s.serviceMode !== 'car' && s.serviceMode !== 'delivery')

  // Nobody has been to these yet — the whole point of the board.
  const byUrgency = (a: OpsSession, b: OpsSession) =>
    Number(b.waitingToOrder) - Number(a.waitingToOrder) || b.waitingMinutes - a.waitingMinutes

  // A restaurant with no zones has one stretch of kerb, not a missing zone.
  const zoneName = (s: OpsSession) => s.zoneName ?? (board.zones.length ? 'No zone' : 'Outside')
  const zones = [...new Set(cars.map(zoneName))]

  return (
    <>
      <div className="staff-head">
        <div className="spacer" />
        <button className="btn btn-accent" onClick={() => setAdding(true)}>
          Add a car
        </button>
      </div>

      <div className="ops-stats">
        <Stat label="Inside" value={board.summary.inside} />
        <Stat label="Cars" value={board.summary.cars} />
        <Stat label="Not asked yet" value={board.summary.waitingToOrder} tone={board.summary.waitingToOrder ? 'warn' : ''} />
        <Stat label="Cooking" value={board.summary.preparing} />
        <Stat label="Ready" value={board.summary.ready} tone={board.summary.ready ? 'good' : ''} />
        <Stat label="To collect" value={money(board.summary.dueCents)} tone={board.summary.dueCents ? 'warn' : ''} />
      </div>

      {board.deliveries.length > 0 && (
        <section className="ops-zone">
          <header className="ops-zone-head">
            <h2>Delivery</h2>
            <span className="tiny muted">
              {board.summary.deliveryRequests > 0
                ? `${board.summary.deliveryRequests} waiting on you`
                : `${board.deliveries.length} on the way`}
            </span>
          </header>
          <div className="ops-grid">
            {board.deliveries.map((d) => (
              <article key={d.id} className={`ops-card ${d.awaitingAnswer ? 'unasked' : ''}`}>
                <header className="ops-card-head">
                  <span className="ops-label">
                    {d.nearby ? '🚶' : '🛵'} {d.area || 'Delivery'}
                  </span>
                  <span className="ops-age">{d.ageMinutes}m</span>
                </header>
                <p className="ops-vehicle">{d.address}</p>
                {/* What the runner is looking for once they get there. Two
                    people standing at the same shopfront look identical. */}
                {d.detail && <p className="tiny">{d.detail}</p>}
                {d.phone && (
                  <p className="tiny muted">
                    <a href={`tel:${d.phone}`}>{d.phone}</a>
                  </p>
                )}

                <div className="ops-order">
                  <div className="ops-order-top">
                    <span className="mono">{d.orderNumber}</span>
                    <span className={`badge ${d.awaitingAnswer ? '' : 'badge-open'}`}>
                      {STATUS_LABEL[d.status]}
                    </span>
                  </div>
                  <ul className="ops-items">
                    {d.items.map((i, n) => (
                      <li key={n}>
                        {i.quantity}× {i.name}
                      </li>
                    ))}
                  </ul>
                  <div className="ops-order-foot">
                    <span className="ops-due">{money(d.totalCents)}</span>
                    <span className="spacer" />
                    {d.awaitingAnswer ? (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => answer(d, false)}>
                          Can&rsquo;t take it
                        </button>
                        <button className="btn btn-accent btn-sm" onClick={() => answer(d, true)}>
                          Accept
                        </button>
                      </>
                    ) : (
                      NEXT_DELIVERY[d.status] && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            advance({ id: d.id, orderNumber: d.orderNumber } as OpsOrder, NEXT_DELIVERY[d.status]!.to)
                          }
                        >
                          {NEXT_DELIVERY[d.status]!.label}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {cars.length === 0 && inside.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>
          Nobody on the floor right now.
        </p>
      )}

      {zones.map((zone) => {
        const group = cars.filter((s) => zoneName(s) === zone).sort(byUrgency)
        if (!group.length) return null
        return (
          <section key={zone} className="ops-zone">
            <header className="ops-zone-head">
              <h2>{zone}</h2>
              <span className="tiny muted">
                {group.length} car{group.length > 1 ? 's' : ''}
              </span>
            </header>
            <div className="ops-grid">
              {group.map((s) => (
                <SessionCard key={s.id} s={s} onAdvance={advance} onDeliver={deliver} onClose={close} />
              ))}
            </div>
          </section>
        )
      })}

      {inside.length > 0 && (
        <section className="ops-zone">
          <header className="ops-zone-head">
            <h2>Inside</h2>
            <span className="tiny muted">{inside.length} tables</span>
          </header>
          <div className="ops-grid">
            {inside.sort(byUrgency).map((s) => (
              <SessionCard key={s.id} s={s} onAdvance={advance} onDeliver={deliver} onClose={close} />
            ))}
          </div>
        </section>
      )}

      <AddCar open={adding} zones={board.zones} onClose={() => setAdding(false)} onDone={load} />
    </>
  )
}

function Stat({ label, value, tone = '' }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={`ops-stat ${tone}`}>
      <span className="ops-stat-value">{value}</span>
      <span className="ops-stat-label">{label}</span>
    </div>
  )
}

/** A delivery, once accepted, walks its own flow out to the door. */
const NEXT_DELIVERY: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  ACCEPTED: { to: 'PREPARING', label: 'Start cooking' },
  PREPARING: { to: 'READY', label: 'Mark ready' },
  READY: { to: 'OUT_FOR_DELIVERY', label: 'Send it out' },
  OUT_FOR_DELIVERY: { to: 'DELIVERED', label: 'Delivered' },
}

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  NEW: { to: 'ACCEPTED', label: 'Accept' },
  ACCEPTED: { to: 'PREPARING', label: 'Start cooking' },
  PREPARING: { to: 'READY', label: 'Mark ready' },
}

function SessionCard({
  s,
  onAdvance,
  onDeliver,
  onClose,
}: {
  s: OpsSession
  onAdvance: (o: OpsOrder, to: OrderStatus) => void
  onDeliver: (o: OpsOrder) => void
  onClose: (s: OpsSession) => void
}) {
  const isCar = s.serviceMode === 'car'
  return (
    <article className={`ops-card ${s.waitingToOrder ? 'unasked' : ''}`}>
      <header className="ops-card-head">
        <span className="ops-label">
          {isCar ? '🚗' : '🍽'} {s.label}
        </span>
        <span className="ops-age">{s.waitingMinutes}m</span>
      </header>

      {isCar && (
        <p className="ops-vehicle">
          {s.vehicle}
          {s.vehicleNumber && <span className="ops-plate">{s.vehicleNumber}</span>}
        </p>
      )}
      {s.partySize > 1 && <p className="tiny muted">{s.partySize} people</p>}
      {s.openedByStaff && <p className="tiny muted">Opened by staff</p>}

      {s.waitingToOrder ? (
        <p className="ops-unasked">Hasn&rsquo;t ordered yet</p>
      ) : (
        s.orders.map((o) => {
          const next = NEXT[o.status]
          return (
            <div key={o.id} className="ops-order">
              <div className="ops-order-top">
                <span className="mono">{o.orderNumber}</span>
                <span className={`badge ${o.status === 'READY' ? 'badge-open' : ''}`}>{STATUS_LABEL[o.status]}</span>
                <span className="tiny muted">{o.ageMinutes}m</span>
              </div>
              {/* Who it is for, and a number to ring when the car is not
                  where they said it would be. */}
              {(o.customerName || o.customerPhone) && (
                <p className="ops-who">
                  {o.customerName || 'Customer'}
                  {o.customerPhone && (
                    <>
                      {' · '}
                      <a href={`tel:${o.customerPhone.replace(/[^0-9+]/g, '')}`}>📞 {o.customerPhone}</a>
                    </>
                  )}
                </p>
              )}
              <ul className="ops-items">
                {o.items.map((i, n) => (
                  <li key={n}>
                    {i.quantity}× {i.name}
                    {i.addedLater && <span className="ops-later">added later</span>}
                  </li>
                ))}
              </ul>
              <div className="ops-order-foot">
                <span className={o.paymentStatus === 'PAID' ? 'ops-paid' : 'ops-due'}>
                  {money(o.totalCents)} {o.paymentStatus === 'PAID' ? 'paid' : 'due'}
                </span>
                {o.runner && <span className="tiny muted">{o.runner.name}</span>}
                <span className="spacer" />
                {next && (
                  <button className="btn btn-secondary btn-sm" onClick={() => onAdvance(o, next.to)}>
                    {next.label}
                  </button>
                )}
                {o.status === 'READY' && (
                  <button className="btn btn-accent btn-sm" onClick={() => onDeliver(o)}>
                    {isCar ? 'Taken out' : 'Served'}
                  </button>
                )}
              </div>
            </div>
          )
        })
      )}

      <footer className="ops-card-foot">
        {s.dueCents > 0 && <span className="ops-due">{money(s.dueCents)} to collect</span>}
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => onClose(s)}>
          {isCar ? 'Car left' : 'Close'}
        </button>
      </footer>
    </article>
  )
}

/** Staff opening a session for someone with no phone — the fallback that matters. */
function AddCar({
  open,
  zones,
  onClose,
  onDone,
}: {
  open: boolean
  zones: Zone[]
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [zoneId, setZoneId] = useState<number | null>(null)
  const [vehicle, setVehicle] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const r = await api<{ session: { label: string } }>('/staff/sessions/car', {
        body: { zoneId, vehicle: vehicle.trim() },
      })
      toast(`${r.session.label} added`, 'good')
      setVehicle('')
      onClose()
      onDone()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a car">
      <p className="tiny muted">For someone who flagged you down rather than using their phone.</p>
      <div className="field">
        <label>Zone</label>
        <div className="chip-row">
          {zones.map((z) => (
            <button
              key={z.id}
              className={`chip ${zoneId === z.id ? 'on' : ''}`}
              onClick={() => setZoneId(z.id)}
              aria-pressed={zoneId === z.id}
            >
              {z.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="veh">The car</label>
        <input
          id="veh"
          className="input"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          placeholder="White Honda City"
          autoFocus
        />
      </div>
      <button className="btn btn-accent btn-block" disabled={busy || !vehicle.trim()} onClick={create}>
        {busy ? <Spinner /> : 'Add to the board'}
      </button>
    </Modal>
  )
}
