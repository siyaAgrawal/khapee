import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { Art, EmptyState, LoadingBlock } from '../components/ui'

type Place = {
  id: number
  name: string
  description: string
  categories: string[]
  emoji: string
  hue: number
  imageUrl: string | null
  prepMinutes: number
  isOpen: boolean
  rating: number | null
}
type Precinct = { id: number; slug: string; name: string; city: string; note: string }

/**
 * An area, as a list of the restaurants in it.
 *
 * Nothing more than that on purpose. This used to ask where you were standing
 * before it would show you anything, which put a form in front of a menu —
 * you cannot say where you want food brought before you know who has any.
 * Pick a restaurant, its own page opens exactly as it does from anywhere else,
 * and ordering to where you are standing is one of the ways to order on it,
 * beside eating in, takeaway and the kerb.
 */
export default function PrecinctEntry() {
  const { slug = '' } = useParams()
  const [data, setData] = useState<{ precinct: Precinct; restaurants: Place[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ precinct: Precinct; restaurants: Place[] }>(`/precincts/${slug}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
  }, [slug])

  if (error) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <EmptyState
            emoji="🗺️"
            title="Not on Khapee yet"
            body={error}
            action={
              <Link className="btn btn-accent" to="/">
                Browse restaurants
              </Link>
            }
          />
        </main>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="app">
        <Header />
        <main className="page">
          <LoadingBlock label="Looking up the area…" />
        </main>
      </div>
    )
  }

  const { precinct, restaurants } = data
  const open = restaurants.filter((r) => r.isOpen)

  return (
    <div className="app">
      <Header />
      <main className="page">
        <div className="hero">
          <h1 className="hero-line">{precinct.name}</h1>
          <p>
            {restaurants.length} place{restaurants.length === 1 ? '' : 's'} here
            {open.length ? `, ${open.length} open now` : ''}. Eat in, take it away, or have it brought to
            wherever you are in {precinct.name}.
          </p>
        </div>

        {restaurants.length === 0 ? (
          <EmptyState
            emoji="🍽️"
            title="Nobody here yet"
            body="No restaurant in this area is on Khapee with a menu yet."
          />
        ) : (
          <div className="grid">
            {[...open, ...restaurants.filter((r) => !r.isOpen)].map((r, i) => (
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
                    {r.rating ? <span className="rating">★ {r.rating.toFixed(1)}</span> : null}
                    <span className={r.rating ? 'dot-sep' : ''}>{r.categories.join(' · ')}</span>
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
