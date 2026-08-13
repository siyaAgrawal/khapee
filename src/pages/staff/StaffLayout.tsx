import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, openStream } from '../../lib/api'
import { useSession } from '../../lib/session'

const LINKS = [
  { to: '/staff/orders', label: 'Orders', icon: '🧾' },
  { to: '/staff/menu', label: 'Menu', icon: '📋' },
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
          <span className="brand-mark">◗</span> Tablo
        </div>
        <div className="staff-restaurant">
          <strong>{user?.restaurantName}</strong>
          <span>
            {user?.name} · {user?.jobTitle}
          </span>
        </div>
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <span aria-hidden>{l.icon}</span>
            {l.label}
            {l.to === '/staff/orders' && newCount > 0 && <span className="pill">{newCount}</span>}
          </NavLink>
        ))}
        <div className="side-foot">
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
      </aside>
      <main className="staff-main">
        <Outlet />
      </main>
    </div>
  )
}
