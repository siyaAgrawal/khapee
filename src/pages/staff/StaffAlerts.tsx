import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { LoadingBlock, Spinner, useToast } from '../../components/ui'
import {
  currentEndpoint,
  disablePush,
  enablePush,
  needsHomeScreen,
  pushSupported,
  type AlertState,
} from '../../lib/push'

/**
 * Being told an order came in, set up here and nowhere else.
 *
 * The board chimes while somebody is looking at it, which is the one moment
 * nobody needs telling. These are the two routes that reach a kitchen with the
 * dashboard shut, and they fail differently: a phone alert arrives in seconds
 * but its subscription dies quietly when a handset is reset, while email is
 * slower and cannot be revoked without somebody noticing. Both on is the right
 * answer for a kitchen that cannot afford to miss one.
 *
 * Written as two steps you can finish in the app. Nothing here asks anybody to
 * go and configure something somewhere else — where a thing genuinely is not
 * switched on, it says who to ask rather than how to do it.
 */
export default function StaffAlerts() {
  const toast = useToast()
  const [state, setState] = useState<AlertState | null>(null)
  const [onThisDevice, setOnThisDevice] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState('')

  const load = async () => {
    try {
      const r = await api<AlertState>('/staff/alerts')
      setState(r)
      setEmail(r.email.own || '')
      setOnThisDevice(!!(await currentEndpoint()))
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (!state) return <LoadingBlock />

  const turnOn = async () => {
    setBusy('push')
    const r = await enablePush(state.push.publicKey)
    setBusy('')
    if (!r.ok) return toast(r.error ?? 'Could not switch alerts on.', 'bad')
    toast('This device will ring for every new order.', 'good')
    void load()
  }

  const turnOff = async () => {
    setBusy('push')
    await disablePush()
    setBusy('')
    toast('Alerts off on this device.', 'info')
    void load()
  }

  const ring = async () => {
    setBusy('ring')
    try {
      const r = await api<{ sent: number }>('/staff/alerts/test', { body: {} })
      toast(
        r.sent ? `Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.` : 'No device is signed up yet.',
        r.sent ? 'good' : 'info',
      )
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const saveEmail = async () => {
    setBusy('email')
    try {
      const r = await api<{ to: string; own: string }>('/staff/alerts/email', {
        method: 'PATCH',
        body: { email: email.trim() },
      })
      toast(r.own ? `Orders will go to ${r.to}.` : `Back to ${r.to}.`, 'good')
      void load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const testEmail = async () => {
    setBusy('mail')
    try {
      const r = await api<{ to: string }>('/staff/alerts/test-email', { body: {} })
      toast(`Sent to ${r.to}. Check the inbox — and the spam folder.`, 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const iphone = needsHomeScreen()
  const deviceLine = !pushSupported()
    ? iphone
      ? 'Safari needs Khapee on your Home Screen before it will allow this. It takes three taps and installs nothing — the steps are below.'
      : 'This browser cannot ring with Khapee closed. Chrome, Edge and Firefox all can, on a phone or a computer.'
    : !state.push.available
      ? state.push.reason
      : onThisDevice
        ? 'On. This phone rings for every new order — on the website, with Khapee closed, nothing installed.'
        : 'Off. Turn it on and this phone rings for every new order — on the website, with Khapee closed, nothing installed.'

  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const makeInvite = async () => {
    setBusy('invite')
    try {
      const r = await api<{ code: string; path: string }>('/staff/alerts/invite', { body: {} })
      void load()
      toast(`Code ${r.code} — type it at khapee.com/alerts on the other phone.`, 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Link copied — send it to that phone.', 'good')
    } catch {
      // Clipboard is blocked outside a secure context and on some phones; the
      // link is on screen either way, which is why it is shown and not hidden.
      toast('Copy the link shown below and send it to that phone.', 'info')
    }
  }

  const revoke = async (id: number) => {
    setBusy('revoke')
    try {
      await api(`/staff/alerts/invite/${id}/revoke`, { body: {} })
      toast('That link will not work now.', 'info')
      void load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const forget = async (id: number, who: string) => {
    if (!window.confirm(`Stop sending alerts to ${who}'s device?`)) return
    setBusy('forget')
    try {
      await api(`/staff/alerts/devices/${id}/remove`, { body: {} })
      toast('That device will not be alerted again.', 'info')
      void load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <section className="card card-pad">
        <div className="alert-step">
          <span className="alert-num" aria-hidden>
            1
          </span>
          <div>
            <h2>Ring this phone</h2>
            <p className="tiny muted">{deviceLine}</p>
          </div>
          {state.push.available && pushSupported() && (
            <button
              className={`btn btn-sm ${onThisDevice ? 'btn-secondary' : 'btn-accent'}`}
              disabled={busy === 'push'}
              onClick={onThisDevice ? turnOff : turnOn}
            >
              {busy === 'push' ? <Spinner /> : onThisDevice ? 'Turn off' : 'Turn on'}
            </button>
          )}
        </div>

        {/* Apple is the only platform that will not do this from the website
            alone. Saying so is not enough — the three taps are not where
            anybody looks for them, so they are written out here. */}
        {iphone && (
          <ol className="alert-steps">
            <li>
              Open <strong>khapee.com</strong> in Safari (not Chrome — on iPhone only Safari can do
              this).
            </li>
            <li>
              Tap the <strong>Share</strong> button, the square with an arrow coming out of it.
            </li>
            <li>
              Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </li>
            <li>
              Open Khapee from the new icon, come back to this page, and the button above will work.
            </li>
          </ol>
        )}

        {/* Always offered, never hidden.
            It used to appear only once a device was signed up, which is exactly
            backwards: the moment somebody needs to press it is the moment
            nothing is ringing, and hiding it then leaves them with a page that
            says nothing and no way to ask. Pressed with nothing signed up it
            says so, which is the answer they came for. */}
        <p className="tiny muted alert-foot">
          Turn it on once on every phone that should ring — the one behind the counter, and yours.{' '}
          {state.push.devices
            ? `${state.push.devices} signed up so far.`
            : 'None signed up yet.'}{' '}
          <button className="link-btn" onClick={ring} disabled={busy === 'ring'}>
            {busy === 'ring' ? 'Ringing…' : 'Ring them now'}
          </button>
        </p>

        {/* The account is the key here, not the device: anybody who can sign in
            can put these on a phone of their own. So the list is shown, and any
            of it can be taken off. */}
        {!!state.push.list?.length && (
          <ul className="device-list">
            {state.push.list.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.who}</strong>
                  {d.whose && <span className="tiny muted"> · {d.whose}</span>}
                  <p className="tiny muted">
                    On since {new Date(d.since + 'Z').toLocaleDateString()}
                    {d.failing ? ' · not answering — probably gone' : ''}
                  </p>
                </div>
                <button className="link-btn" onClick={() => forget(d.id, d.who)} disabled={busy === 'forget'}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* A link instead of the password. Handing somebody the password to
            make their phone buzz gives them the whole dashboard — every order
            and every customer's number — and cannot be taken back without
            changing it for everyone. */}
        <div className="invite-row">
          <button className="btn btn-accent btn-sm" disabled={busy === 'invite'} onClick={makeInvite}>
            {busy === 'invite' ? <Spinner /> : 'Add another phone'}
          </button>
          <span className="tiny muted">
            Gives a six-character code. Open <strong>khapee.com/alerts</strong> on the other phone, type
            it in, and that phone gets alerts — no sign-in, no password.
          </span>
        </div>

        {!!state.invites?.length && (
          <ul className="device-list">
            {state.invites.map((i) => (
              <li key={i.id}>
                <div>
                  <strong className="invite-code mono">{i.code}</strong>
                  <p className="tiny muted">
                    Type it at khapee.com/alerts · unused · expires{' '}
                    {new Date(i.until + 'Z').toLocaleString()}
                  </p>
                </div>
                <span className="row" style={{ gap: 10 }}>
                  <button className="link-btn" onClick={() => copy(origin + i.path)}>
                    Copy link
                  </button>
                  <button className="link-btn" onClick={() => revoke(i.id)} disabled={busy === 'revoke'}>
                    Cancel
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {state.ringsFor.length > 1 && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            A phone you switch on rings for every order at {state.ringsFor.slice(0, -1).join(', ')} and{' '}
            {state.ringsFor[state.ringsFor.length - 1]} — you do not have to do this once per place.
          </p>
        )}
      </section>

      <section className="card card-pad mt-3">
        <div className="alert-step">
          <span className="alert-num" aria-hidden>
            2
          </span>
          <div>
            <h2>And send it by email</h2>
            <p className="tiny muted">
              A phone alert can stop arriving without saying so — a reset handset, cleared browser
              data — and nothing announces it. Email is slower and does not do that, so it is worth
              having both.
            </p>
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="al-email">Send order alerts to</label>
          <input
            id="al-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={state.email.to || 'kitchen@yourplace.com'}
            autoCapitalize="none"
            autoComplete="email"
          />
          <span className="hint">
            {email.trim()
              ? 'A shared inbox works well — anyone on shift can see it.'
              : `Leave it blank and they go to ${state.email.to || 'the account that signed up'}.`}
          </span>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy === 'email' || email.trim() === (state.email.own ?? '')}
            onClick={saveEmail}
          >
            {busy === 'email' ? <Spinner /> : 'Save'}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy === 'mail'} onClick={testEmail}>
            {busy === 'mail' ? <Spinner /> : 'Send me a test'}
          </button>
        </div>

        {!state.email.available && (
          <div className="notice" style={{ marginTop: 14 }}>
            <span aria-hidden>✉️</span>
            <div>
              <strong>Khapee cannot send email yet</strong>
              <p className="tiny">
                Nothing for you to do here — the address above is saved and will be used the moment
                it is switched on. Ask whoever set Khapee up for you.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="card card-pad mt-3">
        <h2 style={{ marginBottom: 6 }}>While the board is open</h2>
        <p className="tiny muted">
          A new order also chimes and slides onto the board on its own — no refreshing. These two are
          for when nobody is looking at it.
        </p>
      </section>
    </>
  )
}
