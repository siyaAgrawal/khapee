import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { QRCanvas, QRScanner } from '../lib/qr'
import { useCart } from '../lib/cart'
import { readGroup, saveGroup } from '../lib/group'
import { readDining } from '../lib/dining'
import { readTableContext } from '../lib/table-context'
import { useSession } from '../lib/session'
import { Modal, Spinner, useToast } from './ui'

type Resolved =
  | { kind: 'room'; code: string }
  | { kind: 'table'; tableToken: string }
  | { kind: 'access'; restaurantId: number }

/**
 * Both directions of the same thing. Joining takes whatever a friend sent or a
 * table shows — a room code, a room link, a table QR, the restaurant's own code
 * — and works out which it is. Sharing hands over the code for the room you are
 * ordering in, opening one first if your cart has not become a room yet.
 */
export default function JoinRoom({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { cart } = useCart()
  const { user } = useSession()
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)

  const group = readGroup()
  const myRoom = group && (!cart.restaurantId || group.restaurantId === cart.restaurantId) ? group.code : null
  const [shared, setShared] = useState<string | null>(null)
  const showing = shared ?? myRoom
  const shareUrl = showing ? `${window.location.origin}/g/${showing}` : ''

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

  /**
   * A cart with nobody else in it becomes a room the moment you share it. If
   * you have already scanned a table or entered a code the room takes that
   * table; otherwise it is an order-ahead room, needing no code from anyone.
   */
  const openRoom = async () => {
    if (!cart.restaurantId) return
    setOpening(true)
    setError('')
    try {
      const dining = readDining(cart.restaurantId)
      const scanned = readTableContext(cart.restaurantId)
      const r = await api<{ groupToken: string; session: { code: string } }>('/groups', {
        body: {
          restaurantId: cart.restaurantId,
          hostName: user?.name || 'Me',
          tableToken: scanned?.tableToken ?? null,
          sessionToken: dining?.token ?? null,
          ahead: true,
        },
      })
      saveGroup({ token: r.groupToken, code: r.session.code, restaurantId: cart.restaurantId })
      setShared(r.session.code)
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setOpening(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast('Link copied', 'good')
    } catch {
      toast(shareUrl, 'info')
    }
  }

  return (
    <Modal open={open} onClose={close} title="Want to join an order room?">
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

      {(showing || cart.restaurantId) && (
        <div className="join-share">
          {showing ? (
            <>
              <p className="tiny muted">Yours</p>
              <div className="code-display">{showing}</div>
              <div style={{ display: 'grid', placeItems: 'center', margin: '14px 0' }}>
                <QRCanvas value={shareUrl} size={180} />
              </div>
              <button className="btn btn-secondary btn-block" onClick={copy}>
                Copy link
              </button>
            </>
          ) : (
            <>
              <p className="tiny muted">Ordering from {cart.restaurantName}</p>
              <button className="btn btn-secondary btn-block" disabled={opening} onClick={openRoom}>
                {opening ? <Spinner /> : 'Get a code to share'}
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
