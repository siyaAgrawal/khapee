import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { LoadingBlock, Spinner, useToast } from '../../components/ui'

/**
 * Pointing Khapee at whatever the restaurant already bills on.
 *
 * Deliberately three ways rather than a list of supported products. There is
 * no standard here — a kitchen might run Petpooja, a Windows program from
 * 2011, or a notebook — and an integration per product is a list that is never
 * finished and is wrong the week somebody switches. Push, pull, or a file
 * between them reach all of it.
 *
 * Written for two readers at once: the owner, who wants to know whether orders
 * are arriving, and whoever is wiring the till up, who wants the address and
 * the rules. The second one is usually not in the room, which is why the
 * details are a link they can be sent rather than something to be relayed.
 */
type Delivery = {
  id: number
  orderNumber: string
  event: string
  ok: boolean
  code: number | null
  error: string
  attempts: number
  at: string
}

type BillingState = {
  url: string
  active: boolean
  hasSecret: boolean
  hasKey: boolean
  deliveries: Delivery[]
}

export default function StaffBilling() {
  const toast = useToast()
  const [state, setState] = useState<BillingState | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState('')
  /**
   * Shown once and then gone, because that is the whole of their security.
   * Kept in component state rather than re-fetched: an endpoint that can hand
   * these back turns any stolen session into a permanent, silent copy of the
   * order feed, and unlike a password nobody would notice it had been taken.
   */
  const [secret, setSecret] = useState('')
  const [key, setKey] = useState('')

  const load = async () => {
    try {
      const r = await api<BillingState>('/staff/billing')
      setState(r)
      setUrl(r.url)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (!state) return <LoadingBlock />

  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const save = async () => {
    setBusy('url')
    try {
      await api('/staff/billing', { method: 'PATCH', body: { url: url.trim(), active: true } })
      toast(url.trim() ? 'Saved. Orders will be sent there as they come in.' : 'Sending switched off.', 'good')
      void load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const makeSecret = async () => {
    setBusy('secret')
    try {
      const r = await api<{ secret: string }>('/staff/billing/secret', { body: {} })
      setSecret(r.secret)
      void load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const makeKey = async () => {
    setBusy('key')
    try {
      const r = await api<{ key: string }>('/staff/billing/key', { body: {} })
      setKey(r.key)
      void load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const test = async () => {
    setBusy('test')
    try {
      const r = await api<{ ok: boolean; code?: number; error?: string }>('/staff/billing/test', { body: {} })
      toast(
        r.ok
          ? `Your billing system accepted it (${r.code}).`
          : `It did not go through — ${r.error ?? 'no answer'}`,
        r.ok ? 'good' : 'bad',
      )
      void load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(`${what} copied.`, 'good')
    } catch {
      toast('Copy it from the box — this browser will not do it for you.', 'info')
    }
  }

  return (
    <>
      {/*
        Said before anything else, because the screen said the opposite.

        A page called "Billing system" that asks for "your billing system's
        address" reads as Khapee needing one — and somebody running a cafe
        with no POS concluded, reasonably, that Khapee could not bill on its
        own. It can: the Till raises numbered bills, takes payment and prints.
        Everything below is for a restaurant that already runs something else
        and wants a copy of each order sent there too.
      */}
      <section className="card card-pad">
        <h2 style={{ marginBottom: 6 }}>Khapee already bills on its own</h2>
        <p className="tiny muted">
          The <strong>Till</strong> raises a numbered bill for every order, takes the payment, prints
          it and sends it to the customer. You do not need anything on this page for that.
        </p>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          This page is only for a restaurant that <em>also</em> runs another billing system — Petpooja,
          POSist, or similar — and wants each Khapee order to land in it as well, so the kitchen and
          the till never disagree. If you do not run one, there is nothing to do here.
        </p>
      </section>

      <section className="card card-pad mt-3">
        <div className="alert-step">
          <span className="alert-num" aria-hidden>
            1
          </span>
          <div>
            <h2>Send each order to your other system</h2>
            <p className="tiny muted">
              If you run a POS of your own, Khapee posts every order to it — when it is placed, when
              it moves along, and when it is paid. Ask whoever set that system up for its webhook or
              “incoming order” address.
            </p>
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="bill-url">Your other system’s address (optional)</label>
          <input
            id="bill-url"
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-billing-system.com/orders"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
          <span className="hint">
            {state.url
              ? 'Orders are being sent here. Clear the box and save to stop.'
              : 'Leave it empty if your system cannot receive orders — use the key below instead.'}
          </span>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-secondary btn-sm" disabled={busy === 'url' || url.trim() === state.url} onClick={save}>
            {busy === 'url' ? <Spinner /> : 'Save'}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy === 'test' || !state.url} onClick={test}>
            {busy === 'test' ? <Spinner /> : 'Send a test order'}
          </button>
        </div>

        {/* Without this, a webhook is an open letterbox: anybody who learns the
            address can post orders into the till that were never placed. */}
        <div className="wa-test">
          <label>Signing secret</label>
          <p className="tiny muted">
            Khapee signs everything it sends with this, so your billing system can tell a real order
            from anybody who has guessed the address. Give it to whoever sets up the receiving end.
          </p>
          {secret ? (
            <div className="secret-out">
              <code className="mono">{secret}</code>
              <button className="link-btn" onClick={() => copy(secret, 'Secret')}>
                Copy
              </button>
              <p className="tiny muted">
                This is the only time it is shown. If it is lost, make a new one — the old one stops
                working the moment you do.
              </p>
            </div>
          ) : (
            <button className="btn btn-secondary btn-sm" disabled={busy === 'secret'} onClick={makeSecret}>
              {busy === 'secret' ? <Spinner /> : state.hasSecret ? 'Replace the secret' : 'Make a secret'}
            </button>
          )}
        </div>
      </section>

      <section className="card card-pad mt-3">
        <div className="alert-step">
          <span className="alert-num" aria-hidden>
            2
          </span>
          <div>
            <h2>Or let it come and fetch them</h2>
            <p className="tiny muted">
              A till sitting on the counter usually cannot be reached from the internet, so it asks
              Khapee instead. Same orders, same detail — it just does the asking. This also gives you
              a spreadsheet of every order.
            </p>
          </div>
        </div>

        {key ? (
          <div className="secret-out" style={{ marginTop: 12 }}>
            <code className="mono">{key}</code>
            <button className="link-btn" onClick={() => copy(key, 'Key')}>
              Copy
            </button>
            <p className="tiny muted">
              Shown once. Treat it like a password — anyone holding it can read this restaurant’s
              orders.
            </p>
          </div>
        ) : (
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 12 }}
            disabled={busy === 'key'}
            onClick={makeKey}
          >
            {busy === 'key' ? <Spinner /> : state.hasKey ? 'Replace the key' : 'Make a key'}
          </button>
        )}

        <p className="tiny muted" style={{ marginTop: 14 }}>
          Send that key as an <code>x-khapee-key</code> header to:
        </p>
        <ul className="alert-steps">
          <li>
            <code className="mono">{origin}/api/billing/orders</code> — the orders, in order
          </li>
          <li>
            <code className="mono">{origin}/api/billing/orders.csv</code> — the same as a spreadsheet
          </li>
        </ul>
      </section>

      <section className="card card-pad mt-3">
        <h2 style={{ marginBottom: 6 }}>What has been sent</h2>
        <p className="tiny muted">
          A billing system that has quietly stopped accepting orders looks exactly like one that is
          working: the kitchen believes the till has the order and the till never heard of it. This
          is where that shows.
        </p>
        {!state.deliveries.length ? (
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Nothing sent yet.
          </p>
        ) : (
          <ul className="device-list">
            {state.deliveries.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.orderNumber ? `#${d.orderNumber}` : d.event}</strong>{' '}
                  <span className={`badge ${d.ok ? 'badge-open' : 'badge-warn'}`}>
                    {d.ok ? `Sent${d.code ? ` · ${d.code}` : ''}` : 'Failed'}
                  </span>
                  <p className="tiny muted">
                    {d.event} · {new Date(d.at + 'Z').toLocaleString()}
                    {d.attempts > 1 ? ` · ${d.attempts} tries` : ''}
                    {d.error ? ` · ${d.error}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad mt-3">
        <h2 style={{ marginBottom: 6 }}>For whoever wires it up</h2>
        <p className="tiny muted">
          The payload, the signature, the retry rules and both addresses, on one page you can send
          them — they are usually not the person reading this screen.
        </p>
        <p style={{ marginTop: 10 }}>
          <a className="btn btn-ghost btn-sm" href="/api/billing/help" target="_blank" rel="noreferrer">
            Open the integration notes
          </a>
        </p>
      </section>
    </>
  )
}
