import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { money } from './ui'

export type PayChoice = 'now' | 'later'

/**
 * How you are paying, as a sheet you pull up rather than a line you read.
 *
 * It used to be an inline row that only opened when the restaurant had a UPI
 * ID — so at a place without one, the customer saw the words "Pay when you
 * collect", tapped them, and nothing happened. Nothing was broken; there was
 * simply no second option to offer. But a dead tap on the payment line reads
 * as an app that will not take your money.
 *
 * So the sheet always opens, and the option that cannot be used is in it,
 * greyed, with the reason written on it. Being told why is the difference
 * between a restaurant that takes cash and an app that is broken.
 */
export default function PaySheet({
  open,
  onClose,
  value,
  onPick,
  amountCents,
  restaurantName,
  laterLabel,
  laterSub,
  canPayNow,
  nowSub,
  unavailableReason,
  footNote,
}: {
  open: boolean
  onClose: () => void
  value: PayChoice
  onPick: (choice: PayChoice) => void
  amountCents: number
  restaurantName: string
  /** "Pay at the counter", "Pay on delivery" — named for where they'll be. */
  laterLabel: string
  laterSub: string
  canPayNow: boolean
  nowSub: string
  /** Why paying in the app is off here, in words a customer can act on. */
  unavailableReason: string
  /** What paying, or not paying, means for the order. */
  footNote: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const pick = (choice: PayChoice) => {
    onPick(choice)
    onClose()
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Payment options"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-grip" aria-hidden />
        <header className="sheet-head">
          <div>
            <h2>Payment options</h2>
            <p className="tiny muted">{money(amountCents)} to pay</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="sheet-body">
          <p className="sheet-group">Pay now</p>
          <button
            type="button"
            className={`pay-opt ${value === 'now' ? 'on' : ''} ${canPayNow ? '' : 'off'}`}
            onClick={() => canPayNow && pick('now')}
            disabled={!canPayNow}
            aria-pressed={value === 'now'}
          >
            <span className="pay-opt-icon" aria-hidden>
              ⚡
            </span>
            <strong>Any UPI app</strong>
            <span className="pay-opt-sub">{canPayNow ? nowSub : unavailableReason}</span>
            <span className="pay-opt-dot" aria-hidden />
          </button>

          <p className="sheet-group">Pay later</p>
          <button
            type="button"
            className={`pay-opt ${value === 'later' ? 'on' : ''}`}
            onClick={() => pick('later')}
            aria-pressed={value === 'later'}
          >
            <span className="pay-opt-icon" aria-hidden>
              💵
            </span>
            <strong>{laterLabel}</strong>
            <span className="pay-opt-sub">{laterSub}</span>
            <span className="pay-opt-dot" aria-hidden />
          </button>

          <p className="sheet-foot tiny muted">{footNote}</p>
          {!canPayNow && (
            <p className="sheet-foot tiny muted">
              {restaurantName} can switch on UPI themselves — Dashboard → Settings → UPI.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
