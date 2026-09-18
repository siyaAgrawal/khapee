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
      /**
       * Where somebody lands is decided by what they run, not by how they
       * first signed up.
       *
       * `role` is written once, at registration, and never changes: an address
       * that ordered a coffee before it took over a restaurant is 'customer'
       * for good. Reading that here dropped the owner of two cafés onto the
       * customer home page every time they signed in, with the board they were
       * signing in for nowhere in sight. Membership is the thing that is true
       * now, and it is what requireStaff on the server already goes by.
       */
      const runsSomewhere = !!user.restaurantId || user.restaurants?.length > 0
      if (runsSomewhere) navigate(from?.startsWith('/staff') ? from : '/staff/orders', { replace: true })
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
          <span className="brand-mark">◗</span> Khapee
        </Link>
        <h1>Welcome back</h1>

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
