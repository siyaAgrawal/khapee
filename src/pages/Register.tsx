import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../lib/session'
import { ApiError } from '../lib/api'
import { Spinner } from '../components/ui'

export default function Register() {
  const { register } = useSession()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [owner, setOwner] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await register(name.trim(), email.trim(), password)
      // One account, both ends. Ticking the box just carries you straight on to
      // the restaurant's details — nothing about the account itself differs.
      navigate(owner ? '/for-restaurants' : '/', { replace: true })
    } catch (err) {
      setError((err as ApiError).message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link to="/" className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark">◗</span> Ordro
        </Link>
        <h1>Create your account</h1>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <span className="hint">At least 6 characters.</span>
          </div>

          <label className="row tiny" style={{ gap: 10, margin: '2px 0 16px' }}>
            <button
              type="button"
              className={`switch ${owner ? 'on' : ''}`}
              onClick={() => setOwner(!owner)}
              aria-pressed={owner}
              aria-label="I run a restaurant"
            />
            I run a restaurant
          </label>

          <button className="btn btn-accent btn-block btn-lg" disabled={busy}>
            {busy ? <Spinner /> : owner ? 'Continue' : 'Create account'}
          </button>
        </form>

        <p className="auth-alt">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
