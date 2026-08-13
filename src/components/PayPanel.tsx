import { useState } from 'react'
import { QRCanvas } from '../lib/qr'
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

      <a className="btn btn-accent btn-block" href={upiLink}>
        Open UPI app
      </a>
      <p className="tiny muted center" style={{ margin: '10px 0 14px' }}>
        Scan with any UPI app, or tap the button on your phone. The money goes straight to the
        restaurant.
      </p>

      <div className="field">
        <label htmlFor="upi-ref">UPI reference number (optional)</label>
        <input
          id="upi-ref"
          className="input"
          inputMode="numeric"
          placeholder="12-digit UTR from your UPI app"
          value={ref}
          onChange={(e) => setRef(e.target.value.replace(/\D/g, '').slice(0, 20))}
        />
        <span className="hint">Helps the restaurant match your payment faster.</span>
      </div>

      <button className="btn btn-accent btn-lg btn-block" disabled={busy} onClick={() => onPaid(ref)}>
        {busy ? <Spinner /> : "I've paid"}
      </button>
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
