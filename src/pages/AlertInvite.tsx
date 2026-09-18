import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { ErrorState, LoadingBlock, Spinner, useToast } from '../components/ui'
import { needsHomeScreen, pushFacts, pushSupported, workerReady } from '../lib/push'

/**
 * Putting order alerts on one phone, without handing over the password.
 *
 * The password is the wrong thing to give somebody who only needs their phone
 * to buzz: it is the whole dashboard, it shows every order and every
 * customer's number, and it cannot be taken back without changing it for
 * everyone. This link grants one capability to one device and is spent the
 * moment that device takes it.
 */
export default function AlertInvite() {
  const { token: fromLink = '' } = useParams()
  /**
   * The code can arrive two ways, because two phones cannot always message
   * each other: in the link, or typed in off the other phone's screen. Six
   * characters can also be read out across a counter, which a link cannot.
   */
  const [typed, setTyped] = useState(() => {
    // Adding to the Home Screen opens the app at its start page, not back here,
    // so without this the code has to be typed a second time — after a detour
    // taken precisely because the first attempt did not work.
    try {
      return localStorage.getItem('khapee.alertCode') ?? ''
    } catch {
      return ''
    }
  })
  const token = fromLink || typed
  const toast = useToast()
  const [invite, setInvite] = useState<{
    restaurant: string
    everywhere?: boolean
    available: boolean
    publicKey: string
  } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [trouble, setTrouble] = useState('')
  /** Where the WhatsApp test should go — this phone's own number, usually. */
  const [testPhone, setTestPhone] = useState('')
  /** What the last test did, kept on the page rather than in a passing toast. */
  const [tried, setTried] = useState('')

  /**
   * Makes this phone buzz, now, with no order involved.
   *
   * With a number it sends the thank-you notification instead of a plain one,
   * so the WhatsApp step can be checked from the same screen — it is the last
   * link in the chain and the only one whose failure looks like nothing at all.
   */
  const tryIt = async (phone: string) => {
    setBusy(true)
    setTried('')
    try {
      const r = await api<{ sent: number; devices: number; why: string }>(
        `/alerts/invite/${token.trim().toUpperCase()}/test`,
        { body: phone ? { phone } : {} },
      )
      if (r.sent) {
        setTried(
          phone
            ? 'Sent. Tap that notification — WhatsApp should open with the message written.'
            : 'Sent. This phone should be buzzing.',
        )
      } else if (!r.devices) {
        setTried('The server is not holding any phone for this code. Try turning it on again above.')
      } else {
        setTried(`Signed up, but the push service refused it${r.why ? `: ${r.why}` : '.'}`)
      }
    } catch (e) {
      setTried((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (fromLink) remember(fromLink.trim().toUpperCase())
  }, [fromLink])

  useEffect(() => {
    if (!fromLink) return
    api<{ restaurant: string; everywhere?: boolean; available: boolean; publicKey: string }>(
      `/alerts/invite/${fromLink}`,
    )
      .then(setInvite)
      .catch((e: ApiError) => setError(e.message))
  }, [fromLink])

  const remember = (code: string) => {
    try {
      localStorage.setItem('khapee.alertCode', code)
    } catch {
      /* a private window forgets it; the code can be typed again */
    }
  }

  const check = async () => {
    setBusy(true)
    setError('')
    try {
      remember(typed.trim().toUpperCase())
      setInvite(
        await api<{ restaurant: string; everywhere?: boolean; available: boolean; publicKey: string }>(
          `/alerts/invite/${typed.trim().toUpperCase()}`,
        ),
      )
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const accept = async () => {
    setBusy(true)
    try {
      if (!pushSupported()) throw new Error('This browser cannot show alerts when Khapee is closed.')
      const permission = await Notification.requestPermission()
      if (permission === 'denied') {
        throw new Error(
          'Notifications are blocked for Khapee. Turn them on in Settings → Notifications → Khapee, then try again.',
        )
      }
      if (permission !== 'granted') throw new Error('The permission prompt was dismissed. Tap again and allow it.')

      const reg = await workerReady()
      const existing = await reg.pushManager.getSubscription()
      if (existing) await existing.unsubscribe().catch(() => {})
      const raw = (invite?.publicKey ?? '') + '='.repeat((4 - ((invite?.publicKey ?? '').length % 4)) % 4)
      const bytes = Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes as BufferSource,
      })
      await api(`/alerts/invite/${token}`, { body: { subscription: sub.toJSON() } })
      try {
        // Kept, not discarded: the server forgets its device list every time it
        // restarts, and this is what lets the phone put itself back without
        // anybody being asked to do this again. See keepAlertsAlive.
        localStorage.setItem('khapee.alertCode', token.trim().toUpperCase())
        localStorage.setItem('khapee.alertGrant', token.trim().toUpperCase())
      } catch {
        /* nothing to tidy */
      }
      setDone(true)
      toast('This phone will ring for every new order.', 'good')
    } catch (e) {
      // Shown on the page as well as in a toast: a toast is gone in four
      // seconds and this is the message somebody needs to read twice, or
      // photograph and send to whoever can fix it.
      const said = (e as Error).message || 'Could not switch alerts on.'
      setTrouble(said)
      toast(said, 'bad')
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <ErrorState message={error} />
          <div className="center">
            <Link className="btn btn-secondary" to="/">
              Go to Khapee
            </Link>
          </div>
        </main>
      </div>
    )
  }

  // No code in the link: ask for one.
  if (!invite) {
    if (fromLink) {
      return (
        <div className="app">
          <Header />
          <main className="page page-narrow">
            <LoadingBlock />
          </main>
        </div>
      )
    }
    return (
      <div className="app">
        <Header />
        <main className="page page-narrow">
          <div className="card card-pad invite">
            <span className="invite-bell" aria-hidden>
              🔔
            </span>
            <h1>Turn on order alerts</h1>
            <p className="muted">
              Type the six-character code from the dashboard — Settings, then Notifications. This phone
              will then ring for every new order.
            </p>
            <input
              className="input code-in"
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="K7X92P"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              aria-label="Alert code"
            />
            <button
              className="btn btn-accent btn-lg btn-block"
              disabled={busy || typed.length < 6}
              onClick={check}
            >
              {busy ? <Spinner /> : 'Continue'}
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <Header />
      <main className="page page-narrow">
        <div className="card card-pad invite">
          <span className="invite-bell" aria-hidden>
            🔔
          </span>
          <h1>
            {invite.everywhere ? 'Order alerts for every restaurant' : `Order alerts for ${invite.restaurant}`}
          </h1>
          {done ? (
            <p className="muted">
              Done. This phone will ring for every new order, even with Khapee closed.
            </p>
          ) : (
            <p className="muted">
              Turn this on and this phone rings whenever an order comes in
              {invite.everywhere ? ' at any restaurant on Khapee' : ''}. It does not sign you in and it
              works on one phone only — this one.
            </p>
          )}

          {!done && pushSupported() && invite.available && (
            <button className="btn btn-accent btn-lg btn-block" disabled={busy} onClick={accept}>
              {busy ? <Spinner /> : 'Turn on alerts for this phone'}
            </button>
          )}

          {/* Shown as soon as a code is loaded, not only after switching on.
              It was hidden until the button above had been tapped in this
              visit, which is precisely backwards: somebody who set this phone
              up yesterday and came back to find out whether it still works saw
              no way to ask. Neither of them registers anything — they only
              make a noise — so there is nothing to gate them on. */}
          {invite.available && (
            <div className="wa-test">
              <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => tryIt('')}>
                {busy ? <Spinner /> : 'Ring this phone now'}
              </button>
              <p className="tiny muted" style={{ marginTop: 14 }}>
                And the WhatsApp step — put your own number in and this sends you the exact
                notification an accepted order sends. Tap it and WhatsApp should open with the message
                written. Nothing reaches anybody until you press send.
              </p>
              <div className="row" style={{ gap: 10, marginTop: 8 }}>
                <input
                  className="input input-sm"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="Your own mobile number"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-label="Your own mobile number"
                />
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busy || !testPhone.trim()}
                  onClick={() => tryIt(testPhone.trim())}
                >
                  Test WhatsApp
                </button>
              </div>
              {!!tried && <p className="tiny muted" style={{ marginTop: 10 }}>{tried}</p>}
            </div>
          )}

          {!done && !pushSupported() && needsHomeScreen() && (
            <>
              <p className="tiny muted">
                Safari only allows alerts once Khapee is on your Home Screen — this page, in a Safari
                tab, cannot do it however many times it is opened.
              </p>
              {/* The trap this page exists to get somebody out of: they add the
                  icon, carry on in the tab they already had open, and see the
                  same instructions again. */}
              <p className="tiny muted">
                <strong>Already added it?</strong> Then this is the wrong window — close Safari and
                open Khapee from the icon on your Home Screen instead. Otherwise:
              </p>
              <ol className="alert-steps">
                <li>
                  At the bottom of Safari, tap <strong>•••</strong> — or the <strong>Share</strong>{' '}
                  icon, the square with an arrow coming out of it, if your bar shows one.
                </li>
                <li>
                  Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
                </li>
                <li>
                  Open Khapee from the new icon. This page will be waiting with your code already
                  filled in — just tap the button.
                </li>
              </ol>
            </>
          )}

          {!done && !pushSupported() && !needsHomeScreen() && (
            <p className="tiny muted">
              This browser cannot show alerts with Khapee closed. Try Chrome on Android, or Safari on an
              iPhone with Khapee added to the Home Screen.
            </p>
          )}

          {!done && !invite.available && (
            <p className="tiny muted">Alerts are not switched on for this server yet.</p>
          )}

          {!!trouble && <p className="form-error" style={{ textAlign: 'left' }}>{trouble}</p>}

          {/* What the phone itself reports. Guessing at somebody else's phone
              from a description of it is slow and usually wrong; this is four
              lines they can photograph. */}
          {!done && (
            <details className="facts">
              <summary>Not working? What this phone says</summary>
              <dl>
                {Object.entries(pushFacts()).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      </main>
    </div>
  )
}
