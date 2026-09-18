import { useEffect, useState } from 'react'
import { api, ApiError } from './../lib/api'
import { currentEndpoint, disablePush, enablePush, needsHomeScreen, pushSupported, type AlertState } from '../lib/push'
import { Spinner, useToast } from './ui'

/**
 * Where a restaurant turns on being told.
 *
 * Two routes, because they fail differently. A phone alert arrives in seconds
 * with the dashboard shut, but a subscription dies quietly — a reset handset,
 * cleared site data — and nothing announces that it has. Email is slower and
 * cannot be silently revoked. Both on is the honest answer for a kitchen that
 * cannot afford to miss one.
 */
export default function AlertsCard() {
  const toast = useToast()
  const [state, setState] = useState<AlertState | null>(null)
  const [onThisDevice, setOnThisDevice] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const r = await api<AlertState>('/staff/alerts')
      setState(r)
      setOnThisDevice(!!(await currentEndpoint()))
    } catch {
      setState(null)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const turnOn = async () => {
    setBusy(true)
    const r = await enablePush(state?.push.publicKey ?? '')
    setBusy(false)
    if (!r.ok) return toast(r.error ?? 'Could not switch alerts on.', 'bad')
    toast('This device will ring for every new order.', 'good')
    void load()
  }

  const turnOff = async () => {
    setBusy(true)
    await disablePush()
    setBusy(false)
    toast('Alerts off on this device.', 'info')
    void load()
  }

  const ring = async () => {
    setBusy(true)
    try {
      const r = await api<{ sent: number }>('/staff/alerts/test', { body: {} })
      toast(
        r.sent ? `Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.` : 'No device is signed up yet.',
        r.sent ? 'good' : 'info',
      )
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card card-pad">
      <h2 style={{ marginBottom: 6 }}>Order alerts</h2>
      <p className="tiny muted mb-2">
        The board chimes while it is open. These reach you when it is not.
      </p>

      <div className="alert-row">
        <div>
          <strong>On this phone or computer</strong>
          <p className="tiny muted">
            {!pushSupported()
              ? needsHomeScreen()
                ? 'Add Khapee to your Home Screen first — on iPhone, Safari only alerts an installed app.'
                : 'This browser cannot do background alerts.'
              : !state?.push.available
                ? state?.push.reason || 'Not switched on for this server yet.'
                : onThisDevice
                  ? 'On. It rings with Khapee closed.'
                  : 'Off. Turn it on and it rings with Khapee closed.'}
          </p>
        </div>
        {state?.push.available && pushSupported() && (
          <button
            className={`btn btn-sm ${onThisDevice ? 'btn-secondary' : 'btn-accent'}`}
            disabled={busy}
            onClick={onThisDevice ? turnOff : turnOn}
          >
            {busy ? <Spinner /> : onThisDevice ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>

      <div className="alert-row">
        <div>
          <strong>By email</strong>
          <p className="tiny muted">
            {state?.email.available
              ? state.email.to
                ? `Every order goes to ${state.email.to}.`
                : 'No address on this account to send to.'
              : 'Not switched on for this server yet.'}
          </p>
        </div>
      </div>

      {!!state?.push.devices && (
        <p className="tiny muted" style={{ marginTop: 10 }}>
          {state.push.devices} device{state.push.devices === 1 ? '' : 's'} signed up.{' '}
          <button className="link-btn" onClick={ring} disabled={busy}>
            Ring them now
          </button>{' '}
          — silence is how an alert system fails, so it is worth hearing once.
        </p>
      )}
    </section>
  )
}
