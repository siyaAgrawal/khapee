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
  onVerified,
}: {
  open: boolean
  onClose: () => void
  /** Restricts the code to one restaurant. Omit to accept any. */
  restaurantId?: number
  onVerified?: (session: DiningSession) => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<'code' | 'scan'>('code')
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
        Scan the QR on your table, or enter the code a staff member gives you. Do it whenever you
        like — once it's accepted you can order all through your meal without entering it again.
      </p>

      {error && <div className="form-error">{error}</div>}

      <div className="tabs">
        <button className={`tab ${tab === 'code' ? 'active' : ''}`} onClick={() => setTab('code')}>
          Enter code
        </button>
        <button className={`tab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
          Scan QR
        </button>
      </div>

      {tab === 'code' ? (
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
          <p className="tiny muted center">
            Camera blocked?{' '}
            <button className="btn btn-ghost btn-sm" onClick={() => setTab('code')}>
              Type the code instead
            </button>
          </p>
        </>
      )}
    </Modal>
  )
}
