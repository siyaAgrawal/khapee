import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { Spinner } from '../components/ui'

/** "Forgot password?" — asks for the email and sends a one-time reset link to it. */
export default function Forgot() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState(() => (params.get('email') ?? '').trim().toLowerCase())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api<{ message: string }>('/auth/forgot', { body: { email: email.trim() } })
      setDone(r.message)
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link to="/" className="brand" style={{ marginBottom: 18 }}>
          khapee<span className="brand-dot" aria-hidden>.</span>
        </Link>
        <h1>Forgot your password?</h1>
        {done ? (
          <p className="muted">{done}</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: -4 }}>
              Enter your account email and we’ll send you a link to choose a new one.
            </p>
            {error && <div className="form-error">{error}</div>}
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>
              <button className="btn btn-accent btn-block btn-lg" disabled={busy}>
                {busy ? <Spinner /> : 'Send reset link'}
              </button>
            </form>
          </>
        )}
        <p className="auth-alt">
          Remembered it? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
