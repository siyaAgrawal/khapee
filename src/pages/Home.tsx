import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { Art, EmptyState, ErrorState, Skeleton, Spinner } from '../components/ui'

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
}

export default function Home() {
  const [restaurants, setRestaurants] = useState<RestaurantCard[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [nearestCity, setNearestCity] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationNote, setLocationNote] = useState('')

  const load = (position?: { lat: number; lng: number } | null) => {
    setError('')
    setRestaurants(null)
    const q = position ? `?lat=${position.lat}&lng=${position.lng}` : ''
    api<{ restaurants: RestaurantCard[]; nearestCity: string | null }>(`/restaurants${q}`)
      .then((r) => {
        setRestaurants(r.restaurants)
        setNearestCity(r.nearestCity)
      })
      .catch((e: ApiError) => setError(e.message))
  }

  useEffect(() => {
    load(coords)
  }, [coords])

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

  const cuisines = useMemo(() => {
    const set = new Set<string>()
    restaurants?.forEach((r) => r.categories.forEach((c) => set.add(c)))
    return ['All', ...[...set].sort()]
  }, [restaurants])

  const visible = useMemo(() => {
    if (!restaurants) return []
    const q = query.trim().toLowerCase()
    return restaurants.filter((r) => {
      const matchesQuery =
        !q || r.name.toLowerCase().includes(q) || r.categories.join(' ').toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      const matchesFilter = filter === 'All' || r.categories.includes(filter)
      return matchesQuery && matchesFilter
    })
  }, [restaurants, query, filter])

  return (
    <div className="app">
      <Header />
      <main className="page">
        <div className="hero">
          <h1>Order at the table, or ahead of time.</h1>
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

        {restaurants && restaurants.length > 0 && (
          <div className="chip-row">
            {cuisines.map((c) => (
              <button key={c} className={`chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
                {c}
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
      </main>
    </div>
  )
}
