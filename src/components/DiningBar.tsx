import { useState } from 'react'
import VerifyModal from './VerifyModal'
import { clearDining, readDining, type DiningSession } from '../lib/dining'

/**
 * Persistent "you're here" strip. Shows the open session, or offers to start
 * one — from whatever screen the customer happens to be on.
 */
export default function DiningBar({
  restaurantId,
  onChange,
}: {
  restaurantId: number
  onChange?: (session: DiningSession | null) => void
}) {
  const [session, setSession] = useState<DiningSession | null>(() => readDining(restaurantId))
  const [open, setOpen] = useState(false)

  const verified = session?.active !== false && !!session

  return (
    <>
      {verified ? (
        <div className="dining-bar is-on">
          <span aria-hidden>✓</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>
              You&rsquo;re at {session!.restaurantName}
              {session!.tableLabel ? ` · ${session!.tableLabel}` : ''}
            </strong>
            <span className="tiny">
              {session!.source === 'payment'
                ? 'Verified by your payment — order away.'
                : 'Session open — order without entering the code again.'}
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              clearDining()
              setSession(null)
              onChange?.(null)
            }}
          >
            End
          </button>
        </div>
      ) : (
        <button className="dining-bar" onClick={() => setOpen(true)}>
          <span aria-hidden>📍</span>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <strong>Already at the restaurant?</strong>
            <span className="tiny">Scan the table QR or enter the staff code to start ordering.</span>
          </div>
          <span className="dining-bar-go">Start →</span>
        </button>
      )}

      <VerifyModal
        open={open}
        onClose={() => setOpen(false)}
        restaurantId={restaurantId}
        onVerified={(s) => {
          setSession(s)
          onChange?.(s)
        }}
      />
    </>
  )
}
