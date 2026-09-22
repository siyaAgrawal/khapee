import { useEffect, useState } from 'react'
import { api, ApiError, setToken } from '../../lib/api'
import ImagePicker from '../../components/ImagePicker'
import LiveStrip from '../../components/LiveStrip'
import { useSession } from '../../lib/session'
import { useInstall } from '../../lib/install'
import { Art, LoadingBlock, Spinner, useToast } from '../../components/ui'

type Profile = {
  id: number
  name: string
  description: string
  address: string
  phone: string
  categories: string[]
  emoji: string
  hue: number
  hours: string
  prepMinutes: number
  isOpen: boolean
  imageUrl: string | null
  city: string
  lat: number | null
  lng: number | null
  upiVpa: string
  upiName: string
  acceptsPickup: boolean
  acceptsTakeaway: boolean
  acceptsGroups: boolean
  publishedAt: string | null
  itemCount: number
  isListed: boolean
}

const EMOJI_CHOICES = ['🍽️', '☕', '🍕', '🍝', '🍔', '🍜', '🍛', '🥘', '🌮', '🍣', '🥗', '🧁', '🍦', '🥤', '🫓', '🍢']

/**
 * The account itself, rather than the restaurant it manages.
 *
 * Until this existed a restaurant could edit its menu and its photos but not
 * the login it was handed, so the password whoever set it up chose was the
 * password forever, and the address on the account could never move to the
 * people actually running the place. Both need the current password: everything
 * else on this screen is recoverable, and these two are not.
 */
