import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, openStream } from '../../lib/api'
import { useSession } from '../../lib/session'
import RestaurantSwitcher from '../../components/RestaurantSwitcher'

/**
 * Four places, not twelve.
 *
 * The old list named every screen in the app, which meant reading twelve
 * labels to find the one you wanted and, on a phone, five rows of them above
 * the work. These are the four jobs a restaurant actually does — take orders,
 * take money, keep the menu, set the place up — and each opens onto the views
 * that belong to it.
 */
const LINKS = [
  // Hints are short enough to fit the sidebar without being cut off.
  { to: '/staff/orders', label: 'Orders', hint: 'Live right now', icon: '🍳' },
  { to: '/staff/till', label: 'Till', hint: 'Sales & payments', icon: '💳' },
  { to: '/staff/menu', label: 'Menu', hint: 'Dishes & photos', icon: '📋' },
  { to: '/staff/settings', label: 'Settings', hint: 'Tables & setup', icon: '⚙️' },
]

export default function StaffLayout() {
  const { user, logout } = useSession()
  const navigate = useNavigate()
  const [newCount, setNewCount] = useState(0)

  const refresh = () =>
    api<{ summary: any }>('/staff/summary')
      .then((r) => setNewCount(r.summary?.newOrders ?? 0))
      .catch(() => {})

  useEffect(() => {
    refresh()
    const close = openStream(() => refresh())
    const poll = setInterval(refresh, 12000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [])

  return (
    <div className="staff-shell">
      <aside className="staff-side">
        <div className="brand">
          <span className="brand-mark">◗</span> Khapee
        </div>
        <RestaurantSwitcher />
        {/* `display: contents` on wide screens, so the sidebar is unchanged;
            on a phone this becomes the one row that scrolls sideways, instead
            of twelve links wrapping into five rows of chrome above the work. */}
        <nav className="side-links">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
              <span className="side-icon" aria-hidden>
                {l.icon}
              </span>
              <span className="side-text">
                {l.label}
                <em>{l.hint}</em>
              </span>
              {l.to === '/staff/orders' && newCount > 0 && <span className="pill">{newCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <NavLink to="/" className="side-link">
            <span aria-hidden>🍽️</span> Order as a customer
          </NavLink>
          <div className="side-user">
            <span className="tiny muted">{user?.email}</span>
            <button
              className="btn btn-ghost btn-sm btn-block"
              onClick={async () => {
                await logout()
                navigate('/login', { replace: true })
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="staff-main">
        <Outlet />
      </main>
    </div>
  )
}
