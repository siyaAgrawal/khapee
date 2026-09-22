import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import { useCart } from '../lib/cart'
import { api, ApiError } from '../lib/api'
import { saveGroup, useGroup } from '../lib/group'
import { ownOrderOnly, readDining } from '../lib/dining'
import { readTableContext } from '../lib/table-context'
import { useSession } from '../lib/session'
import { QRCanvas } from '../lib/qr'
import { Art, EmptyState, Modal, money, Spinner, useToast } from '../components/ui'

export default function Cart() {
  const { cart, count, totalCents, setQuantity, clear } = useCart()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useSession()
  const { group, leave } = useGroup()
  // Waiting in a car or at home is this party's own order, whatever room they
  // were last in at this restaurant. Group ordering is untouched everywhere
  // else — see ownOrderOnly.
  const ownOrder = ownOrderOnly(cart.restaurantId ?? undefined)
  const inGroup = !!group && group.restaurantId === cart.restaurantId && !ownOrder
  const [adding, setAdding] = useState(false)
  const [roomCode, setRoomCode] = useState<string | null>(inGroup ? group!.code : null)
  const [shareOpen, setShareOpen] = useState(false)
  const [opening, setOpening] = useState(false)

  // In a group, the cart is a staging area: items go onto the shared table
  // order attributed to you, rather than becoming an order of their own.
  const addToTable = async () => {
    if (!group) return
    setAdding(true)
    try {
      await api('/groups/session/items', {
        body: {
          groupToken: group.token,
          items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
        },
      })
      clear()
      toast('Added to your table', 'good')
      navigate('/group', { replace: true })
    } catch (e) {
      /**
       * The table is gone, so stop being in it.
       *
       * A dead token fails here every time it is tried, and leaving the
       * handle in place leaves somebody pressing a button that cannot work.
       * Dropping out turns the cart back into an ordinary order they can
       * actually place, which is what they were trying to do.
       */
      const err = e as ApiError
      if (err.status === 401 || err.status === 404 || err.status === 409) {
        leave()
        toast('That table has closed — this is your own order now.', 'info')
      } else {
        toast(err.message, 'bad')
      }
      setAdding(false)
    }
  }

  /**
   * Opens a room around this cart so friends can add their own food to it.
   * If you have already scanned a table or entered a code, the room takes that
   * table; otherwise it is an order-ahead room, needing no code from anyone.
   */
  const invite = async () => {
    if (!cart.restaurantId) return
    setOpening(true)
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
      setRoomCode(r.session.code)
      setShareOpen(true)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setOpening(false)
    }
  }

  const joinUrl = roomCode ? `${window.location.origin}/g/${roomCode}` : ''

  return (
    <div className="app">
      <Header />
      <main className="page page-narrow">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h1>Your cart</h1>
          {count > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={clear}>
              Clear
            </button>
          )}
        </div>

        {count === 0 ? (
          <EmptyState
            emoji="🛒"
            title="Your cart is empty"
            body="Pick a restaurant and add a few things — it only takes a moment."
            action={
              <Link className="btn btn-accent" to="/">
                Browse restaurants
              </Link>
            }
          />
        ) : (
          <>
            <div className="card card-pad">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p className="tiny muted" style={{ marginBottom: 6 }}>
                    Ordering from
                  </p>
                  <h2 style={{ marginBottom: 6 }}>{cart.restaurantName}</h2>
                </div>
                {/* A room is a table's shared ticket, so there is nothing to
                    invite anyone to from a car or an address — and offering it
                    there only led to "Please choose your table number". */}
                {!ownOrder && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={roomCode ? () => setShareOpen(true) : invite}
                    disabled={opening}
                  >
                    {opening ? <Spinner /> : roomCode ? `👥 ${roomCode}` : '👥 Invite'}
                  </button>
                )}
              </div>
              {cart.lines.map((line) => (
                <div key={line.menuItemId} className="cart-line">
                  <Art emoji={line.emoji} hue={line.hue} className="cart-line-art" rounded={14} />
                  <div className="cart-line-body">
                    <strong>{line.name}</strong>
                    <span className="tiny muted">{money(line.priceCents)} each</span>
                  </div>
                  <div className="stepper">
                    <button onClick={() => setQuantity(line.menuItemId, line.quantity - 1)} aria-label="Decrease">
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button onClick={() => setQuantity(line.menuItemId, line.quantity + 1)} aria-label="Increase">
                      +
                    </button>
                  </div>
                  <strong style={{ minWidth: 62, textAlign: 'right' }}>
                    {money(line.priceCents * line.quantity)}
                  </strong>
                </div>
              ))}
            </div>

            <div className="card card-pad mt-3">
              <div className="summary-row">
                <span>
                  {count} item{count > 1 ? 's' : ''}
                </span>
                <span>{money(totalCents)}</span>
              </div>
              <div className="summary-row">
                <span>Taxes &amp; charges</span>
                <span>Settled at the restaurant</span>
              </div>
              <div className="summary-total">
                <span>Total</span>
                <span>{money(totalCents)}</span>
              </div>
            </div>

            {/* A way out, said plainly.
                Being in a group changes what this whole screen does — the
                cart stops being an order and becomes a staging area for
                somebody else's table — so anybody who is not actually at
                that table has to be able to say so. Without this, a
                remembered group was a trap with no visible door. */}
            {inGroup && (
              <p className="tiny muted center" style={{ marginBottom: 8 }}>
                Ordering for table {group!.code}.{' '}
                <button className="link-btn" onClick={leave}>
                  Not with them? Order on your own
                </button>
              </p>
            )}

            <div className="cart-bar">
              <div className="cart-bar-info">
                <strong>{money(totalCents)}</strong>
                <span>
                  {inGroup
                    ? `Adding to group ${group!.code}`
                    : `${count} item${count > 1 ? 's' : ''} from ${cart.restaurantName}`}
                </span>
              </div>
              {inGroup ? (
                <button className="btn btn-accent" onClick={addToTable} disabled={adding}>
                  {adding ? <Spinner /> : 'Add to table'}
                </button>
              ) : (
                <button className="btn btn-accent" onClick={() => navigate('/checkout')}>
                  Continue
                </button>
              )}
            </div>
          </>
        )}

        <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Ask them to join">
          {roomCode && (
            <div className="center">
              <div className="code-display">{roomCode}</div>
              <div style={{ display: 'grid', placeItems: 'center', margin: '16px 0' }}>
                <QRCanvas value={joinUrl} size={220} />
              </div>
              <button
                className="btn btn-accent btn-block"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(joinUrl)
                    toast('Link copied', 'good')
                  } catch {
                    toast(joinUrl, 'info')
                  }
                }}
              >
                Copy link
              </button>
            </div>
          )}
        </Modal>
      </main>
    </div>
  )
}