function SignIn() {
  const toast = useToast()
  const { user, refresh } = useSession()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [email, setEmail] = useState('')
  const [next, setNext] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user?.email) setEmail(user.email)
  }, [user?.email])

  const changed = email.trim().toLowerCase() !== (user?.email ?? '').toLowerCase() || next.length > 0

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body: Record<string, string> = { currentPassword: current }
      if (email.trim().toLowerCase() !== (user?.email ?? '').toLowerCase()) body.email = email.trim()
      if (next) body.newPassword = next
      const r = await api<{ token: string }>('/auth/me/credentials', { body })
      // The server ended every session including this one; carry on with the
      // replacement rather than bouncing the person to the sign-in screen.
      setToken(r.token)
      await refresh()
      setCurrent('')
      setNext('')
      setOpen(false)
      toast('Sign-in updated. Other devices will need it again.', 'good')
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card card-pad">
      <h2 style={{ marginBottom: 6 }}>Sign in</h2>
      <p className="tiny muted mb-2">
        The email and password for this account. Change them when the restaurant takes it over.
      </p>
      <div className="list-row">
        <span style={{ fontSize: 14 }} className="mono">
          {user?.email}
        </span>
        <span className="spacer" />
        {!open && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
            Change
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={save} style={{ marginTop: 12 }}>
          {error && <div className="form-error">{error}</div>}
          <div className="field">
            <label htmlFor="cr-current">Current password</label>
            <input
              id="cr-current"
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="field">
            <label htmlFor="cr-email">Email</label>
            <input
              id="cr-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoCapitalize="none"
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="cr-new">New password</label>
            <input
              id="cr-new"
              className="input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="Leave blank to keep the current one"
              autoComplete="new-password"
            />
            <span className="hint">At least 8 characters.</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-accent" disabled={saving || !current || !changed}>
              {saving ? <Spinner /> : 'Update sign-in'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setOpen(false)
                setError('')
                setCurrent('')
                setNext('')
                setEmail(user?.email ?? '')
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * Putting Khapee on the machine that rings up the bills.
 *
 * Always says something, which is the point. The first version only rendered
 * a button when the browser offered one, so on an iPhone — where Safari never
 * makes the offer and the route is Share, then Add to Home Screen — there was
 * nothing on screen at all, and "I cannot see the install option" is the only
 * possible outcome. A screen that knows it cannot help should say which
 * browser can.
 */
function InstallPanel() {
  const install = useInstall()

  return (
    <section className="card card-pad">
      <h2 style={{ marginBottom: 6 }}>Install Khapee here</h2>
      <p className="tiny muted mb-2">
        Its own icon and window, no address bar, and it can open when the computer starts. Nothing is
        downloaded — it is the same Khapee, kept on this machine.
      </p>

      {install.route === 'installed' ? (
        <p className="tiny">✓ Already installed on this device. You are using it now.</p>
      ) : install.route === 'button' ? (
        <button className="btn btn-accent" onClick={() => void install.install()}>
          Install Khapee
        </button>
      ) : install.route === 'menu' ? (
        /* Chrome and Edge both install web apps, and both have a menu item
           that works whenever you like — the automatic button is a
           convenience on top, not the mechanism. Saying "this browser cannot
           install it" to a Windows machine running Chrome, which is what this
           did, was simply wrong. */
        <>
          <p className="tiny muted mb-2">
            Your browser can install it from its own menu — it has not offered the button here, which
            usually means it is already installed, or you have opened this page before.
          </p>
          <ol className="alert-steps">
            <li>
              Click the <strong>⋮</strong> menu at the top right of the browser.
            </li>
            <li>
              Choose <strong>Cast, save and share</strong>, then{' '}
              <strong>Install page as app</strong>. On Edge it is <strong>Apps</strong>, then{' '}
              <strong>Install this site as an app</strong>.
            </li>
            <li>Confirm. Khapee gets its own icon and window.</li>
          </ol>
          <p className="tiny muted">
            If there is no such item, it is already installed — look in the Start menu for Khapee.
          </p>
        </>
      ) : install.route === 'ios' ? (
        <ol className="alert-steps">
          <li>
            At the bottom of Safari, tap the <strong>Share</strong> button — the square with an arrow
            coming out of it.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
          <li>Open Khapee from the new icon. Safari has no other way to do this.</li>
        </ol>
      ) : (
        <p className="tiny muted">
          This browser does not install web apps. On a computer use <strong>Chrome</strong> or{' '}
          <strong>Edge</strong>, on Android use Chrome, and on an iPhone use Safari — Share, then Add
          to Home Screen.
        </p>
      )}
    </section>
  )
}

export default function StaffProfile() {
  const toast = useToast()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ restaurant: Profile }>('/staff/restaurant')
      .then((r) => {
        setProfile(r.restaurant)
        setForm(r.restaurant)
      })
      .catch((e: ApiError) => setError(e.message))
  }, [])

  if (error) return <div className="form-error">{error}</div>
  if (!form || !profile) return <LoadingBlock />

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setForm({ ...form, [key]: value })

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const r = await api<{ restaurant: Profile; justPublished: boolean }>('/staff/restaurant', {
        method: 'PATCH',
        body: {
          publish: true,
          name: form.name,
          description: form.description,
          address: form.address,
          phone: form.phone,
          hours: form.hours,
          emoji: form.emoji,
          hue: form.hue,
          prepMinutes: form.prepMinutes,
          categories: form.categories,
          city: form.city,
          upiVpa: form.upiVpa,
          upiName: form.upiName,
          acceptsPickup: form.acceptsPickup,
          acceptsTakeaway: form.acceptsTakeaway,
          acceptsGroups: form.acceptsGroups,
          lat: form.lat,
          lng: form.lng,
        },
      })
      setProfile(r.restaurant)
      setForm(r.restaurant)
      toast(
        r.justPublished ? "You're on the app" : r.restaurant.isListed ? 'Saved' : 'Add a dish to go live',
        r.justPublished || r.restaurant.isListed ? 'good' : 'info',
      )
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setSaving(false)
    }
  }

  const toggleOpen = async () => {
    try {
      const r = await api<{ isOpen: boolean }>('/staff/restaurant/open', { body: { isOpen: !form.isOpen } })
      setForm({ ...form, isOpen: r.isOpen })
      setProfile({ ...profile, isOpen: r.isOpen })
      toast(r.isOpen ? 'You are open for orders' : 'Closed — customers cannot order', r.isOpen ? 'good' : 'info')
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    }
  }

  return (
    <>
      <div className="staff-head">
        <div className="spacer" />
        <span className={`badge ${form.isOpen ? 'badge-open' : 'badge-closed'}`}>
          {form.isOpen ? 'Accepting orders' : 'Closed'}
        </span>
        <button
          className={`switch ${form.isOpen ? 'on' : ''}`}
          onClick={toggleOpen}
          aria-pressed={form.isOpen}
          aria-label="Toggle open for orders"
        />
      </div>

      {error && <div className="form-error">{error}</div>}

      <LiveStrip restaurantId={form.id} isListed={form.isListed} isOpen={form.isOpen} onOpen={toggleOpen} />

      <div className="edit-grid">
        <form className="card card-pad" onSubmit={save}>
          <h2 style={{ marginBottom: 14 }}>Details</h2>

          <div className="field">
            <label htmlFor="p-name">Name</label>
            <input id="p-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="p-desc">Short description</label>
            <textarea
              id="p-desc"
              className="textarea"
              value={form.description}
              maxLength={300}
              onChange={(e) => set('description', e.target.value)}
              placeholder="One line customers see on your card."
            />
          </div>

          <div className="field">
            <label htmlFor="p-cats">Cuisines</label>
            <input
              id="p-cats"
              className="input"
              value={form.categories.join(', ')}
              onChange={(e) => set('categories', e.target.value.split(',').map((c) => c.trim()))}
              placeholder="Cafe, Coffee, Bakery"
            />
            <span className="hint">Comma separated, up to six.</span>
          </div>

          <div className="field">
            <label htmlFor="p-address">Address</label>
            <input
              id="p-address"
              className="input"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="Shop 4, Vijay Nagar, Indore"
            />
          </div>

          <div className="row row-wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="p-phone">Phone</label>
              <input id="p-phone" className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="p-hours">Opening hours</label>
              <input id="p-hours" className="input" value={form.hours} onChange={(e) => set('hours', e.target.value)} />
            </div>
            <div className="field" style={{ width: 150 }}>
              <label htmlFor="p-prep">Prep time (min)</label>
              <input
                id="p-prep"
                className="input"
                type="number"
                min={1}
                max={180}
                value={form.prepMinutes}
                onChange={(e) => set('prepMinutes', Number(e.target.value))}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="p-city">City</label>
            <input
              id="p-city"
              className="input"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              placeholder="Indore"
            />
          </div>

          <div className="field">
            <label>Map pin</label>
            <div className="row row-wrap">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (!navigator.geolocation) {
                    toast('This browser cannot share a location.', 'bad')
                    return
                  }
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      setForm({ ...form, lat: pos.coords.latitude, lng: pos.coords.longitude })
                      toast('Pinned to where you are now — remember to save.', 'good')
                    },
                    () => toast('Location access was blocked.', 'bad'),
                  )
                }}
              >
                📍 Use my current location
              </button>
              {form.lat != null && form.lng != null ? (
                <span className="tiny muted mono">
                  {form.lat.toFixed(4)}, {form.lng.toFixed(4)}
                </span>
              ) : (
                <span className="tiny muted">Not pinned — you won&rsquo;t appear in &ldquo;near me&rdquo;.</span>
              )}
            </div>
          </div>

          <button className="btn btn-accent btn-lg" disabled={saving}>
            {saving ? <Spinner /> : 'Done'}
          </button>
        </form>

        <div className="stack">
          <InstallPanel />

          <section className="card card-pad">
            <h2 style={{ marginBottom: 12 }}>Cover photo</h2>
            <ImagePicker
              imageUrl={form.imageUrl}
              emoji={form.emoji}
              hue={form.hue}
              uploadPath="/staff/restaurant/image"
              label={form.name}
              onChange={(imageUrl) => {
                setForm({ ...form, imageUrl })
                setProfile({ ...profile, imageUrl })
              }}
            />
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 6 }}>How you take orders</h2>
            <p className="tiny muted mb-2">Turn off anything you don&rsquo;t offer.</p>
            {(
              [
                ['acceptsTakeaway', 'Takeaway at the counter'],
                ['acceptsPickup', 'Order ahead for pickup'],
                ['acceptsGroups', 'Shared group tables'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="list-row">
                <span style={{ fontSize: 14 }}>{label}</span>
                <span className="spacer" />
                <button
                  type="button"
                  className={`switch ${form[key] ? 'on' : ''}`}
                  aria-pressed={form[key]}
                  aria-label={label}
                  onClick={() => set(key, !form[key] as never)}
                />
              </div>
            ))}
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 6 }}>UPI</h2>
            <p className="tiny muted mb-2">
              Customers pay straight into this UPI ID from their own app. Khapee shows the request and
              records what they claim — you confirm it under Payments. No payment provider, no fees
              through us.
            </p>
            <div className="field">
              <label htmlFor="p-vpa">Your UPI ID</label>
              <input
                id="p-vpa"
                className="input"
                value={form.upiVpa}
                onChange={(e) => set('upiVpa', e.target.value.trim())}
                placeholder="restaurant@okhdfcbank"
                autoCapitalize="none"
              />
            </div>
            <div className="field">
              <label htmlFor="p-upiname">Name shown while paying</label>
              <input
                id="p-upiname"
                className="input"
                value={form.upiName}
                onChange={(e) => set('upiName', e.target.value)}
                placeholder={form.name}
              />
            </div>
            {!form.upiVpa && (
              <div className="notice" style={{ marginTop: 4 }}>
                <span aria-hidden>⚡</span>
                <div>
                  <strong>Add this and customers skip the code</strong>
                  <p className="tiny">
                    When someone pays in the app, paying is itself the proof they are here — no
                    asking staff for a code, no typing. Leave it blank to take payment at the
                    counter only.
                  </p>
                </div>
              </div>
            )}
          </section>


          <SignIn />

          <section className="card card-pad">
            <h2 style={{ marginBottom: 6 }}>Fallback artwork</h2>
            <p className="tiny muted mb-2">Shown when you have no cover photo.</p>
            <div className="row" style={{ gap: 14 }}>
              <Art emoji={form.emoji} hue={form.hue} className="preview-art" />
              <div style={{ flex: 1 }}>
                <div className="emoji-grid">
                  {EMOJI_CHOICES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={`emoji-btn ${form.emoji === e ? 'selected' : ''}`}
                      onClick={() => set('emoji', e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <label className="tiny muted" htmlFor="p-hue" style={{ display: 'block', margin: '12px 0 4px' }}>
                  Colour
                </label>
                <input
                  id="p-hue"
                  className="hue-slider"
                  type="range"
                  min={0}
                  max={360}
                  value={form.hue}
                  onChange={(e) => set('hue', Number(e.target.value))}
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
