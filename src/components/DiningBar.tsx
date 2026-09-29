import { useEffect, useState } from 'react'
import VerifyModal from './VerifyModal'
import { api } from '../lib/api'
import { clearDining, readDining, saveDining, type DiningSession } from '../lib/dining'
import { clearTableContext, readTableContext } from '../lib/table-context'
import { PinIcon } from './icons'
import { Modal } from './ui'

/**
 * Persistent "you're here" strip. Shows the open session, or offers to start
 * one — from whatever screen the customer happens to be on.
 */
export default function DiningBar({
  restaurantId,
  codesEnabled = true,
  onChange,
}: {
  restaurantId: number
  /** Whether this restaurant hands out typed codes beside the QR. */
  codesEnabled?: boolean
  onChange?: (session: DiningSession | null) => void
}) {
  const [session, setSession] = useState<DiningSession | null>(() => readDining(restaurantId))
  const [open, setOpen] = useState(false)
  /* Moving tables after the scan: a small "Change" beside the table name,
     and the list only when asked for. */
  const [moving, setMoving] = useState(false)
  const [tables, setTables] = useState<{ id: number; label: string; seats: number }[] | null>(null)
  const openMove = () => {
    setMoving(true)
    if (!tables && session?.token) {
      api<{ tables: { id: number; label: string; seats: number }[] }>(`/sessions/${session.token}/tables`)
        .then((r) => setTables(r.tables))
        .catch(() => setTables([]))
    }
  }
  const moveTo = (t: { id: number; label: string }) => {
    if (!session?.token) return
    api<{ session: DiningSession }>(`/sessions/${session.token}/table`, { body: { tableId: t.id } })
      .then((r) => {
        const next = { ...session, ...r.session, tableId: t.id, tableLabel: t.label }
        saveDining(next)
        setSession(next)
        onChange?.(next)
        setMoving(false)
      })
      .catch(() => setMoving(false))
  }

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
        : // Just the table. "You're at Revery" is on the page already, and the
          // session explanation under it was four lines between the customer
          // and the menu.
          session?.tableLabel || `At ${session?.restaurantName}`
  const sub =
    mode === 'precinct'
      ? `${session!.restaurantName} accepts the order, then walks it over.`
      : mode === 'delivery'
      ? `${session!.restaurantName} accepts the order before it is made.`
      : mode === 'car'
        ? 'They bring it out to you — no need to come in.'
        : 'Order from here — it comes to your table.'

  return (
    <>
      {verified ? (
        <div className="dining-bar is-on">
          <span aria-hidden>{mode === 'precinct' ? '🚶' : mode === 'delivery' ? '🛵' : mode === 'car' ? '🚗' : '✓'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>
              {heading}
              {(!mode || mode === 'dine_in') && session?.tableId && (
                <button type="button" className="table-change" onClick={openMove}>
                  Change
                </button>
              )}
            </strong>
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
          <span className="dining-bar-mark" aria-hidden>
            <PinIcon size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <strong>Already at the restaurant?</strong>
            <span className="tiny">
              {codesEnabled
                ? 'Scan the table QR or enter the staff code to start ordering.'
                : 'Scan the QR on your table to start ordering.'}
            </span>
          </div>
          <span className="dining-bar-go">Start →</span>
        </button>
      )}

      <VerifyModal
        open={open}
        onClose={() => setOpen(false)}
        restaurantId={restaurantId}
        codesEnabled={codesEnabled}
        onVerified={(s) => {
          setSession(s)
          onChange?.(s)
        }}
      />
      <Modal open={moving} onClose={() => setMoving(false)} title="Which table are you at?">
        {!tables ? (
          <p className="tiny muted">Loading…</p>
        ) : (
          <div className="table-grid">
            {tables.map((t) => (
              <button
                key={t.id}
                className={`table-btn ${session?.tableId === t.id ? 'selected' : ''}`}
                onClick={() => moveTo(t)}
              >
                <strong>{t.label}</strong>
                <span>{t.seats} seats</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </>
  )
}
