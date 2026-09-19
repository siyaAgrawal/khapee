import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { useVegMode } from '../lib/veg'
import { alertsLive, pushSupported } from '../lib/push'
import { cuisineBackground, cuisineEmoji } from '../lib/cuisine-art'
import { Art, EmptyState, ErrorState, Skeleton, Spinner } from '../components/ui'

type Precinct = { id: number; slug: string; name: string; city: string; note: string; restaurants: number }

export type RestaurantCard = {
  id: number
  slug: string
  name: string
  description: string
  address: string
  categories: string[]
  emoji: string
  hue: number
  isOpen: boolean
  hours: string
  prepMinutes: number
  rating: number | null
  itemCount: number
  phone?: string
  imageUrl?: string | null
  city?: string
  distanceKm?: number | null
  acceptsPickup?: boolean
  acceptsTakeaway?: boolean
  acceptsGroups?: boolean
  acceptsUpi?: boolean
  /** Whether this restaurant serves customers parked outside. */
  acceptsCar?: boolean
  /** Areas this restaurant will carry an order out into. */
  precincts?: { id: number; slug: string; name: string }[]
  /** Whether this restaurant delivers to nearby areas it has named. */
  acceptsDelivery?: boolean
  /** Those areas, by name, so the offer can say where rather than "nearby". */
  deliveryAreas?: string[]
  /** A restaurant with its own look on its page. Empty is the standard one. */
  theme?: string
}

export type CuisineTile = { name: string; count: number }

