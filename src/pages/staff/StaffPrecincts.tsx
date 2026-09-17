import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { EmptyState, LoadingBlock, Spinner, useToast } from '../../components/ui'

type Precinct = { id: number; slug: string; name: string; city: string; note: string; joined: boolean; spots: number }
type Spot = { id: number; label: string; note: string }

/**
 * Whether this kitchen will carry an order out into the street around it.
 *
 * Joining is a promise that somebody can leave the counter, so it is a switch
 * rather than a setting — one person on a Sunday flips it off and the precinct
 * stops offering them, without anyone having to explain anything to a customer
 * standing outside.
 */
export default function StaffPrecincts() {
  const toast = useToast()
  const [precincts, setPrecincts] = useState<Precinct[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [spots, setSpots] = useState<Spot[]>([])
  const [label, setLabel] = useState('')

  const load = useCallback(() => {
    api<{ precincts: Precinct[] }>('/staff/precincts')
      .then((r) => setPrecincts(r.precincts))
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])

  const loadSpots = (id: number) =>
    api<{ spots: Spot[] }>(`/staff/precincts/${id}/spots`)
      .then((r) => setSpots(r.spots))
      .catch(() => setSpots([]))

  const toggle = async (p: Precinct) => {
    setBusy(p.id)
    try {
      const r = await api<{ joined: boolean }>(`/staff/precincts/${p.id}/join`, { body: { joined: !p.joined } })
      toast(
        r.joined ? `You're on the ${p.name} list` : `Taken off the ${p.name} list`,
        r.joined ? 'good' : 'info',
      )
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(null)
    }
  }

  const addSpot = async (p: Precinct, e: React.FormEvent) => {
    e.preventDefault()
    if (label.trim().length < 2) return
    try {
      await api(`/staff/precincts/${p.id}/spots`, { body: { label: label.trim() } })
      setLabel('')
      loadSpots(p.id)
      load()
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    }
  }

  if (!precincts) return <LoadingBlock />
  if (!precincts.length) {
    return (
      <EmptyState
        emoji="🗺️"
        title="No areas near you yet"
        body="An area is a stretch of street whose restaurants carry orders out to whoever is standing in it."
      />
    )
  }

  return (
    <>
      <div className="notice mb-2">
        <span aria-hidden>🚶</span>
        <div>
          <strong>Someone outside can order from you</strong>
          <p className="tiny">
            They pick a landmark instead of an address, you accept the order the way you would a
            delivery, and somebody walks it over. Turn it off whenever nobody can leave the counter.
          </p>
        </div>
      </div>

      {precincts.map((p) => (
        <section key={p.id} className="card card-pad mb-2">
          <div className="list-row">
            <div style={{ minWidth: 0 }}>
              <strong>{p.name}</strong>
              <p className="tiny muted">
                {p.city} · {p.spots} place{p.spots === 1 ? '' : 's'} to stand
              </p>
            </div>
            <span className="spacer" />
            <span className={`badge ${p.joined ? 'badge-open' : ''}`}>{p.joined ? 'On the list' : 'Not listed'}</span>
            <button
              className={`switch ${p.joined ? 'on' : ''}`}
              aria-pressed={p.joined}
              aria-label={`Serve ${p.name}`}
              disabled={busy === p.id}
              onClick={() => toggle(p)}
            />
          </div>

          {p.joined && (
            <>
              <button
                className="btn btn-ghost btn-sm mt-3"
                onClick={() => {
                  const next = openId === p.id ? null : p.id
                  setOpenId(next)
                  if (next) loadSpots(p.id)
                }}
              >
                {openId === p.id ? 'Hide landmarks' : 'Landmarks customers can pick'}
              </button>

              {openId === p.id && (
                <div className="mt-3">
                  {spots.length === 0 ? (
                    <p className="tiny muted">None yet — add the shopfronts and corners people stand at.</p>
                  ) : (
                    spots.map((s) => (
                      <div key={s.id} className="list-row">
                        <span style={{ fontSize: 14 }}>{s.label}</span>
                        {s.note && <span className="tiny muted"> · {s.note}</span>}
                        <span className="spacer" />
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            await api(`/staff/precincts/${p.id}/spots/${s.id}`, { method: 'DELETE' })
                            loadSpots(p.id)
                            load()
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                  <form className="row row-wrap mt-3" onSubmit={(e) => addSpot(p, e)}>
                    <input
                      className="input"
                      style={{ maxWidth: 260 }}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Outside the sweet shop"
                      aria-label="Landmark name"
                    />
                    <button className="btn btn-secondary" disabled={label.trim().length < 2}>
                      {busy === p.id ? <Spinner /> : 'Add landmark'}
                    </button>
                  </form>
                  <p className="tiny muted mt-3">
                    Everyone serving {p.name} shares this list, so a landmark you fix is fixed for all of
                    them. Removing one leaves orders already sent to it alone.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      ))}
    </>
  )
}
