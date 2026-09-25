import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, setToken } from '../lib/api'
import { useSession } from '../lib/session'
import { Spinner } from '../components/ui'

/** Restaurant owners create their account and their restaurant in one step. */
export default function RegisterRestaurant() {
  const navigate = useNavigate()
  const { user, refresh } = useSession()
  // Signed in already? This adds a restaurant to the account you have.
  const adding = !!user
  const [form, setForm] = useState({
    restaurantName: '',
    address: '',
    categories: '',
    name: '',
    email: '',
    password: '',
    tables: 6,
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key: keyof typeof form, value: string | number) => setForm({ ...form, [key]: value })

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await api<{ token?: string }>('/auth/register-restaurant', {
        body: {
          restaurantName: form.restaurantName.trim(),
          address: form.address.trim(),
          categories: form.categories,
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          tables: form.tables,
        },
      })
      if (r.token) setToken(r.token)
      await refresh()
      navigate('/staff/profile', { replace: true })
    } catch (err) {
      setError((err as ApiError).message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ width: 'min(100%, 460px)' }}>
        <Link to="/" className="brand" style={{ marginBottom: 18 }}>
          khapee<span className="brand-dot" aria-hidden>.</span>
        </Link>
        <h1>{adding ? 'Add a restaurant' : 'List your restaurant'}</h1>
        {adding && <p>On {user!.name}&rsquo;s account</p>}

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="r-name">Restaurant name</label>
            <input
              id="r-name"
              className="input"
              value={form.restaurantName}
              onChange={(e) => set('restaurantName', e.target.value)}
              placeholder="Vijay Nagar Coffee Works"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="r-address">Address</label>
            <input
              id="r-address"
              className="input"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="Shop 4, Scheme 54, Indore"
            />
          </div>
          <div className="field">
            <label htmlFor="r-cats">Cuisines</label>
            <input
              id="r-cats"
              className="input"
              value={form.categories}
              onChange={(e) => set('categories', e.target.value)}
              placeholder="Cafe, Coffee, Snacks"
            />
            <span className="hint">Comma separated.</span>
          </div>
          <div className="field">
            <label htmlFor="r-tables">How many tables?</label>
            <input
              id="r-tables"
              className="input"
              type="number"
              min={0}
              max={40}
              value={form.tables}
              onChange={(e) => set('tables', Number(e.target.value))}
            />
            <span className="hint">Each gets a printable QR code.</span>
          </div>

          {adding ? null : (
          <>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

          <div className="field">
            <label htmlFor="r-owner">Your name</label>
            <input
              id="r-owner"
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              autoComplete="name"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="r-email">Email</label>
            <input
              id="r-email"
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="r-password">Password</label>
            <input
              id="r-password"
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <span className="hint">At least 6 characters.</span>
          </div>
          </>
          )}

          <button className="btn btn-accent btn-block btn-lg" disabled={busy}>
            {busy ? <Spinner /> : adding ? 'Add restaurant' : 'Create restaurant'}
          </button>
        </form>

        {adding ? (
          <p className="auth-alt">
            <Link to="/staff/orders">← Back to the dashboard</Link>
          </p>
        ) : (
          <>
            <p className="auth-alt">
              Already listed? <Link to="/login">Sign in</Link>
            </p>
            <p className="auth-alt" style={{ marginTop: 6 }}>
              Already have a customer account? <Link to="/login">Sign in first</Link> — you can run a
              restaurant from the same account.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
