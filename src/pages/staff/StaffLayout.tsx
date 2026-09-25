import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, openStream } from '../../lib/api'
import { useSession } from '../../lib/session'
import RestaurantSwitcher from '../../components/RestaurantSwitcher'
import StaffSearch from '../../components/StaffSearch'
import { useOrderAlerts } from '../../lib/staff-alerts'
import { useInstall } from '../../lib/install'
import { useNewVersion } from '../../lib/version'

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
  const install = useInstall()
  const version = useNewVersion()
  const [newCount, setNewCount] = useState(0)
  /* Order alerts, switched on by being signed in rather than by finding a
     button. See src/lib/staff-alerts.ts for why this runs on every load. */
  const alerts = useOrderAlerts()

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
        {/* One box for the whole dashboard, above the four sections rather
            than inside one of them — the question "where is table 4's order"
            should not require knowing which screen answers it. */}
        <StaffSearch />
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
          {/* Khapee runs perfectly well in a tab, and on the machine that
              rings up the bills it is better as an app: its own icon, its own
              window, no address bar, and it can be set to open when the
              computer starts. Chrome will do all of that and never mentions
              it — so this asks. */}
          {install.canInstall && (
            <button
              className="side-link side-install"
              onClick={() => void install.install()}
            >
              <span aria-hidden>⬇</span> Install Khapee on this computer
            </button>
          )}
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
        {/* Unmissable and not dismissible.
            A till that is never closed never reloads, so it runs whatever
            build it opened with until somebody tells it otherwise — and
            reports faults from code that has not existed for days. This is
            the telling. */}
        {/*
          The one tap, and only when the browser genuinely needs one.

          A restaurant that is already ringing sees nothing here, ever. This
          is at the top of the dashboard rather than inside a settings page
          because a kitchen that is not being told about orders has a problem
          worth interrupting them about — and because the whole failure was
          that the old switch lived somewhere nobody looked.
        */}
        {alerts.status === 'ask' && (
          <div className="alert-bar">
            <span>
              <strong>Turn on order alerts for this device.</strong> You&rsquo;ll hear every order,
              even with Khapee closed.
              {alerts.error ? ` ${alerts.error}` : ''}
            </span>
            <button className="btn btn-accent btn-sm" disabled={alerts.busy} onClick={alerts.turnOn}>
              {alerts.busy ? 'Turning on…' : '🔔 Turn on alerts'}
            </button>
          </div>
        )}
        {alerts.status === 'blocked' && (
          <div className="alert-bar alert-bar-bad">
            <span>
              <strong>Order alerts are blocked in this browser.</strong> Allow notifications for this
              site in your browser settings, then reload — nothing will ring until you do.
            </span>
          </div>
        )}
        {alerts.status === 'install' && (
          <div className="alert-bar">
            <span>
              <strong>Add Khapee to your Home Screen to get order alerts.</strong> Tap Share, then
              Add to Home Screen — on iPhone, Apple only allows alerts to an installed app.
            </span>
          </div>
        )}

        {version.stale && (
          <div className="stale-bar">
            <span>
              <strong>Khapee has been updated.</strong> This computer is still running the old
              version — reload to pick it up.
            </span>
            <button className="btn btn-accent btn-sm" onClick={version.reload}>
              Reload now
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
