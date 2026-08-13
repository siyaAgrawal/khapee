import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { saveGroup } from '../lib/group'
import { useSession } from '../lib/session'
import { ErrorState, LoadingBlock, Spinner } from '../components/ui'

/**
 * Join screen for a group code. The restaurant, table and group are shown
 * before joining so nobody lands in the wrong table's order.
 */
export default function GroupJoin() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useSession()
  const [preview, setPreview] = useState<any>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ group: any }>(`/groups/${encodeURIComponent(code)}`)
      .then((r) => setPreview(r.group))
      .catch((e: ApiError) => setError(e.message))
  }, [code])

  useEffect(() => {
    if (user?.name && !name) setName(user.name)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const join = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api<{ groupToken: string; session: any }>('/groups/join', {
        body: { code, displayName: name.trim() },
      })
      saveGroup({ token: r.groupToken, code: r.session.code, restaurantId: r.session.restaurantId })
      navigate('/group', { replace: true })
    } catch (err) {
      setError((err as ApiError).message)
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <Header />
      <main className="page page-narrow">
        {error && !preview ? (
          <>
            <ErrorState message={error} />
            <div className="center">
              <Link className="btn btn-accent" to="/restaurants">
                Browse restaurants
              </Link>
            </div>
          </>
        ) : !preview ? (
          <LoadingBlock label="Finding the group…" />
        ) : (
          <div className="card card-pad" style={{ marginTop: 8 }}>
            <h1 style={{ fontSize: 26, marginBottom: 14 }}>Join group</h1>

            <div className="join-rows">
              <div>
                <span className="tiny muted">Restaurant</span>
                <strong>{preview.restaurantName}</strong>
              </div>
              <div>
                <span className="tiny muted">Table</span>
                <strong>{preview.tableLabel ?? '—'}</strong>
              </div>
              <div>
                <span className="tiny muted">Group</span>
                <strong className="mono">{preview.code}</strong>
              </div>
              <div>
                <span className="tiny muted">Already here</span>
                <strong>
                  {preview.memberCount} {preview.memberCount === 1 ? 'person' : 'people'}
                </strong>
              </div>
            </div>

            {preview.status === 'CLOSED' ? (
              <p className="form-error" style={{ marginTop: 16 }}>
                This group has already closed.
              </p>
            ) : (
              <form onSubmit={join} style={{ marginTop: 18 }}>
                {error && <div className="form-error">{error}</div>}
                <div className="field">
                  <label htmlFor="g-name">Your name</label>
                  <input
                    id="g-name"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Aarav"
                    autoComplete="name"
                    required
                  />
                  <span className="hint">So the table knows whose food is whose.</span>
                </div>
                <button className="btn btn-accent btn-lg btn-block" disabled={busy || name.trim().length < 2}>
                  {busy ? <Spinner /> : 'Join'}
                </button>
              </form>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
