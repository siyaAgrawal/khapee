import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { useVegMode } from '../lib/veg'
import { useSession } from '../lib/session'
import { alertsLive, pushSupported } from '../lib/push'
import { Art, EmptyState, ErrorState, Skeleton, Spinner } from '../components/ui'
import { ArrowRightIcon, BellIcon, PinIcon, SearchIcon } from '../components/icons'

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
  /** Whether a typed staff code is offered beside the table QR. */
  codesEnabled?: boolean
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
  const { user } = useSession()
  /**
   * Only somebody who works at a restaurant is shown the alerts line: a
   * signed-in owner or staff member, or a phone that has been given an alert
   * code before. Customers never see it — to them it was noise above the menu.
   * A brand-new staff phone with no account still has the link at the bottom
   * of the page.
   */
  const worksHere = !!(user?.restaurants?.length)
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
      {((worksHere && !staffStripGone) || halfDone) && !alertsOn && (
        <div className="staff-strip">
          <Link to="/alerts">
            <BellIcon size={14} />
            {halfDone ? 'Order alerts are off — turn them back on' : 'Work here? Turn on order alerts'}
            <ArrowRightIcon size={14} />
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
        {/*
          Where you are, then the one loud line, then search — which is the
          order every app people already order from puts them in, and the
          reason those apps are easy: the block at the top holds the two
          things you always want, and the rest of the page is only food.
        */}
        <div className="hero">
          <div className="hero-place">
            <PinIcon size={17} />
            <span>
              <strong>{nearestCity || 'Indore'}</strong>
              <small>Madhya Pradesh, India</small>
            </span>
          </div>

          {/* The app's name, said out loud. The only line in the product set
              in the loud face, which is what lets it be this loud. */}
          <h1 className="hero-line">kuch khapee lo.</h1>

          <div className="search-row">
            <span className="search-mark" aria-hidden>
              <SearchIcon size={18} />
            </span>
            <input
              className="search-input"
              placeholder="Restaurant name or a dish…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search restaurants"
            />
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
        </div>

        {/* Cuisines as tabs with a rule under the chosen one, not as a row of
            filled pills. A pill is a thing you switch on; a tab is a place you
            are standing, which is what choosing a cuisine actually is. */}
        {tiles.length > 0 && (
          <div className="cuisine-bar">
            {[{ name: 'All', count: 0 }, ...tiles].map((c) => (
              <button
                key={c.name}
                className={`cuisine ${filter === c.name ? 'active' : ''}`}
                onClick={() => setFilter(c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* The filters, under the tabs — one outlined row, the way every app
            of this kind arranges the same two ideas. */}
        <div className="filter-row">
          <button
            className={`filter-chip ${coords ? 'on' : ''}`}
            onClick={coords ? () => setCoords(null) : findNearMe}
            disabled={locating}
          >
            {locating ? <Spinner /> : <PinIcon size={15} />}
            {coords ? 'Nearest first' : 'Near me'}
          </button>
        </div>
        {locationNote && (
          <p className="tiny muted" style={{ marginTop: 10 }}>
            {locationNote}
          </p>
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
            mark={<SearchIcon size={22} />}
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

        {/*
          Areas, as a rail rather than as cards in the list.
          An area is not a restaurant and there are two or three of them, so as
          full-height cards they were two enormous purple blocks that pushed
          every actual restaurant off the first screen. A short sideways rail
          is what this kind of "a whole street at once" row is in any app that
          has one: available, obviously different, and out of the way.
        */}
        {!query.trim() && filter === 'All' && precincts.length > 0 && (
          <section className="area-section">
            <div className="list-head">
              <h2>Order from a whole area</h2>
            </div>
            <div className="area-rail">
              {precincts.map((p) => (
                <Link key={`p-${p.id}`} to={`/p/${p.slug}`} className="area-tile">
                  <span className="area-tile-kicker">Area</span>
                  <span className="area-tile-name">{p.name}</span>
                  <span className="area-tile-meta">
                    {p.restaurants} place{p.restaurants === 1 ? '' : 's'} · they come to you
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {restaurants && visible.length > 0 && (
          <>
            {/* The list had no heading, so the page went from a row of filters
                straight into cards. Plain words: the headline at the top of
                the screen is where the app is allowed to have a voice, and a
                list of restaurants is a list of restaurants. */}
            <div className="list-head">
              <h2>{visible.length} places near you</h2>
            </div>
            <div className="grid">
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
                  {/* Name and rating on one line, the way every list of
                      places to eat sets them: the score is what the eye goes
                      to first and it belongs beside the name, not buried in
                      the row of metadata underneath. */}
                  <div className="r-card-title">
                    <h3>{r.name}</h3>
                    {r.rating ? <span className="rating">★ {r.rating.toFixed(1)}</span> : null}
                  </div>
                  <p>{r.description}</p>
                  <div className="r-card-meta">
                    <span className={`badge ${r.isOpen ? 'badge-open' : 'badge-closed'}`}>
                      {r.isOpen ? 'Open' : 'Closed'}
                    </span>
                    <span className="dot-sep">{r.categories.join(' · ')}</span>
                    <span className="dot-sep">{r.prepMinutes} min</span>
                    {r.distanceKm != null && <span className="dot-sep">{r.distanceKm} km</span>}
                  </div>
                </div>
              </Link>
            ))}
            </div>
          </>
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
          <Link to="/alerts">
            <BellIcon size={14} />
            Work here? Turn on order alerts
          </Link>
        </footer>
      </main>
    </div>
  )
}
