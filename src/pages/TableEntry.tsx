import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { LoadingBlock, ErrorState } from '../components/ui'
import { saveTableContext } from '../lib/table-context'

/**
 * Landing page for a scanned table QR (/t/<token>).
 * Remembers the table, then drops the customer straight into that menu.
 */
export default function TableEntry() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    api<any>('/resolve', { body: { value: `TABLO:TABLE:${token}` } })
      .then((r) => {
        saveTableContext({
          restaurantId: r.restaurantId,
          restaurantName: r.restaurantName,
          tableId: r.tableId,
          tableLabel: r.tableLabel,
          tableToken: r.tableToken,
        })
        navigate(`/r/${r.restaurantId}`, { replace: true })
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
              <Link className="btn btn-accent" to="/restaurants">
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
