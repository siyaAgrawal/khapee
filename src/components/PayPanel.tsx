import { useState } from 'react'
import { QRCanvas } from '../lib/qr'
import { appsFor, isInAppBrowser, isIOS, isMobile, linkFor } from '../lib/upi-apps'
import { money, Spinner } from './ui'

/**
 * Shows a UPI request and takes the customer's word that they've sent it.
 *
 * The transfer happens inside their own UPI app, straight to the restaurant's
 * VPA — this app never handles the money and cannot see the bank, so the
 * restaurant confirms the payment on their side before it counts as paid.
 */
export default function PayPanel({
  amountCents,
  upiLink,
  payeeName,
  vpa,
  busy,
  onPaid,
  onCancel,
  label = 'Pay with UPI',
}: {
  amountCents: number
  upiLink: string
  payeeName: string
  vpa: string
  busy?: boolean
  onPaid: (upiRef: string) => void
  onCancel?: () => void
  label?: string
}) {
  const [ref, setRef] = useState('')
  const [showRef, setShowRef] = useState(false)
  const [copied, setCopied] = useState('')

  /*
   * Copying the UPI ID is the one route that works on every phone.
   *
   * Every other way in depends on something: a scheme iOS has to register, an
   * intent Chrome has to honour, a camera pointed at a screen the customer is
   * holding. Opening your own UPI app and pasting an ID depends on nothing,
   * and it is what somebody does anyway the moment a button fails them.
   */
  const copy = (what: 'vpa' | 'amount', value: string) => {
    try {
      void navigator.clipboard?.writeText(value)
      setCopied(what)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      /* no clipboard: the value is on screen to be read and typed */
    }
  }

  return (
    <div className="pay-panel">
      <div className="pay-head">
        <span className="tiny muted">{label}</span>
        <strong className="pay-amount">{money(amountCents)}</strong>
        <span className="tiny muted">
          to {payeeName} · <span className="mono">{vpa}</span>
        </span>
      </div>

      <div className="pay-qr">
        <QRCanvas value={upiLink} size={190} />
      </div>
      <p className="tiny muted center" style={{ margin: '4px 0 14px' }}>
        Scan this with <strong>any</strong> UPI app — Google Pay, PhonePe, Paytm, FamApp, CRED,
        BHIM, your bank&rsquo;s own. The money goes straight to the restaurant.
      </p>

      {/*
        In a webview, every button below is a button that does nothing.

        Most people arrive from a link somebody sent them, and tapping that
        link opens WhatsApp's or Instagram's own browser rather than Chrome or
        Safari. Those block custom schemes and intents silently — no error, no
        movement, nothing. Said plainly here, with the two routes that still
        work, because a customer who thinks UPI is broken pays cash instead.
      */}
      {isInAppBrowser() && (
        <p className="pay-note" role="status">
          You opened this from inside another app, which blocks UPI buttons. Copy the UPI ID
          below and pay from your UPI app — or open khapee.com in Chrome or Safari.
        </p>
      )}

      {/* On the same phone the QR is on there is nothing to point a camera at,
          so the app has to be opened directly — and named, on both platforms.
          Android would take a plain upi:// and draw its own chooser, which
          makes paying two taps: ours, then theirs. An intent that names the
          package skips the chooser and lands inside the app with the amount
          already filled in. iOS has no choice in the matter: it registers no
          handler for upi:// at all. */}
      {isMobile() && !isInAppBrowser() && (
        <>
          <p className="tiny muted center" style={{ margin: '0 0 8px' }}>
            Paying on this phone? One tap:
          </p>
          <div className="upi-apps">
            {appsFor(isIOS()).map((app) => (
              <a key={app.id} className="upi-app" href={linkFor(app, upiLink, isIOS())}>
                {app.name}
              </a>
            ))}
          </div>
          {/* The generic intent, kept as a full button rather than a footnote.
              Naming the package is faster when it works, and silent when the
              app has moved or the browser will not honour an intent — so the
              route that has always worked stays in plain sight beside it. */}
          {isIOS() ? (
            <p className="tiny muted center" style={{ margin: '10px 0 0' }}>
              Not there? Screenshot the QR above and scan it from inside your app.
            </p>
          ) : (
            <a className="btn btn-secondary btn-block" style={{ marginTop: 10 }} href={upiLink}>
              Open any other UPI app
            </a>
          )}
        </>
      )}

      {/*
        The one way in that cannot fail.

        Every other route depends on something — a scheme iOS has to register,
        an intent Chrome has to honour, a camera pointed at the screen you are
        holding. Opening your own UPI app and pasting an ID depends on nothing,
        and it is what somebody does anyway the moment a button fails them.
      */}
      <div className="pay-manual">
        <span className="tiny muted">Or pay by hand, from any UPI app:</span>
        <div className="pay-copy-row">
          <button type="button" className="pay-copy" onClick={() => copy('vpa', vpa)}>
            <span className="mono">{vpa}</span>
            <span className="tiny">{copied === 'vpa' ? 'Copied' : 'Copy'}</span>
          </button>
          <button type="button" className="pay-copy" onClick={() => copy('amount', (amountCents / 100).toFixed(2))}>
            <span className="mono">{money(amountCents)}</span>
            <span className="tiny">{copied === 'amount' ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/*
        Optional again.

        Copying a 12-digit number out of a UPI app was the slowest part of
        paying. The restaurant does not need it to find the payment: it lands
        in their own UPI app with the customer's name on it, and they tick it
        off under "To confirm" before the food goes out. Somebody who has the
        number to hand can still add it.
      */}
      {showRef ? (
        <div className="field">
          <label htmlFor="upi-ref">UPI reference (optional)</label>
          <input
            id="upi-ref"
            className="input"
            inputMode="numeric"
            placeholder="12-digit UTR from your UPI app"
            value={ref}
            onChange={(e) => setRef(e.target.value.replace(/\D/g, '').slice(0, 20))}
            autoFocus
          />
        </div>
      ) : null}

      <button
        className="btn btn-accent btn-lg btn-block"
        disabled={busy || (ref.length > 0 && ref.length < 12)}
        onClick={() => onPaid(ref)}
      >
        {busy ? <Spinner /> : ref.length > 0 && ref.length < 12 ? 'Finish the 12-digit reference' : "I've paid"}
      </button>
      {!showRef && (
        <button type="button" className="btn btn-ghost btn-sm btn-block pay-ref-link" onClick={() => setShowRef(true)}>
          Have the UPI reference? Add it (optional)
        </button>
      )}
      {onCancel && (
        <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={onCancel} disabled={busy}>
          Back
        </button>
      )}
      <p className="tiny muted center" style={{ marginTop: 10 }}>
        The restaurant confirms your payment against their own UPI app.
      </p>
    </div>
  )
}
