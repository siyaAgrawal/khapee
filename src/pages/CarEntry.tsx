import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { LoadingBlock, Spinner, useToast } from '../components/ui'
import { saveDining } from '../lib/dining'
import { applyTheme, type ThemeName } from '../lib/themes'

type Zone = { id: number; name: string; note: string }

/**
 * Getting a car onto the board.
 *
 * Everything here is chosen to avoid the thing this feature exists to remove: a
 * staff member walking out to the road before an order can exist. So it asks
 * for the two things that let someone find the car — roughly where it is, and
 * what it looks like — and nothing else. No table number, no code, no account.
 */
export default function CarEntry() {
  const { id } = useParams()
  const restaurantId = Number(id)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [zones, setZones] = useState<Zone[] | null>(null)
  const [restaurant, setRestaurant] = useState<{ name: string; isOpen: boolean; theme?: string } | null>(null)
  const [zoneId, setZoneId] = useState<number | null>(null)
  const [vehicle, setVehicle] = useState('')
  const [plate, setPlate] = useState('')
  const [people, setPeople] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ zones: Zone[] }>(`/restaurants/${restaurantId}/zones`)
      .then((r) => {
        setZones(r.zones)
        // A zone QR already knows where it is standing; don't ask again.
        const fromSign = Number(params.get('zone'))
        if (fromSign && r.zones.some((z) => z.id === fromSign)) setZoneId(fromSign)
      })
      .catch(() => setZones([]))
    api<{ restaurant: { name: string; isOpen: boolean; theme?: string } }>(`/restaurants/${restaurantId}`)
      .then((r) => setRestaurant(r.restaurant))
      .catch(() => {})
  }, [restaurantId, params])

  // This screen belongs to the restaurant, so it wears the restaurant's colours.
  useEffect(() => applyTheme((restaurant?.theme ?? '') as ThemeName), [restaurant?.theme])

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ session: any }>('/sessions/car', {
        body: {
          restaurantId,
          zoneId,
          vehicle: vehicle.trim(),
          vehicleNumber: plate.trim(),
          partySize: people,
        },
      })
      saveDining(r.session)
      toast(`${r.session.label} — order whenever you're ready`, 'good')
      navigate(`/r/${restaurantId}`)
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * A restaurant with several stretches of road needs to know which one you are
   * on; one that serves the few cars outside its own door does not, and asking
   * would be a question with no useful answer. The zones decide the question.
   */
  const zoned = (zones?.length ?? 0) > 0

  const SUGGESTIONS = ['White hatchback', 'Black SUV', 'Silver sedan', 'Red hatchback', 'White sedan']

  return (
    <div className="app">
      <Header />
      <main className="page road-entry">
        <p className="road-kicker">{restaurant?.name ?? 'Ordering'}</p>
        <h1 className="road-title">{zoned ? 'Where are you parked?' : 'Order from your car'}</h1>
        {!zoned && zones !== null && (
          <p className="muted" style={{ marginTop: -6, marginBottom: 18 }}>
            Tell us what you&rsquo;re in and someone will bring it out to you.
          </p>
        )}

        {error && <div className="form-error">{error}</div>}

        {zones === null ? (
          <LoadingBlock />
        ) : !zoned ? null : (
          <div className="zone-grid">
            {zones.map((z) => (
              <button
                key={z.id}
                className={`zone-card ${zoneId === z.id ? 'on' : ''}`}
                onClick={() => setZoneId(z.id)}
                aria-pressed={zoneId === z.id}
              >
                <span className="zone-mark" aria-hidden>
                  {z.name.replace(/[^A-Za-z0-9]/g, '').slice(-1) || '•'}
                </span>
                <span className="zone-name">{z.name}</span>
                {z.note && <span className="zone-note">{z.note}</span>}
              </button>
            ))}
          </div>
        )}

        <h2 className="road-sub" style={zoned ? undefined : { marginTop: 0 }}>
          What are you driving?
        </h2>
        <p className="tiny muted">So whoever brings the food can spot you.</p>
        <input
          className="input"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          placeholder="White Honda City"
          maxLength={60}
        />
        <div className="chip-row">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => setVehicle(s)}>
              {s}
            </button>
          ))}
        </div>

        <details className="road-more">
          <summary>Add a number plate or party size</summary>
          <div className="field">
            <label htmlFor="plate">Number plate (optional)</label>
            <input
              id="plate"
              className="input"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="MP09 AB 1234"
              maxLength={20}
            />
            <p className="tiny muted">Only useful if there are two cars the same colour.</p>
          </div>
          <div className="field">
            <label htmlFor="people">How many of you?</label>
            <select id="people" className="select" value={people} onChange={(e) => setPeople(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </details>

        <button className="btn btn-accent btn-lg btn-block" disabled={busy || !vehicle.trim()} onClick={start}>
          {busy ? <Spinner /> : 'Start ordering'}
        </button>
        <p className="tiny muted road-foot">
          No account needed. <Link to={`/r/${restaurantId}`}>Just browse the menu</Link> instead.
        </p>
      </main>
    </div>
  )
}
