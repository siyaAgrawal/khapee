import { NavLink } from 'react-router-dom'

export type SectionTab = { to: string; label: string; end?: boolean; count?: number }

/**
 * The second level of the dashboard.
 *
 * The sidebar used to list twelve destinations — Till, Floor, Deliveries,
 * Orders, Menu, Photos, Payments, Access codes, Tables, Roadside zones, Verify
 * order, Restaurant — which is a list to read rather than a place to work, and
 * on a phone it was five rows of it before anything useful. They collapse into
 * four sections, each holding the handful of views that belong to one job, and
 * this is how you move between them.
 */
export default function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  if (tabs.length < 2) return null
  return (
    <nav className="section-tabs" aria-label="Section views">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => `section-tab ${isActive ? 'active' : ''}`}
        >
          {t.label}
          {t.count ? <span className="section-tab-count">{t.count}</span> : null}
        </NavLink>
      ))}
    </nav>
  )
}
