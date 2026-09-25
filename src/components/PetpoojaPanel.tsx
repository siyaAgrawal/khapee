import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Spinner, useToast } from './ui'

/**
 * Connecting a restaurant to the till it already owns.
 *
 * Deliberately one field. A restaurant reads their Petpooja restaurant ID off
 * their own paperwork, pastes it here, and hands the five URLs this prints
 * back to Petpooja support. Everything after that — the menu arriving, orders
 * landing on their till, their Accept reaching the customer's phone, the KOT
 * and the bill printing on their own printer — follows from it and needs
 * nobody to do anything.
 *
 * The application credentials are not asked for here unless they are missing.
 * Petpooja issue one set to Khapee as the integration partner, not one per
 * restaurant, so they belong in the deployment's environment; the boxes exist
 * for the case where a restaurant has been given its own pair, which happens
 * occasionally and would otherwise mean a redeploy to onboard one kitchen.
 */
type State = {
  linked: boolean
  restId?: string
  enabled?: boolean
  pushOrders?: boolean
  credentialsPresent?: boolean
  ownCredentials?: boolean
  lastMenuAt?: string | null
  lastOrderAt?: string | null
  lastError?: string
  urls?: Record<string, string>
  itemsMapped?: number
  itemsTotal?: number
}

export default function PetpoojaPanel() {
  const toast = useToast()
  const [state, setState] = useState<State | null>(null)
  const [restId, setRestId] = useState('')
  const [keys, setKeys] = useState({ appKey: '', appSecret: '', accessToken: '' })
  const [showKeys, setShowKeys] = useState(false)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    api<State>('/staff/petpooja')
      .then((s) => {
        setState(s)
        setRestId(s.restId ?? '')
      })
      .catch(() => setState({ linked: false }))
  }, [])

  useEffect(load, [load])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('save')
    try {
      await api('/staff/petpooja', { body: { restId, ...keys } })
      setKeys({ appKey: '', appSecret: '', accessToken: '' })
      toast('Connected. Send Petpooja the five URLs below.', 'good')
      load()
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const sync = async () => {
    setBusy('sync')
    try {
      const r = await api<{ items: number; categories: number; retired: number }>('/staff/petpooja/sync', { body: {} })
      toast(`Menu pulled: ${r.items} dishes, ${r.categories} new sections.`, 'good')
      load()
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect Petpooja? Orders will stop going to their till.')) return
    setBusy('off')
    try {
      await api('/staff/petpooja', { method: 'DELETE' })
      toast('Disconnected.', 'info')
      load()
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  if (!state) return null

  return (
    <section className="card card-pad">
      <h2>Petpooja</h2>
      <p className="tiny muted">
        If this restaurant runs Petpooja, orders from Khapee land on their own till and their own
        printer prints the KOT and the bill — exactly as for somebody at the counter.
      </p>

      {!state.credentialsPresent && (
        <div className="notice mt-3">
          <span aria-hidden>⚠️</span>
          <div>
            <strong>Khapee has no Petpooja credentials yet</strong>
            <p className="tiny">
              Petpooja issue an app key, app secret and access token once, for Khapee as a whole.
              Until they are set, nothing here can reach their servers.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={save} className="mt-3">
        <div className="field">
          <label htmlFor="pp-rest">Petpooja restaurant ID</label>
          <input
            id="pp-rest"
            value={restId}
            onChange={(e) => setRestId(e.target.value)}
            placeholder="R156072"
            autoComplete="off"
          />
          <p className="tiny muted">On the restaurant&rsquo;s own Petpooja paperwork, next to their name.</p>
        </div>

        <button type="button" className="link-btn tiny" onClick={() => setShowKeys(!showKeys)}>
          {showKeys ? 'Hide' : 'This restaurant has its own Petpooja keys'}
        </button>

        {showKeys && (
          <div className="mt-2">
            {(
              [
                ['appKey', 'App key', 32],
                ['appSecret', 'App secret', 40],
                ['accessToken', 'Access token', 40],
              ] as const
            ).map(([field, label, len]) => (
              <div className="field" key={field}>
                <label htmlFor={`pp-${field}`}>{label}</label>
                <input
                  id={`pp-${field}`}
                  value={keys[field]}
                  onChange={(e) => setKeys({ ...keys, [field]: e.target.value })}
                  placeholder={`${len} characters`}
                  autoComplete="off"
                />
              </div>
            ))}
            <p className="tiny muted">
              Leave blank to use Khapee&rsquo;s own. Saved values are never shown again.
            </p>
          </div>
        )}

        <button className="btn btn-accent" disabled={busy === 'save' || !restId.trim()}>
          {busy === 'save' ? <Spinner /> : state.linked ? 'Save' : 'Connect'}
        </button>
      </form>

      {state.linked && (
        <>
          <div className="pp-stats mt-3">
            <span>
              <strong>{state.itemsMapped ?? 0}</strong> of {state.itemsTotal ?? 0} dishes matched to the till
            </span>
            <span>
              Menu last received{' '}
              <strong>{state.lastMenuAt ? new Date(state.lastMenuAt + 'Z').toLocaleString() : 'never'}</strong>
            </span>
            <span>
              Last order sent{' '}
              <strong>{state.lastOrderAt ? new Date(state.lastOrderAt + 'Z').toLocaleString() : 'never'}</strong>
            </span>
          </div>

          {!!state.lastError && (
            <p className="tiny" style={{ color: 'var(--bad)' }}>
              Last problem: {state.lastError}
            </p>
          )}

          {/*
            The setup step nobody can do for them. These go to Petpooja support
            once, and are what lets their till push a menu, mark a dish sold
            out, close the restaurant and tell us an order was accepted.

            The random string in each is the credential — their own
            documentation gives these endpoints no authentication at all — so
            they are treated like one and not printed anywhere else.
          */}
          <h3 className="mt-3">Send these to Petpooja</h3>
          <ul className="pp-urls">
            {(
              [
                ['menu', 'Push Menu'],
                ['itemStock', 'Item stock on/off'],
                ['storeStatus', 'Get store status'],
                ['updateStoreStatus', 'Update store status'],
                ['callback', 'Order callback'],
              ] as const
            ).map(([k, label]) => (
              <li key={k}>
                <span className="tiny muted">{label}</span>
                <code>{state.urls?.[k]}</code>
                <button
                  type="button"
                  className="link-btn tiny"
                  onClick={() => {
                    void navigator.clipboard?.writeText(state.urls?.[k] ?? '')
                    toast('Copied', 'good')
                  }}
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>

          <div className="row mt-3" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" disabled={busy === 'sync'} onClick={sync}>
              {busy === 'sync' ? <Spinner /> : 'Pull the menu now'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy === 'off'} onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </section>
  )
}
