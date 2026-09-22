import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../lib/session'
import { ApiError } from '../lib/api'
import { Spinner } from '../components/ui'
import { useInstall } from '../lib/install'

export default function Login() {
  const install = useInstall()
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
      /**
       * Everybody lands on Khapee, including the people who run a restaurant.
       *
       * Sending an owner straight to their board assumed that running a place
       * is the only reason they ever sign in, and it is not: the same account
       * orders lunch, checks another restaurant's menu, and looks at the app
       * the way a customer sees it — which is the one view somebody building
       * this needs most and the one that was hardest to reach, because signing
       * in took it away. The board is a tap from here and never went anywhere.
       *
       * Where somebody was heading before they were asked to sign in still
       * wins, staff pages included.
       */
      navigate(from || '/', { replace: true })
    } catch (err) {
      setError((err as ApiError).message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link to="/" className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark">◗</span> Khapee
        </Link>
        <h1>Welcome back</h1>

        {/* The screen a till is set up on. Somebody standing at a billing
            computer signs in here first and installs second, so the offer has
            to be here too — the dashboard's own is behind this page. */}
        {install.canInstall && (
          <button
            type="button"
            className="btn btn-secondary btn-block"
            style={{ marginBottom: 14 }}
            onClick={() => void install.install()}
          >
            ⬇ Install Khapee on this computer
          </button>
        )}

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
          Run a restaurant? <Link to="/for-restaurants">List it on Khapee</Link>
        </p>

        {/* There used to be a note here spelling out the address format every
            imported restaurant uses and the password they all start with. This
            page is open to anyone on the internet, and those accounts are real
            and still exist, so it was a list of working keys. Whoever runs a
            restaurant is handed its login directly. */}
      </div>
    </div>
  )
}
