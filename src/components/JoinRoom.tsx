import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { QRScanner } from '../lib/qr'
import { Modal, Spinner } from './ui'

type Resolved =
  | { kind: 'room'; code: string }
  | { kind: 'table'; tableToken: string }
  | { kind: 'access'; restaurantId: number }

/**
 * One box for whatever a friend sent or a table shows: a room code, a room
 * link, a table QR, or the restaurant's own code. The app works out which it
 * is and goes to the right place.
 */
export default function JoinRoom({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  /** Closing always stops the camera — it should never run behind a shut sheet. */
  const close = useCallback(() => {
    setScanning(false)
    setError('')
    onClose()
  }, [onClose])

  const go = useCallback(
    async (value: string) => {
      setBusy(true)
      setError('')
      try {
        const r = await api<Resolved>('/resolve', { body: { value } })
        close()
        setCode('')
        if (r.kind === 'room') navigate(`/g/${r.code}`)
        else if (r.kind === 'table') navigate(`/t/${r.tableToken}`)
        else navigate(`/r/${r.restaurantId}`)
      } catch (e) {
        setError((e as ApiError).message)
      } finally {
        setBusy(false)
      }
    },
    [navigate, close],
  )

  return (
    <Modal open={open} onClose={close} title="Join">
      {error && <div className="form-error">{error}</div>}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          go(code)
        }}
      >
        <div className="field">
          <input
            className="input input-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="7KQ2"
            maxLength={6}
            autoComplete="off"
            autoCapitalize="characters"
            aria-label="Room or restaurant code"
            autoFocus
          />
        </div>
        <button className="btn btn-accent btn-block btn-lg" disabled={code.length < 4 || busy}>
          {busy ? <Spinner /> : 'Go'}
        </button>
      </form>

      {open && scanning ? (
        <QRScanner onResult={go} />
      ) : (
        <button className="btn btn-ghost btn-block" onClick={() => setScanning(true)}>
          Scan instead
        </button>
      )}
    </Modal>
  )
}
