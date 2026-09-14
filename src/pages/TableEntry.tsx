import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { LoadingBlock, ErrorState } from '../components/ui'
import { saveDining } from '../lib/dining'
import { saveTableContext } from '../lib/table-context'

/**
 * Landing page for a scanned table QR (/t/<token>).
 *
 * The QR on a table is the strongest proof there is that someone is sitting at
 * it, so scanning it opens a dining session the same way a staff code does.
 * It used to only remember the table and drop the customer on the menu, which
 * left them proving themselves all over again: the checkout still showed an
 * empty grid of every table to pick from, still asked for a code they had no
 * reason to have, and the order was refused anyway because nothing carried the
 * QR's token to the server. A QR stuck to table 2 now means table 2.
 */
export default function TableEntry() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ session: any }>('/sessions', { body: { value: `KHAPEE:TABLE:${token}` } })
      .then((r) => {
        saveDining(r.session)
        // Kept alongside the session: it is what the room and the payment
        // shortcut read to know which table QR was scanned.
        saveTableContext({
          restaurantId: r.session.restaurantId,
          restaurantName: r.session.restaurantName,
          tableId: r.session.tableId,
          tableLabel: r.session.tableLabel,
          tableToken: token,
        })
        navigate(`/r/${r.session.restaurantId}`, { replace: true })
      })
      .catch((e: ApiError) => setError(e.message))
  }, [token, navigate])

  return (
    <div className="app">
      <main className="page page-narrow">
        {error ? (
          <>
            <ErrorState message={error} />
            <div className="center">
              <Link className="btn btn-accent" to="/">
                Browse restaurants
              </Link>
            </div>
          </>
        ) : (
          <LoadingBlock label="Finding your table…" />
        )}
      </main>
    </div>
  )
}
