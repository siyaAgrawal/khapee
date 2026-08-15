import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useSession } from '../lib/session'
import { useCart } from '../lib/cart'

export default function Header() {
  const { user, logout } = useSession()
  const { count } = useCart()
  const navigate = useNavigate()

  return (
    <header className="header">
      <Link to="/" className="brand">
        <span className="brand-mark">◗</span>
        Ordro
      </Link>
      <div className="header-spacer" />
      <nav className="header-nav">
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Restaurants
        </NavLink>
        <NavLink to="/orders" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Orders
        </NavLink>
        {user ? (
          <>
            {user.restaurants?.length > 0 && (
              <NavLink to="/staff/orders" className="nav-link">
                Dashboard
              </NavLink>
            )}
            <button
              className="nav-link"
              style={{ border: 0, background: 'transparent', cursor: 'pointer' }}
              onClick={async () => {
                await logout()
                navigate('/')
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <NavLink to="/login" className="nav-link">
            Sign in
          </NavLink>
        )}
        {count > 0 && (
          <Link to="/cart" className="cart-pill">
            Cart <span className="cart-count">{count}</span>
          </Link>
        )}
      </nav>
    </header>
  )
}
