import { useState } from 'react'
import { QRCanvas } from '../lib/qr'
import { appLink, IOS_UPI_APPS, isIOS, isMobile } from '../lib/upi-apps'
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

      {/* On the same phone the QR is on, there is nothing to point a camera at,
          so the app has to be opened directly. Android does that from one
          intent and draws its own picker; iOS registers no handler for upi://
          at all, which is a button that does nothing and says nothing, so
          there the apps are named one by one. */}
      {isMobile() &&
        (isIOS() ? (
          <>
            <p className="tiny muted center" style={{ margin: '0 0 8px' }}>
              Paying on this phone? Open your app:
            </p>
            <div className="upi-apps">
              {IOS_UPI_APPS.map((app) => (
                <a key={app.id} className="upi-app" href={appLink(app, upiLink)}>
                  {app.name}
                </a>
              ))}
            </div>
            <p className="tiny muted center" style={{ margin: '10px 0 14px' }}>
              Not there? Screenshot the QR above and scan it from inside your app.
            </p>
          </>
        ) : (
          <>
            <a className="btn btn-accent btn-block" href={upiLink}>
              Open a UPI app on this phone
            </a>
            <p className="tiny muted center" style={{ margin: '10px 0 14px' }}>
              Your phone will offer every UPI app you have installed.
            </p>
          </>
        ))}

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