export default function Home() {
  const [veg, setVeg] = useVegMode()
  /** Hidden for good once dismissed — it is for staff, and only needed once. */
  const [staffStripGone, setStaffStripGone] = useState(() => {
    try {
      return localStorage.getItem('khapee.staffStrip') === 'hidden'
    } catch {
      return false
    }
  })
  /**
   * Somebody part-way through switching alerts on.
   *
   * Adding Khapee to the Home Screen opens the app here rather than back where
   * they were, so this line is the way back — and says so, because "work here?"
   * is not what somebody who is already half done needs to read.
   */
  const [halfDone] = useState(() => {
    try {
      return !!localStorage.getItem('khapee.alertCode')
    } catch {
      return false
    }
  })
  /**
   * Whether this device is already getting alerts.
   *
   * The line exists to get them switched on, so once they are it is an
   * instruction to do something already done — and it sat above the menu on
   * the phone of the one person who had followed it.
   */
  const [alertsOn, setAlertsOn] = useState(false)
  useEffect(() => {
    // A browser that cannot do push at all is not proof that alerts are on —
    // it is an iPhone whose owner has not added Khapee to the Home Screen yet,
    // which is the one person the line has instructions for. Starting this
    // "on" to stop it flashing in for a moment hid it from them entirely.
    if (!pushSupported()) return
    /**
     * Asked of the server, because the phone is not a witness to this.
     *
     * This used to be answered locally: a push subscription in the browser and
     * a code in local storage, and if both were there the line was hidden. But
     * device registrations live in a database rebuilt from the published copy
     * at every restart, so a phone holding both can be entirely unknown to the
     * server — and that phone, the one that will not ring for anything, was
     * exactly the phone being told everything was fine. There was then no way
     * back to the code, because the only way there was the line now hidden.
     *
     * alertsLive heals first and asks after, so a phone able to put itself
     * back never sees this, and one that cannot is asked for its code again.
     */
    void alertsLive().then(setAlertsOn)
  }, [])
  const [restaurants, setRestaurants] = useState<RestaurantCard[] | null>(null)
  const [tiles, setTiles] = useState<CuisineTile[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [nearestCity, setNearestCity] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationNote, setLocationNote] = useState('')

  const load = (position?: { lat: number; lng: number } | null, vegOnly?: boolean) => {
    setError('')
    setRestaurants(null)
    const params = new URLSearchParams()
    if (position) {
      params.set('lat', String(position.lat))
      params.set('lng', String(position.lng))
    }
    if (vegOnly) params.set('veg', '1')
    const q = params.toString()
    api<{ restaurants: RestaurantCard[]; cuisines: CuisineTile[]; nearestCity: string | null }>(
      `/restaurants${q ? `?${q}` : ''}`,
    )
      .then((r) => {
        setRestaurants(r.restaurants)
        setTiles(r.cuisines)
        setNearestCity(r.nearestCity)
      })
      .catch((e: ApiError) => setError(e.message))
  }

  /**
   * Areas sit in the same list as the restaurants, because from the street they
   * are the same kind of choice: a place you can order from. Tapping one asks
   * where you are standing and then shows every kitchen in it at once.
   */
  const [precincts, setPrecincts] = useState<Precinct[]>([])
  useEffect(() => {
    api<{ precincts: Precinct[] }>('/precincts')
      .then((r) => setPrecincts(r.precincts.filter((p) => p.restaurants > 0)))
      .catch(() => setPrecincts([]))
  }, [])

  useEffect(() => {
    load(coords, veg)
  }, [coords, veg])

  /**
   * Uses the browser's own geolocation. The coordinates go to this app's API
   * only, to sort by distance — no map or geocoding service is involved.
   */
  const findNearMe = () => {
    if (!navigator.geolocation) {
      setLocationNote('This browser cannot share your location.')
      return
    }
    setLocating(true)
    setLocationNote('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocating(false)
      },
      () => {
        setLocating(false)
        setLocationNote('Location access was blocked. You can still search by name.')
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    )
  }

  const visible = useMemo(() => {
    if (!restaurants) return []
    const q = query.trim().toLowerCase()
    return restaurants.filter((r) => {
      const matchesQuery =
        !q || r.name.toLowerCase().includes(q) || r.categories.join(' ').toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      const matchesFilter =
        filter === 'All' || r.categories.some((c) => c.toLowerCase() === filter.toLowerCase())
      return matchesQuery && matchesFilter
    })
  }, [restaurants, query, filter])

  return (
    <div className="app">
      <Header />
      {/* The one line a restaurant needs and a customer does not.
          Somebody setting up a second phone should not have to find their way
          into the dashboard to do it — the code is typed on the phone that has
          no account, and this is the page that phone opens. It is one line, it
          is above everything, and it goes away for good when dismissed, so the
          people it is not for pay almost nothing for it. */}
      {/* Dismissal is honoured for the people it was aimed at and overridden
          for the one person it is now urgent for: somebody who has typed a
          code on this phone before — so they work somewhere — and whose alerts
          the server is not holding. Hiding it from them is hiding the only way
          back to the code, on the one phone that has stopped ringing. */}
      {(!staffStripGone || halfDone) && !alertsOn && (
        <div className="staff-strip">
          <Link to="/alerts">
            🔔 {halfDone ? 'Order alerts are off — turn them back on' : 'Work here? Turn on order alerts'} →
          </Link>
          <button
            aria-label="Hide this"
            onClick={() => {
              try {
                localStorage.setItem('khapee.staffStrip', 'hidden')
              } catch {
                /* a private window forgets it; one line is not worth failing over */
              }
              setStaffStripGone(true)
            }}
          >
            ✕
          </button>
        </div>
      )}
      <main className="page">
        {/* The name says it: kha-pee, eat and drink. The line under it stays in
            plain English so the page still explains itself to someone who does
            not read the joke. */}
        <div className="hero">
          <h1 className="hero-line">Kuch khapee lo.</h1>
          <p>Order at the table, from your car, or to your door.</p>
        </div>

        <div className="search-row">
          <input
            className="search-input"
            placeholder="Search restaurants or dishes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search restaurants"
          />
          <button
            className={`btn ${coords ? 'btn-accent' : 'btn-secondary'}`}
            onClick={coords ? () => setCoords(null) : findNearMe}
            disabled={locating}
          >
            {locating ? <Spinner /> : coords ? '📍 Nearest first' : '📍 Near me'}
          </button>
          <button
            className={`veg-toggle ${veg ? 'on' : ''}`}
            onClick={() => setVeg(!veg)}
            aria-pressed={veg}
            aria-label="Veg only"
          >
            <span className="veg-mark" aria-hidden />
            Veg
          </button>
        </div>
        {coords && nearestCity && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Near <strong>{nearestCity}</strong>
          </p>
        )}
        {locationNote && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {locationNote}
          </p>
        )}

        {tiles.length > 0 && (
          <div className="cuisine-bar">
            {[{ name: 'All', count: 0 }, ...tiles].map((c) => (
              <button
                key={c.name}
                className={`cuisine ${filter === c.name ? 'active' : ''}`}
                onClick={() => setFilter(c.name)}
              >
                <span className="cuisine-art" style={{ background: cuisineBackground(c.name) }} aria-hidden>
                  {cuisineEmoji(c.name)}
                </span>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {error && <ErrorState message={error} onRetry={() => load(coords)} />}

        {!restaurants && !error && (
          <div className="grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="r-card">
                <Skeleton className="r-card-art" />
                <div className="r-card-body">
                  <Skeleton style={{ height: 18, width: '60%' }} />
                  <Skeleton style={{ height: 13, width: '90%' }} />
                  <Skeleton style={{ height: 13, width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {restaurants && visible.length === 0 && (
          <EmptyState
            emoji="🔍"
            title="No restaurants match that"
            body="Try a different search term or clear the filter."
            action={
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setQuery('')
                  setFilter('All')
                }}
              >
                Clear filters
              </button>
            }
          />
        )}

        {restaurants && visible.length > 0 && (
          <div className="grid">
            {!query.trim() &&
              filter === 'All' &&
              precincts.map((p) => (
                <Link key={`p-${p.id}`} to={`/p/${p.slug}`} className="r-card area-card">
                  <div className="r-card-art area-art">
                    <span className="area-mark">{p.name}</span>
                  </div>
                  <div className="r-card-body">
                    <div className="r-card-title">
                      <h3>{p.name}</h3>
                      <span className="badge badge-accent">Area</span>
                    </div>
                    <p>{p.note || 'Order from any kitchen here and they bring it to you.'}</p>
                    <div className="r-card-meta">
                      <span>
                        {p.restaurants} place{p.restaurants === 1 ? '' : 's'}
                      </span>
                      <span className="dot-sep">{p.city}</span>
                      <span className="dot-sep">They come to you</span>
                    </div>
                  </div>
                </Link>
              ))}
            {visible.map((r, i) => (
              <Link key={r.id} to={`/r/${r.id}`} className="r-card" style={{ animationDelay: `${i * 45}ms` }}>
                <Art
                  emoji={r.emoji}
                  hue={r.hue}
                  imageUrl={r.imageUrl}
                  alt={r.name}
                  className={`r-card-art ${r.isOpen ? '' : 'closed-art'}`}
                />
                <div className="r-card-body">
                  <div className="r-card-title">
                    <h3>{r.name}</h3>
                    <span className={`badge ${r.isOpen ? 'badge-open' : 'badge-closed'}`}>
                      {r.isOpen ? 'Open' : 'Closed'}
                    </span>
                  </div>
                  <p>{r.description}</p>
                  <div className="r-card-meta">
                    {r.distanceKm != null && <span className="badge badge-info">{r.distanceKm} km</span>}
                    {r.rating ? <span>★ {r.rating.toFixed(1)}</span> : null}
                    <span className={r.rating || r.distanceKm != null ? 'dot-sep' : ''}>
                      {r.categories.join(' · ')}
                    </span>
                    <span className="dot-sep">{r.prepMinutes} min</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* The way in that does not depend on being guessed right.
            The line at the top of this page appears only when the app works
            out that alerts are off, and every way of working that out has been
            wrong at least once — a dismissal remembered too well, storage
            cleared, a browser that cannot do push read as a browser that does
            not need to. Each time, the effect was the same: the one person who
            needed the code page could not reach it, on the one phone that had
            stopped ringing. This is small, it is at the bottom, and it is
            always here. */}
        <footer className="home-foot">
          <Link to="/alerts">🔔 Work here? Turn on order alerts</Link>
        </footer>
      </main>
    </div>
  )
}
