import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { LoadingBlock, money, Spinner, useToast } from '../components/ui'
import { saveDining } from '../lib/dining'
import { applyTheme, type ThemeName } from '../lib/themes'
import { useSession } from '../lib/session'

type Area = { id: number; name: string; note: string; feeCents: number; minOrderCents: number }

/**
 * Ordering to your own address.
 *
 * The area is picked from the short list the restaurant actually delivers to,
 * not typed and not guessed from coordinates. A small kitchen knows the names of
 * the two or three localities it will carry an order to, and telling someone up
 * front that they are outside it is far kinder than accepting the order and
 * ringing back twenty minutes later.
 */
export default function DeliveryEntry() {
  const { id } = useParams()
  const restaurantId = Number(id)
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useSession()

  const [areas, setAreas] = useState<Area[] | null>(null)
  const [restaurant, setRestaurant] = useState<{ name: string; isOpen: boolean; theme?: string } | null>(null)
  const [areaId, setAreaId] = useState<number | null>(null)
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ areas: Area[] }>(`/restaurants/${restaurantId}/delivery-areas`)
      .then((r) => {
        setAreas(r.areas)
        if (r.areas.length === 1) setAreaId(r.areas[0].id)
      })
      .catch(() => setAreas([]))
    api<{ restaurant: { name: string; isOpen: boolean; theme?: string } }>(`/restaurants/${restaurantId}`)
      .then((r) => setRestaurant(r.restaurant))
      .catch(() => {})
  }, [restaurantId])

  useEffect(() => {
    if (user?.phone) setPhone(user.phone)
  }, [user])

  const area = areas?.find((a) => a.id === areaId) ?? null

  // This screen belongs to the restaurant, so it wears the restaurant's colours.
  useEffect(() => applyTheme((restaurant?.theme ?? '') as ThemeName), [restaurant?.theme])

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ session: any }>('/sessions/delivery', {
        body: { restaurantId, areaId, address: address.trim(), phone: phone.trim() },
      })
      saveDining(r.session)
      toast('Address saved — now pick your food', 'good')
      navigate(`/r/${restaurantId}`)
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <Header />
      <main className="page road-entry">
        <p className="road-kicker">{restaurant?.name ?? 'Delivery'}</p>
        <h1 className="road-title">Where are we bringing it?</h1>

        {error && <div className="form-error">{error}</div>}

        {areas === null ? (
          <LoadingBlock />
        ) : areas.length === 0 ? (
          <p className="muted">This restaurant isn&rsquo;t delivering at the moment.</p>
        ) : (
          <>
            <div className="zone-grid">
              {areas.map((a) => (
                <button
                  key={a.id}
                  className={`zone-card ${areaId === a.id ? 'on' : ''}`}
                  onClick={() => setAreaId(a.id)}
                  aria-pressed={areaId === a.id}
                >
                  <span className="zone-mark" aria-hidden>
                    ◎
                  </span>
                  <span className="zone-name">{a.name}</span>
                  {a.note && <span className="zone-note">{a.note}</span>}
                  <span className="zone-note">
                    {a.feeCents > 0 ? `${money(a.feeCents)} delivery` : 'Free delivery'}
                    {a.minOrderCents > 0 ? ` · ${money(a.minOrderCents)} minimum` : ''}
                  </span>
                </button>
              ))}
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Only these areas for now — it&rsquo;s a small kitchen and someone walks it over.
            </p>
          </>
        )}

        <h2 className="road-sub">Your address</h2>
        <textarea
          className="input"
          rows={3}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={area ? `Flat / house, building, near…  (${area.name})` : 'Flat / house, building, landmark'}
          maxLength={200}
        />

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="del-phone">Phone</label>
          <input
            id="del-phone"
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="For when they can't find the gate"
            maxLength={20}
          />
        </div>

        <button
          className="btn btn-accent btn-lg btn-block"
          disabled={busy || !areaId || address.trim().length < 8 || phone.replace(/\D/g, '').length < 10}
          onClick={start}
        >
          {busy ? <Spinner /> : 'Pick the food'}
        </button>
        <p className="tiny muted road-foot">
          The kitchen accepts the order before it&rsquo;s made — you&rsquo;ll see either way.{' '}
          <Link to={`/r/${restaurantId}`}>Just browse</Link> instead.
        </p>
      </main>
    </div>
  )
}
