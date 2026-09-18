import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../lib/session'
import { useCart } from '../lib/cart'
import JoinRoom from './JoinRoom'

export default function Header() {
  const { user, logout } = useSession()
  const { count } = useCart()
  const navigate = useNavigate()
  const [joining, setJoining] = useState(false)
  const { pathname } = useLocation()

  /**
   * Installed on a Home Screen there is no browser chrome, so there is no back
   * button anywhere — tap into a restaurant and the only way out is to close
   * the app. The browser has its own and does not need this one.
   */
  const installed =
    typeof window !== 'undefined' &&
    ((navigator as any).standalone === true ||
      window.matchMedia?.('(display-mode: standalone)')?.matches === true)

  return (
    <header className="header">
      {installed && pathname !== '/' && (
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="Back">
          ‹
        </button>
      )}
      <Link to="/" className="brand">
        <span className="brand-mark">◗</span>
        Khapee
      </Link>
      <div className="header-spacer" />
      <nav className="header-nav">
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Restaurants
        </NavLink>
        <NavLink to="/orders" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Orders
        </NavLink>
        {user && user.restaurants?.length > 0 && (
          <NavLink to="/staff/orders" className="nav-link">
            Dashboard
          </NavLink>
        )}
        <button className="nav-link" onClick={() => setJoining(true)}>
          Join
        </button>
        <NavLink to="/profile" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          {user ? 'Profile' : 'Sign in'}
        </NavLink>
        {count > 0 && (
          <Link to="/cart" className="cart-pill">
            Cart <span className="cart-count">{count}</span>
          </Link>
        )}
      </nav>
      <JoinRoom open={joining} onClose={() => setJoining(false)} />
    </header>
  )
}
