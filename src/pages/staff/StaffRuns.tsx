import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, openStream } from '../../lib/api'
import { EmptyState, LoadingBlock, useToast } from '../../components/ui'
import { money } from '../../../shared/orders'

type Drop = {
  id: number
  orderNumber: string
  status: string
  label: string
  vehicle: string
  vehicleNumber: string
  ageMinutes: number
  totalCents: number
  paymentStatus: 'UNPAID' | 'PAID'
  runner: { id: number; name: string } | null
  items: string[]
}
type Group = { zone: string; zoneId: number | null; drops: Drop[] }

/**
 * The screen for whoever is carrying food out to the road.
 *
 * Grouped by zone because the walk is the expensive part — three ready orders
 * in one zone is one trip, not three — and sorted so the biggest group is
 * first. Each drop shows the car and what is in the bag, so the runner never
 * has to come back to ask.
 */
export default function StaffRuns() {
  const toast = useToast()
  const [groups, setGroups] = useState<Group[] | null>(null)

  const load = useCallback(() => {
    api<{ groups: Group[] }>('/staff/runs')
      .then((r) => setGroups(r.groups))
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])
  useEffect(() => {
    const close = openStream(() => load())
    const poll = setInterval(load, 8000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [load])

  const take = async (d: Drop) => {
    try {
      await api(`/staff/orders/${d.id}/runner`, { method: 'POST', body: {} })
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  const deliver = async (d: Drop) => {
    try {
      await api(`/staff/orders/${d.id}/delivered`, { method: 'POST' })
      toast(`${d.label} — delivered`, 'good')
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  if (!groups) return <LoadingBlock label="Loading the run…" />

  const total = groups.reduce((n, g) => n + g.drops.length, 0)

  return (
    <>
      <div className="staff-head">
        <div className="spacer" />
        <span className="tiny muted">{total} waiting to go out</span>
      </div>

      {total === 0 ? (
        <EmptyState emoji="✅" title="Nothing to carry" body="Ready orders will appear here, grouped by zone." />
      ) : (
        groups.map((g) => (
          <section key={g.zone} className="run-zone">
            <header className="run-zone-head">
              <h2>{g.zone}</h2>
              <span className="run-count">
                {g.drops.length} order{g.drops.length > 1 ? 's' : ''} — one trip
              </span>
            </header>
            {g.drops.map((d) => (
              <article key={d.id} className={`run-drop ${d.status === 'DELIVERING' ? 'taken' : ''}`}>
                <div className="run-drop-main">
                  <div className="run-drop-top">
                    <span className="run-label">{d.label}</span>
                    <span className="mono tiny">{d.orderNumber}</span>
                    <span className="tiny muted">{d.ageMinutes}m</span>
                  </div>
                  {d.vehicle && (
                    <p className="run-vehicle">
                      {d.vehicle}
                      {d.vehicleNumber && <span className="ops-plate">{d.vehicleNumber}</span>}
                    </p>
                  )}
                  <p className="run-items">{d.items.join(' · ')}</p>
                  <p className="tiny">
                    {d.paymentStatus === 'PAID' ? (
                      <span className="ops-paid">Paid — nothing to collect</span>
                    ) : (
                      <span className="ops-due">Collect {money(d.totalCents)}</span>
                    )}
                  </p>
                </div>
                <div className="run-drop-actions">
                  {d.runner ? (
                    <span className="tiny muted">{d.runner.name}</span>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => take(d)}>
                      I&rsquo;ll take it
                    </button>
                  )}
                  <button className="btn btn-accent btn-sm" onClick={() => deliver(d)}>
                    Delivered
                  </button>
                </div>
              </article>
            ))}
          </section>
        ))
      )}
    </>
  )
}
