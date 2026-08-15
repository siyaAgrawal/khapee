import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import { useCart } from '../lib/cart'
import { api, ApiError } from '../lib/api'
import { readGroup } from '../lib/group'
import { Art, EmptyState, money, Spinner, useToast } from '../components/ui'

export default function Cart() {
  const { cart, count, totalCents, setQuantity, clear } = useCart()
  const navigate = useNavigate()
  const toast = useToast()
  const group = readGroup()
  const inGroup = !!group && group.restaurantId === cart.restaurantId
  const [adding, setAdding] = useState(false)

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
      toast((e as ApiError).message, 'bad')
      setAdding(false)
    }
  }

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
              <p className="tiny muted" style={{ marginBottom: 6 }}>
                Ordering from
              </p>
              <h2 style={{ marginBottom: 6 }}>{cart.restaurantName}</h2>
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
      </main>
    </div>
  )
}
