import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { LoadingBlock, Spinner, useToast } from '../components/ui'
import { saveDining } from '../lib/dining'
import { applyTheme, type ThemeName } from '../lib/themes'

type Spot = { id: number; label: string; note: string }
type Precinct = { id: number; slug: string; name: string }

/**
 * Ordering to wherever you are standing in the area.
 *
 * The same shape as the car and delivery doors: one restaurant, one screen,
 * everything the person walking it out needs before anybody starts cooking.
 * The landmark is the address — nobody standing in 140 has one — and the phone
 * number is not optional, because this is the one way of ordering where the
 * kitchen may need to ring before it commits a member of staff to the street.
 */
export default function NearbyEntry() {
  const { id, slug = '' } = useParams()
  const restaurantId = Number(id)
  const navigate = useNavigate()
  const toast = useToast()

  const [precinct, setPrecinct] = useState<Precinct | null>(null)
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [restaurant, setRestaurant] = useState<{ name: string; theme?: string } | null>(null)
  const [spotId, setSpotId] = useState<number | null>(null)
  /** Their own words, when none of the landmarks is where they are standing. */
  const [own, setOwn] = useState(false)
  const [place, setPlace] = useState('')
  const [lookFor, setLookFor] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ precinct: Precinct; spots: Spot[] }>(`/precincts/${slug}`)
      .then((r) => {
        setPrecinct(r.precinct)
        setSpots(r.spots)
        if (r.spots.length === 1) setSpotId(r.spots[0].id)
      })
      .catch((e: ApiError) => setError(e.message))
    api<{ restaurant: { name: string; theme?: string } }>(`/restaurants/${restaurantId}`)
      .then((r) => setRestaurant(r.restaurant))
      .catch(() => {})
  }, [slug, restaurantId])

  useEffect(() => applyTheme((restaurant?.theme ?? '') as ThemeName), [restaurant?.theme])

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ session: any }>('/sessions/precinct', {
        body: {
          restaurantId,
          precinctSlug: slug,
          spotId: own ? null : spotId,
          place: own ? place.trim() : '',
          lookFor: lookFor.trim(),
          phone: phone.trim(),
        },
      })
      saveDining(r.session)
      toast(`They'll bring it to ${r.session.whereLabel}`, 'good')
      navigate(`/r/${restaurantId}`)
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  const phoneOk = phone.replace(/\D/g, '').length >= 10
  const ready = phoneOk && (own ? place.trim().length >= 4 : !!spotId)

  return (
    <div className="app">
      <Header />
      <main className="page road-entry">
        <p className="road-kicker">{restaurant?.name ?? 'Ordering'}</p>
        <h1 className="road-title">Where are you in {precinct?.name ?? 'the area'}?</h1>
        <p className="muted" style={{ marginTop: -6, marginBottom: 18 }}>
          Pick the nearest landmark and someone will walk it over to you.
        </p>

        {error && <div className="form-error">{error}</div>}

        {!spots ? (
          <LoadingBlock />
        ) : (
          <div className="spot-grid">
            {spots.map((s) => (
              <button
                key={s.id}
                className={`spot-card ${!own && spotId === s.id ? 'on' : ''}`}
                onClick={() => {
                  setOwn(false)
                  setSpotId(s.id)
                }}
                aria-pressed={!own && spotId === s.id}
              >
                <strong>{s.label}</strong>
                {s.note && <span>{s.note}</span>}
              </button>
            ))}
            {/* A list of shopfronts cannot name every doorway and bench in a
                market. Being told to pick one of these when none of them is
                where you are standing is how somebody gives up and rings. */}
            <button
              className={`spot-card ${own ? 'on' : ''}`}
              onClick={() => setOwn(true)}
              aria-pressed={own}
            >
              <strong>Somewhere else</strong>
              <span>Say where in your own words</span>
            </button>
          </div>
        )}

        {own && (
          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label htmlFor="pr-place">Where are you?</label>
            <input
              id="pr-place"
              className="input"
              value={place}
              onChange={(e) => setPlace(e.target.value.slice(0, 140))}
              placeholder="By the ATM next to the bank"
              autoFocus
            />
            <span className="hint">Somewhere the person walking over will recognise.</span>
          </div>
        )}

        <h2 className="road-sub">What should they look for?</h2>
        <p className="tiny muted">Two people at the same spot look the same from the door.</p>
        <input
          className="input"
          value={lookFor}
          onChange={(e) => setLookFor(e.target.value.slice(0, 140))}
          placeholder="Blue scooter, grey shirt"
        />

        <h2 className="road-sub">Your phone number</h2>
        <p className="tiny muted">
          So they can ring you before they set off, and again if they cannot find you.
        </p>
        <input
          className="input"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^0-9+ ]/g, '').slice(0, 20))}
          placeholder="98765 43210"
          inputMode="tel"
          autoComplete="tel"
        />

        <div className="notice" style={{ marginTop: 18 }}>
          <span aria-hidden>💳</span>
          <div>
            <strong>Pay before it leaves the kitchen</strong>
            <p className="tiny">
              It saves the second walk back for the money. Cash on arrival still works — the order just
              has to be accepted first either way.
            </p>
          </div>
        </div>

        <button className="btn btn-accent btn-lg btn-block" disabled={busy || !ready} onClick={start}>
          {busy ? <Spinner /> : 'Pick the food'}
        </button>
        <p className="tiny muted road-foot">
          {restaurant?.name ?? 'The kitchen'} accepts the order before it is made.{' '}
          <Link to={`/r/${restaurantId}`}>Just browse the menu</Link> instead.
        </p>
      </main>
    </div>
  )
}
