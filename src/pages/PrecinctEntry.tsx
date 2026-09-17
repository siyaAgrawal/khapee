import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { saveDining } from '../lib/dining'
import { Art, EmptyState, LoadingBlock, Spinner, useToast } from '../components/ui'

type Spot = { id: number; label: string; note: string }
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
}
type Precinct = { id: number; slug: string; name: string; city: string; note: string }

/**
 * Ordering from where you are standing.
 *
 * 140 in Indore already works like this without an app: you are outside one
 * café, you ring another, somebody carries your food over — then walks back to
 * be paid, and sometimes again to ask what you meant. Every screen in Khapee
 * until now has belonged to one restaurant. This one belongs to the street: say
 * where you are, and every kitchen willing to come to you is on the same page.
 *
 * It is the roadside flow with the car taken out. Somebody still leaves the
 * counter and finds a person who is not at a table, which is why the order has
 * to be accepted before it is cooked and why the runner is told a landmark
 * rather than an address.
 */
export default function PrecinctEntry() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [data, setData] = useState<{ precinct: Precinct; spots: Spot[]; restaurants: Place[] } | null>(null)
  const [error, setError] = useState('')
  const [spotId, setSpotId] = useState<number | null>(null)
  const [detail, setDetail] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    api<{ precinct: Precinct; spots: Spot[]; restaurants: Place[] }>(`/precincts/${slug}`)
      .then((r) => {
        setData(r)
        if (r.spots.length === 1) setSpotId(r.spots[0].id)
      })
      .catch((e: ApiError) => setError(e.message))
  }, [slug])

  const order = async (place: Place) => {
    if (!spotId) {
      toast('Say where you are first.', 'info')
      document.querySelector('.spot-grid')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setBusyId(place.id)
    try {
      const r = await api<{ session: any }>('/sessions/precinct', {
        body: { restaurantId: place.id, spotId, detail: detail.trim() },
      })
      saveDining(r.session)
      navigate(`/r/${place.id}`)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  if (error) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <EmptyState emoji="🗺️" title="Not on Khapee yet" body={error} action={<Link className="btn btn-accent" to="/">Browse restaurants</Link>} />
        </main>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <LoadingBlock label="Looking up the area…" />
        </main>
      </div>
    )
  }

  const { precinct, spots, restaurants } = data
  const open = restaurants.filter((r) => r.isOpen)
  const shut = restaurants.filter((r) => !r.isOpen)
  const chosen = spots.find((s) => s.id === spotId)

  return (
    <div className="app">
      <Header />
      <main className="page">
        <div className="hero">
          <h1 className="hero-line">{precinct.name}</h1>
          <p>{precinct.note || 'Order from any kitchen here and they bring it to you.'}</p>
        </div>

        <section className="card card-pad mt-3">
          <h2 style={{ marginBottom: 4 }}>Where are you?</h2>
          <p className="tiny muted mb-2">
            A landmark is enough — whoever brings it out knows the street better than a map does.
          </p>

          {spots.length === 0 ? (
            <p className="tiny muted">Nobody has mapped this area yet.</p>
          ) : (
            <div className="spot-grid">
              {spots.map((s) => (
                <button
                  key={s.id}
                  className={`spot-card ${spotId === s.id ? 'on' : ''}`}
                  onClick={() => setSpotId(s.id)}
                  aria-pressed={spotId === s.id}
                >
                  <strong>{s.label}</strong>
                  {s.note && <span>{s.note}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
            <label htmlFor="pr-detail">What should they look for? (optional)</label>
            <input
              id="pr-detail"
              className="input"
              value={detail}
              onChange={(e) => setDetail(e.target.value.slice(0, 140))}
              placeholder="Blue scooter, grey shirt"
            />
            <span className="hint">Two people at the same spot look the same from the door.</span>
          </div>
        </section>

        <div className="staff-head" style={{ marginTop: 26, marginBottom: 12 }}>
          <h2>{open.length} open now</h2>
          {chosen && <span className="badge badge-accent">{chosen.label}</span>}
        </div>

        {restaurants.length === 0 ? (
          <EmptyState
            emoji="🍽️"
            title="Nobody here yet"
            body="No restaurant in this area has turned this on. They can, from their own dashboard."
          />
        ) : (
          <div className="item-grid">
            {[...open, ...shut].map((r) => (
              <article key={r.id} className={`r-card ${r.isOpen ? '' : 'is-shut'}`}>
                <Link to={`/r/${r.id}`} className="r-card-art">
                  {r.imageUrl ? <img src={r.imageUrl} alt="" /> : <Art emoji={r.emoji} hue={r.hue} />}
                </Link>
                <div className="r-card-body">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{r.name}</strong>
                    <span className={`badge ${r.isOpen ? 'badge-open' : 'badge-closed'}`}>
                      {r.isOpen ? 'OPEN' : 'CLOSED'}
                    </span>
                  </div>
                  <p className="tiny muted">
                    {r.categories.slice(0, 3).join(' · ')}
                    {r.categories.length ? ' · ' : ''}~{r.prepMinutes} min
                  </p>
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <button
                      className="btn btn-accent btn-sm"
                      disabled={!r.isOpen || busyId === r.id}
                      onClick={() => order(r)}
                    >
                      {busyId === r.id ? <Spinner /> : 'Order to me'}
                    </button>
                    <Link className="btn btn-ghost btn-sm" to={`/r/${r.id}`}>
                      Just look
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="tiny muted center" style={{ marginTop: 22 }}>
          They accept the order before cooking it, then bring it to you. Pay when it arrives, or by UPI in
          the app so nobody has to walk back a second time.
        </p>
      </main>
    </div>
  )
}
