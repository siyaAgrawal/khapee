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
type Board = {
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
  const inside = board.sessions.filter((s) => s.serviceMode !== 'car')

  // Nobody has been to these yet — the whole point of the board.
  const byUrgency = (a: OpsSession, b: OpsSession) =>
    Number(b.waitingToOrder) - Number(a.waitingToOrder) || b.waitingMinutes - a.waitingMinutes

  const zoneName = (s: OpsSession) => s.zoneName ?? 'No zone'
  const zones = [...new Set(cars.map(zoneName))]

  return (
    <>
      <div className="staff-head">
        <h1>Floor</h1>
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
