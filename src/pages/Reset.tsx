import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { Spinner, useToast } from '../components/ui'

/** Opened from the emailed link: choose a new password, once. */
export default function Reset() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== again) {
      setError('The two passwords don’t match.')
      return
    }
    setBusy(true)
    try {
      const r = await api<{ user: { email: string } }>('/auth/reset', { body: { token, password } })
      toast('Password changed. Sign in with your new password.', 'good')
      navigate(`/login?email=${encodeURIComponent(r.user?.email ?? '')}`, { replace: true })
    } catch (err) {
      setError((err as ApiError).message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link to="/" className="brand" style={{ marginBottom: 18 }}>
          khapee<span className="brand-dot" aria-hidden>.</span>
        </Link>
        <h1>Choose a new password</h1>
        {!token ? (
          <p className="muted">
            This link is incomplete. <Link to="/forgot">Ask for a new one</Link>.
          </p>
        ) : (
          <>
            {error && (
              <div className="form-error">
                {error} {/expired|used|not valid/i.test(error) && <Link to="/forgot">Get a new link</Link>}
              </div>
            )}
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="pw">New password</label>
                <input
                  id="pw"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pw2">Type it again</label>
                <input
                  id="pw2"
                  className="input"
                  type="password"
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <p className="tiny muted" style={{ marginTop: -4 }}>
                At least 8 characters. Every device signed in to this account will be signed out.
              </p>
              <button className="btn btn-accent btn-block btn-lg" disabled={busy}>
                {busy ? <Spinner /> : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
