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
  const [slow, setSlow] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    /**
     * Keeps trying, because this is the one request the whole QR depends on and
     * the things that break it are all temporary.
     *
     * The app sleeps when nobody has ordered for a quarter of an hour and takes
     * the better part of a minute to wake; café wifi drops; a phone walking in
     * off the street hands over from mobile data. One attempt met any of those
     * with a dead end reading "Browse restaurants", which to whoever is sitting
     * at the table is simply a QR that does not work.
     *
     * Only a network failure is worth retrying. A token the server has actually
     * rejected — a QR from a table that was removed — will be rejected just as
     * firmly the fifth time, so that is reported at once.
     */
    const tryOnce = async (n: number) => {
      try {
        const r = await api<{ session: any }>('/sessions', { body: { value: `KHAPEE:TABLE:${token}` } })
        if (cancelled) return
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
      } catch (e) {
        if (cancelled) return
        const err = e as ApiError
        // status 0 is "could not reach it at all"; 5xx is a host still coming
        // up. Both pass. A 404 for a table that no longer exists, or a 400 for
        // a malformed code, is a real answer and is shown straight away.
        const worthRetrying = err.status === 0 || err.status >= 500
        if (!worthRetrying || n >= 6) {
          setError(err.message)
          return
        }
        setSlow(true)
        setAttempt(n + 1)
        // 1s, 2s, 4s, 8s, 10s, 10s — about half a minute of waking time.
        timer = setTimeout(() => tryOnce(n + 1), Math.min(1000 * 2 ** n, 10000))
      }
    }

    tryOnce(0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [token, navigate])

  return (
    <div className="app">
      <main className="page page-narrow">
        {error ? (
          <>
            <ErrorState message={error} />
            <div className="center" style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
              <button
                className="btn btn-accent"
                onClick={() => {
                  setError('')
                  setSlow(false)
                  setAttempt((n) => n + 1)
                  location.reload()
                }}
              >
                Try again
              </button>
              <Link className="btn btn-ghost btn-sm" to="/">
                Browse restaurants
              </Link>
            </div>
          </>
        ) : (
          <LoadingBlock
            label={slow ? `Waking the kitchen… (${attempt})` : 'Finding your table…'}
          />
        )}
      </main>
    </div>
  )
}
