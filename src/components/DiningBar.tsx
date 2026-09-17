import { useEffect, useState } from 'react'
import VerifyModal from './VerifyModal'
import { api } from '../lib/api'
import { clearDining, readDining, saveDining, type DiningSession } from '../lib/dining'
import { clearTableContext, readTableContext } from '../lib/table-context'

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

  /**
   * A table session lasts a few hours; a long lunch can outlast it. Rather than
   * asking someone sitting at the table to scan the QR taped to it a second
   * time, the token that QR gave us opens a fresh session quietly. Scanning
   * again would prove nothing this device cannot already prove.
   */
  useEffect(() => {
    if (verified) return
    const scanned = readTableContext(restaurantId)
    if (!scanned?.tableToken) return
    let cancelled = false
    api<{ session: DiningSession }>('/sessions', {
      body: { value: `KHAPEE:TABLE:${scanned.tableToken}`, restaurantId },
    })
      .then((r) => {
        if (cancelled) return
        saveDining(r.session)
        setSession(r.session)
        onChange?.(r.session)
      })
      // The table has been removed, or it is not this restaurant's any more.
      // Forget it and fall back to asking, rather than retrying every render.
      .catch(() => !cancelled && clearTableContext())
    return () => {
      cancelled = true
    }
  }, [verified, restaurantId]) // eslint-disable-line react-hooks/exhaustive-deps

  // "You're at Revery" is true of someone sitting in it and false of someone
  // waiting at home or in the car park, who is the whole point of these two
  // modes. Each says where the order is going instead.
  const mode = session?.serviceMode
  const heading =
    mode === 'precinct'
      ? `They're bringing it to ${session!.whereLabel || session!.spotLabel || 'you'}`
      : mode === 'delivery'
      ? `Delivering to ${session!.address || session!.areaName || 'your address'}`
      : mode === 'car'
        ? `In the car${session!.seqNo ? ` · Car ${session!.seqNo}` : ''}`
        : `You're at ${session?.restaurantName}${session?.tableLabel ? ` · ${session.tableLabel}` : ''}`
  const sub =
    mode === 'precinct'
      ? `${session!.restaurantName} accepts the order, then walks it over.`
      : mode === 'delivery'
      ? `${session!.restaurantName} accepts the order before it is made.`
      : mode === 'car'
        ? 'They bring it out to you — no need to come in.'
        : session?.source === 'payment'
          ? 'Verified by your payment — order away.'
          : 'Session open — order without entering the code again.'

  return (
    <>
      {verified ? (
        <div className="dining-bar is-on">
          <span aria-hidden>{mode === 'precinct' ? '🚶' : mode === 'delivery' ? '🛵' : mode === 'car' ? '🚗' : '✓'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{heading}</strong>
            <span className="tiny">{sub}</span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              clearDining()
              // Also the table it came from, or the effect above would open the
              // session straight back up and End would do nothing.
              clearTableContext()
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
