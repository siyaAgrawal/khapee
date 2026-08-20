import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { LoadingBlock } from '../components/ui'
import Header from '../components/Header'

/**
 * A QR on a post at the roadside: "parked in Zone A? scan to order."
 *
 * The sign already knows the restaurant and the zone, so this only redirects —
 * the customer should never re-enter something a sign could tell us.
 */
export default function ZoneEntry() {
  const { token } = useParams()
  const navigate = useNavigate()

  useEffect(() => {
    api<{ zone: { id: number }; restaurantId: number }>(`/zones/${token}`)
      .then((r) => navigate(`/r/${r.restaurantId}/car?zone=${r.zone.id}`, { replace: true }))
      .catch(() => navigate('/', { replace: true }))
  }, [token, navigate])

  return (
    <div className="app">
      <Header />
      <main className="page">
        <LoadingBlock label="Finding your spot…" />
      </main>
    </div>
  )
}
