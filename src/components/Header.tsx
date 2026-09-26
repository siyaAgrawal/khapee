import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../lib/session'
import { useCart } from '../lib/cart'
import JoinRoom from './JoinRoom'
import { useInstall } from '../lib/install'
import { useTheme } from '../lib/theme'
import { DownloadIcon, MoonIcon, SunIcon } from './icons'

export default function Header() {
  const { user, logout } = useSession()
  const { theme, toggle } = useTheme()
  const { count } = useCart()
  const navigate = useNavigate()
  const [joining, setJoining] = useState(false)
  const { pathname } = useLocation()
  const install = useInstall()

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
      {/* The wordmark alone. The icon is the same word in a purple tile, so
          setting the tile next to the word spelt Khapee twice in one lockup —
          which is exactly what the home-screen icon is for and the header
          is not. */}
      <Link to="/" className="brand">
        khapee<span className="brand-dot" aria-hidden>.</span>
      </Link>
      <div className="header-spacer" />
      <nav className="header-nav">
        {/* Restaurants stays the first child: the phone breakpoint hides
            whatever is first here, and it is the link it is meant to hide —
            the wordmark beside it already goes home. */}
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Restaurants
        </NavLink>
        {/* Named for what it will do, not for what you are looking at. */}
        <button
          className="nav-link theme-toggle"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
          title={theme === 'dark' ? 'Light' : 'Dark'}
        >
          {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
        <NavLink to="/orders" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Orders
        </NavLink>
        {user && user.restaurants?.length > 0 && (
          <NavLink to="/staff/orders" className="nav-link">
            Dashboard
          </NavLink>
        )}
        {/* Offered to anybody, signed in or not.
            It used to live only in the dashboard's settings, which is behind a
            password — and the person setting up a till installs the app before
            they sign in to it, not after. The browser only raises the offer
            when it can actually be taken, so this appears exactly when it
            works and nowhere else. */}
        {install.canInstall && (
          <button className="nav-link nav-install" onClick={() => void install.install()}>
            <DownloadIcon size={14} />
            Install
          </button>
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
