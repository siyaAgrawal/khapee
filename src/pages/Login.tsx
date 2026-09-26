import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../lib/session'
import { ApiError } from '../lib/api'
import { Spinner } from '../components/ui'
import { useInstall } from '../lib/install'

export default function Login() {
  const install = useInstall()
  const { login } = useSession()
  const navigate = useNavigate()
  const location = useLocation() as any
  const [params] = useSearchParams()
  /**
   * The address can come in the link.
   *
   * Setting up a restaurant's till means reading an address off a message and
   * typing it into a machine behind a counter, and "vijaybhaiya@khapee.com"
   * gets mistyped about as often as it gets typed. A link carries it exactly,
   * leaving only the password — which is never put in a link, because a link
   * is pasted into chats, left in history, and sent on to other people.
   */
  const [email, setEmail] = useState(() => (params.get('email') ?? '').trim().toLowerCase())
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
       * Somebody who runs a restaurant lands on its dashboard.
       *
       * They sign in to take orders, and the restaurant list put a screen of
       * other people's menus between them and the order that was waiting. The
       * list is still a tap away from the dashboard for anyone who wants it.
       *
       * Where somebody was heading before they were asked to sign in still
       * wins, staff pages included.
       */
      navigate(from || (user.restaurants?.length ? '/staff' : '/'), { replace: true })
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
              /* The address arrived in the link, so the cursor belongs in the
                 only box still empty. */
              autoFocus={!!email}
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
