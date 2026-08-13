import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../lib/session'
import { ApiError } from '../lib/api'
import { Spinner } from '../components/ui'

export default function Login() {
  const { login } = useSession()
  const navigate = useNavigate()
  const location = useLocation() as any
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const user = await login(email.trim(), password)
      const from = location.state?.from as string | undefined
      if (user.role === 'staff') navigate(from?.startsWith('/staff') ? from : '/staff/orders', { replace: true })
      else navigate(from && !from.startsWith('/staff') ? from : '/', { replace: true })
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
        <h1>Welcome back</h1>
        <p>Sign in to track your orders, or to open your restaurant dashboard.</p>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={onSubmit}>
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
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn btn-accent btn-block btn-lg" disabled={busy}>
            {busy ? <Spinner /> : 'Sign in'}
          </button>
        </form>

        <p className="auth-alt">
          New here? <Link to="/register">Create an account</Link>
        </p>
        <p className="auth-alt" style={{ marginTop: 6 }}>
          Run a restaurant? <Link to="/for-restaurants">List it on Ordro</Link>
        </p>

        <div className="demo-box">
          <b>Restaurant logins</b> — each restaurant signs in with its own address, in the form{' '}
          <code>name@tablo.local</code> (for example <code>yazu-at-the-dome@tablo.local</code>).
          <br />
          Imported restaurants start with the password <code>password123</code> — change it once you
          hand the dashboard over.
        </div>
      </div>
    </div>
  )
}
