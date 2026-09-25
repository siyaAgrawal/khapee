import { useCallback, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { saveDining, type DiningSession } from '../lib/dining'
import { QRScanner } from '../lib/qr'
import { Modal, Spinner, useToast } from './ui'

/**
 * Opens a dining session from a scanned QR or a typed code. Reachable from any
 * screen, so a customer can start their session whenever staff hand them the
 * code — while browsing, at the cart, or at checkout.
 */
export default function VerifyModal({
  open,
  onClose,
  restaurantId,
  codesEnabled,
  onVerified,
}: {
  open: boolean
  onClose: () => void
  /** Restricts the code to one restaurant. Omit to accept any. */
  restaurantId?: number
  /**
   * Whether this restaurant hands out typed codes at all.
   *
   * A place with a QR on every table does not need them, and offering the
   * worse path beside the better one only sends people looking for a member
   * of staff they did not need to find. False here means the scanner is the
   * whole modal — no tabs, no "type it instead", nothing to choose.
   */
  codesEnabled?: boolean
  onVerified?: (session: DiningSession) => void
}) {
  const toast = useToast()
  const codes = codesEnabled !== false
  const [tab, setTab] = useState<'code' | 'scan'>(codes ? 'code' : 'scan')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(
    async (value: string) => {
      setBusy(true)
      setError('')
      try {
        const r = await api<{ session: DiningSession }>('/sessions', {
          body: { value, restaurantId },
        })
        saveDining(r.session)
        toast(
          r.session.tableLabel
            ? `You're at ${r.session.restaurantName} · ${r.session.tableLabel}`
            : `You're at ${r.session.restaurantName}`,
          'good',
        )
        onVerified?.(r.session)
        onClose()
      } catch (e) {
        setError((e as ApiError).message)
      } finally {
        setBusy(false)
      }
    },
    [restaurantId, onVerified, onClose, toast],
  )

  return (
    <Modal open={open} onClose={onClose} title="You're at the restaurant">
      <p className="tiny muted mb-2">
        {codes
          ? "Scan the QR on your table, or enter the code a staff member gives you. Do it whenever you like — once it's accepted you can order all through your meal without entering it again."
          : "Scan the QR on your table. Do it whenever you like — once it's accepted you can order all through your meal without scanning again."}
      </p>

      {error && <div className="form-error">{error}</div>}

      {/* No tabs when there is nothing to choose between. */}
      {codes && (
        <div className="tabs">
          <button className={`tab ${tab === 'code' ? 'active' : ''}`} onClick={() => setTab('code')}>
            Enter code
          </button>
          <button className={`tab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
            Scan QR
          </button>
        </div>
      )}

      {codes && tab === 'code' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(code)
          }}
        >
          <div className="field">
            <input
              className="input input-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="K7X92P"
              maxLength={6}
              autoComplete="off"
              autoCapitalize="characters"
              aria-label="Restaurant access code"
              autoFocus
            />
            <span className="hint">Six characters, shown on the restaurant's screen.</span>
          </div>
          <button className="btn btn-accent btn-block btn-lg" disabled={code.length !== 6 || busy}>
            {busy ? <Spinner /> : 'Start ordering'}
          </button>
        </form>
      ) : (
        <>
          <QRScanner onResult={submit} />
          {codes ? (
            <p className="tiny muted center">
              Camera blocked?{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => setTab('code')}>
                Type the code instead
              </button>
            </p>
          ) : (
            /* No code to fall back on, so the honest answer is the one thing
               that does work: ask at the counter rather than hunt for a
               button that is not there. */
            <p className="tiny muted center">
              Camera blocked? Allow the camera for this site, or ask at the counter.
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
