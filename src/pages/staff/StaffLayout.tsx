import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, openStream } from '../../lib/api'
import { useSession } from '../../lib/session'
import RestaurantSwitcher from '../../components/RestaurantSwitcher'

const LINKS = [
  { to: '/staff/orders', label: 'Orders', icon: '🧾' },
  { to: '/staff/menu', label: 'Menu', icon: '📋' },
  { to: '/staff/photos', label: 'Photos', icon: '📷' },
  { to: '/staff/payments', label: 'Payments', icon: '💸' },
  { to: '/staff/codes', label: 'Access codes', icon: '🔑' },
  { to: '/staff/tables', label: 'Tables', icon: '🪑' },
  { to: '/staff/verify', label: 'Verify order', icon: '📷' },
  { to: '/staff/profile', label: 'Restaurant', icon: '🏪' },
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
          <span className="brand-mark">◗</span> Ordro
        </div>
        <RestaurantSwitcher />
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <span aria-hidden>{l.icon}</span>
            {l.label}
            {l.to === '/staff/orders' && newCount > 0 && <span className="pill">{newCount}</span>}
          </NavLink>
        ))}
        <div className="side-foot">
          <NavLink to="/restaurants" className="side-link">
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
