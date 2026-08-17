import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { useVegMode } from '../lib/veg'
import { Art, EmptyState, ErrorState, LoadingBlock, money, useToast } from '../components/ui'
import { useCart } from '../lib/cart'
import { readTableContext } from '../lib/table-context'
import { readGroup } from '../lib/group'
import DiningBar from '../components/DiningBar'
import NoirMenu from '../components/NoirMenu'
import type { RestaurantCard } from './Home'

type MenuItem = {
  id: number
  name: string
  description: string
  priceCents: number
  emoji: string
  hue: number
  imageUrl: string | null
  isVeg: boolean
  isAvailable: boolean
  isSpecial: boolean
}
type Category = { id: number; name: string; items: MenuItem[] }

export default function Restaurant() {
  const { id } = useParams()
  const restaurantId = Number(id)
  const navigate = useNavigate()
  const toast = useToast()
  const { add, quantityOf, setQuantity, count, totalCents, cart } = useCart()
  const [veg, setVeg] = useVegMode()

  const [data, setData] = useState<{ restaurant: RestaurantCard; menu: Category[] } | null>(null)
  const [error, setError] = useState('')
  const tableCtx = readTableContext(restaurantId)
  const activeGroup = readGroup()
  const inThisGroup = activeGroup?.restaurantId === restaurantId

  const load = () => {
    setError('')
    setData(null)
    api<{ restaurant: RestaurantCard; menu: Category[] }>(
      `/restaurants/${restaurantId}${veg ? '?veg=1' : ''}`,
    )
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
  }

  useEffect(load, [restaurantId, veg])

  // A restaurant with its own look gets its own menu component. Everything
  // outside the menu — cart bar, dining bar, table context — is shared, so a
  // theme changes how the food reads and nothing about how ordering works.
  const noir = data?.restaurant.theme === 'noir'

  const onAdd = (item: MenuItem) => {
    if (!data) return
    if (!data.restaurant.isOpen) {
      toast(`${data.restaurant.name} is closed right now.`, 'bad')
      return
    }
    const outcome = add({ id: data.restaurant.id, name: data.restaurant.name }, item)
    if (outcome === 'switched') toast('Started a new cart for this restaurant', 'info')
  }

  return (
    <div className="app">
      <Header />
      <main className="page">
        {error && <ErrorState message={error} onRetry={load} />}
        {!data && !error && <LoadingBlock label="Loading the menu…" />}

        {data && (
          <>
            <div className={`r-hero ${noir ? 'r-hero-noir' : ''}`}>
              <Art
                emoji={data.restaurant.emoji}
                hue={data.restaurant.hue}
                imageUrl={data.restaurant.imageUrl}
                alt={data.restaurant.name}
                className={`r-hero-art ${data.restaurant.isOpen ? '' : 'closed-art'}`}
              />
              <div className="r-hero-body">
                <div className="row row-wrap" style={{ justifyContent: 'space-between' }}>
                  <h1>{data.restaurant.name}</h1>
                  <span className={`badge ${data.restaurant.isOpen ? 'badge-open' : 'badge-closed'}`}>
                    {data.restaurant.isOpen ? 'Open now' : 'Closed'}
                  </span>
                </div>
                <p className="muted" style={{ marginTop: 4 }}>
                  {data.restaurant.description}
                </p>
                <div className="r-card-meta">
                  {data.restaurant.rating ? <span>★ {data.restaurant.rating.toFixed(1)}</span> : null}
                  <span className={data.restaurant.rating ? 'dot-sep' : ''}>
                    {data.restaurant.categories.join(' · ')}
                  </span>
                  <span className="dot-sep">{data.restaurant.hours}</span>
                  <span className="dot-sep">~{data.restaurant.prepMinutes} min</span>
                </div>
                {data.restaurant.isOpen && (
                  <div style={{ marginTop: 14 }}>
                    <DiningBar restaurantId={restaurantId} />
                  </div>
                )}
                {tableCtx && (
                  <p className="tiny muted" style={{ marginTop: 8 }}>
                    {tableCtx.tableLabel}
                  </p>
                )}
                {inThisGroup && (
                  <div className="row row-wrap" style={{ marginTop: 12 }}>
                    <Link className="btn btn-secondary btn-sm" to="/group">
                      👥 You&rsquo;re at table {activeGroup!.code} — add to it
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {noir ? (
              <NoirMenu
                menu={data.menu}
                isOpen={data.restaurant.isOpen}
                quantityOf={quantityOf}
                setQuantity={setQuantity}
                onAdd={onAdd}
                inThisCart={cart.restaurantId === data.restaurant.id}
              />
            ) : (
              <>
            <nav className="menu-nav">
              <button
                className={`veg-toggle veg-toggle-sm ${veg ? 'on' : ''}`}
                onClick={() => setVeg(!veg)}
                aria-pressed={veg}
                aria-label="Veg only"
              >
                <span className="veg-mark" aria-hidden />
                Veg
              </button>
              {data.menu.map((c) => (
                <a key={c.id} href={`#cat-${c.id}`} className="chip">
                  {c.name}
                </a>
              ))}
            </nav>

            {data.menu.every((c) => c.items.length === 0) &&
              (veg ? (
                <EmptyState
                  emoji="🥬"
                  title="Nothing veg here"
                  action={
                    <button className="btn btn-secondary" onClick={() => setVeg(false)}>
                      Show everything
                    </button>
                  }
                />
              ) : (
                <EmptyState emoji="📋" title="No dishes yet" body="This restaurant hasn't published a menu." />
              ))}

            {data.menu.map((category) => (
              <section key={category.id} id={`cat-${category.id}`} className="menu-section">
                <h2>{category.name}</h2>
                <div className="item-grid">
                  {category.items.map((item) => {
                    const qty = quantityOf(item.id)
                    const inThisCart = cart.restaurantId === data.restaurant.id
                    return (
                      <article
                        key={item.id}
                        className={`item-card ${item.isAvailable ? '' : 'item-unavailable'}`}
                      >
                        <Art
                          emoji={item.emoji}
                          hue={item.hue}
                          imageUrl={item.imageUrl}
                          alt={item.name}
                          className="item-art"
                        />
                        <div className="item-body">
                          <div className="item-title">
                            <span className={`veg-dot ${item.isVeg ? '' : 'nonveg'}`} aria-hidden />
                            {item.isSpecial && <span className="star" title="This month">★</span>}
                            {item.name}
                          </div>
                          <p className="item-desc">{item.description}</p>
                          <div className="item-foot">
                            <span className="item-price">{money(item.priceCents)}</span>
                            {!item.isAvailable ? (
                              <span className="badge">Sold out</span>
                            ) : qty > 0 && inThisCart ? (
                              <div className="stepper">
                                <button onClick={() => setQuantity(item.id, qty - 1)} aria-label={`Remove one ${item.name}`}>
                                  −
                                </button>
                                <span>{qty}</span>
                                <button onClick={() => onAdd(item)} aria-label={`Add one ${item.name}`}>
                                  +
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => onAdd(item)}
                                disabled={!data.restaurant.isOpen}
                              >
                                Add
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
              </>
            )}
          </>
        )}
      </main>

      {count > 0 && cart.restaurantId === restaurantId && (
        <div className="cart-bar">
          <div className="cart-bar-info">
            <strong>
              {count} item{count > 1 ? 's' : ''} · {money(totalCents)}
            </strong>
            <span>{inThisGroup ? `Adding to group ${activeGroup!.code}` : cart.restaurantName}</span>
          </div>
          <button className="btn btn-accent" onClick={() => navigate('/cart')}>
            {inThisGroup ? 'Add to table' : 'View cart'}
          </button>
        </div>
      )}


      {count > 0 && cart.restaurantId !== restaurantId && (
        <div className="cart-bar">
          <div className="cart-bar-info">
            <strong>Cart from {cart.restaurantName}</strong>
            <span>Adding here will start a new cart</span>
          </div>
          <Link className="btn btn-secondary btn-sm" to="/cart">
            Open
          </Link>
        </div>
      )}
    </div>
  )
}
