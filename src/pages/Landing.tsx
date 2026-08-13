import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { Art } from '../components/ui'
import type { RestaurantCard } from './Home'

const STEPS = [
  {
    icon: '📖',
    title: 'Browse the menu',
    body: 'Pick your restaurant and build your order before anyone comes to the table.',
  },
  {
    icon: '📍',
    title: 'Say where you are',
    body: 'Scan the QR on your table, enter the staff code, or choose pickup for later.',
  },
  {
    icon: '🔔',
    title: 'Watch it cook',
    body: 'The kitchen sees your order the second you place it. You follow every step live.',
  },
]

export default function Landing() {
  const { user } = useSession()
  const [featured, setFeatured] = useState<RestaurantCard[]>([])

  useEffect(() => {
    api<{ restaurants: RestaurantCard[] }>('/restaurants')
      .then((r) => setFeatured(r.restaurants.filter((x) => x.isOpen).slice(0, 4)))
      .catch(() => setFeatured([]))
  }, [])

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="brand">
          <span className="brand-mark">◗</span> Tablo
        </Link>
        <span style={{ flex: 1 }} />
        <Link to="/restaurants" className="nav-link">
          Browse
        </Link>
        {user ? (
          <Link to={user.role === 'staff' ? '/staff/orders' : '/orders'} className="btn btn-secondary btn-sm">
            {user.role === 'staff' ? 'Dashboard' : 'Your orders'}
          </Link>
        ) : (
          <Link to="/login" className="btn btn-secondary btn-sm">
            Sign in
          </Link>
        )}
      </header>

      <section className="landing-hero">
        <span className="eyebrow">Indore · dine in &amp; pickup</span>
        <h1>
          The menu is already{' '}
          {/* The break is decorative — CSS drops it on narrow screens. */}
          <br />
          in your hand.
        </h1>
        <p>
          Order from your table without waving anyone down, or have it waiting before you arrive.
          No app store, no card details, no queue.
        </p>
        <div className="landing-cta">
          <Link to="/restaurants" className="btn btn-accent btn-lg">
            Browse restaurants
          </Link>
          <Link to="/for-restaurants" className="btn btn-ghost btn-lg">
            I run a restaurant
          </Link>
        </div>
      </section>

      <section className="choose">
        <Link to="/restaurants" className="choose-card">
          <span className="choose-emoji">🍽️</span>
          <h3>I&rsquo;m hungry</h3>
          <p>Browse menus, order at your table or for pickup, and track it live. No account needed.</p>
          <span className="choose-go">Browse restaurants →</span>
        </Link>
        <Link to="/for-restaurants" className="choose-card">
          <span className="choose-emoji">🏪</span>
          <h3>I run a restaurant</h3>
          <p>Take orders on a live board, publish your menu and photos, print table QR codes.</p>
          <span className="choose-go">List your restaurant →</span>
        </Link>
      </section>

      {featured.length > 0 && (
        <section className="landing-section">
          <div className="section-head">
            <h2>Open right now</h2>
            <Link to="/restaurants" className="tiny" style={{ color: 'var(--accent)', fontWeight: 600 }}>
              See all →
            </Link>
          </div>
          <div className="strip">
            {featured.map((r) => (
              <Link key={r.id} to={`/r/${r.id}`} className="strip-card">
                <Art
                  emoji={r.emoji}
                  hue={r.hue}
                  imageUrl={r.imageUrl}
                  alt={r.name}
                  className="strip-art"
                  rounded={0}
                />
                <div className="strip-body">
                  <strong>{r.name}</strong>
                  <span className="tiny muted">{r.categories.slice(0, 2).join(' · ')}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="landing-section">
        <div className="section-head">
          <h2>How it works</h2>
        </div>
        <div className="steps-grid">
          {STEPS.map((s, i) => (
            <article key={s.title} className="step-card">
              <span className="step-index">{String(i + 1).padStart(2, '0')}</span>
              <span className="step-icon" aria-hidden>
                {s.icon}
              </span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-band">
        <div>
          <h2>Running a place in Indore?</h2>
          <p>
            List it in a couple of minutes. Add your menu and your own photos, print a QR for each
            table, and start taking orders — nothing to install, no commission plumbing.
          </p>
        </div>
        <Link to="/for-restaurants" className="btn btn-accent btn-lg">
          List your restaurant
        </Link>
      </section>

      <footer className="landing-foot">
        <div className="brand">
          <span className="brand-mark">◗</span> Tablo
        </div>
        <span className="tiny muted">Runs entirely on your own machine. No third-party services.</span>
        <div className="row" style={{ gap: 14 }}>
          <Link to="/restaurants" className="tiny muted">
            Browse
          </Link>
          <Link to="/login" className="tiny muted">
            Sign in
          </Link>
          <Link to="/for-restaurants" className="tiny muted">
            For restaurants
          </Link>
        </div>
      </footer>
    </div>
  )
}
