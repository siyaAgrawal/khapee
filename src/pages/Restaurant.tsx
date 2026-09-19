import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { api, ApiError } from '../lib/api'
import { useVegMode } from '../lib/veg'
import { dishMatches, searchWords } from '../lib/menu-search'
import { Art, EmptyState, ErrorState, LoadingBlock, money, useToast } from '../components/ui'
import { useCart } from '../lib/cart'
import { readTableContext } from '../lib/table-context'
import { ownOrderOnly, readDining } from '../lib/dining'
import { readGroup } from '../lib/group'
import DiningBar from '../components/DiningBar'
import NoirMenu from '../components/NoirMenu'
import { applyTheme } from '../lib/themes'
import { NoirMark, NoirWordmark } from '../components/NoirBrand'
import { HutMark, HutWordmark } from '../components/HutBrand'
import { ReveryMark, ReveryWordmark } from '../components/ReveryBrand'
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

/**
 * Where this kitchen delivers, named.
 *
 * "We deliver nearby" is true of every restaurant that delivers at all, so it
 * tells a reader nothing they did not already know from the offer being
 * there — and leaves them to open the delivery page to find out whether their
 * own area is on the list. The areas have names; using them answers the
 * question on the spot.
 *
 * Long lists are cut short rather than run on, because the point is
 * recognition — somebody is looking for their own area, not reading an
 * inventory — and "nearby" is kept for a restaurant that has named none.
 */
function deliversTo(areas: string[] | undefined): string {
  const named = (areas ?? []).filter(Boolean)
  if (!named.length) return 'We deliver nearby — the kitchen confirms first.'
  const where =
    named.length === 1
      ? named[0]
      : named.length <= 3
        ? `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
        : `${named.slice(0, 3).join(', ')} and ${named.length - 3} more`
  return `We deliver in ${where} — the kitchen confirms first.`
}

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
  const dining = readDining(restaurantId)
  const activeGroup = readGroup()
  // Somebody in their car was being told "You're at table GSRCQ — add to it"
  // in the same breath as "In the car". The session they are actually in wins.
  const inThisGroup = activeGroup?.restaurantId === restaurantId && !ownOrderOnly(restaurantId)

  /**
   * `quietly` refetches without blanking the page first, which is what a
   * refresh in the background has to do — clearing to a spinner every time
   * somebody switches back to the tab is worse than a stale price.
   */
  const load = (quietly = false) => {
    setError('')
    if (!quietly) setData(null)
    api<{ restaurant: RestaurantCard; menu: Category[] }>(
      `/restaurants/${restaurantId}${veg ? '?veg=1' : ''}`,
    )
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
  }

  useEffect(() => load(), [restaurantId, veg]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A menu left open on a phone is a photograph of a moment.
   *
   * The restaurant edits a price or marks something sold out, looks at the
   * page it already had open, and sees the old menu — because nothing asked
   * the server again. Coming back to the tab is the moment to ask.
   */
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') load(true)
    }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener('focus', again)
    }
  }, [restaurantId, veg]) // eslint-disable-line react-hooks/exhaustive-deps

  // A restaurant with its own look gets its own menu component. Everything
  // outside the menu — cart bar, dining bar, table context — is shared, so a
  // theme changes how the food reads and nothing about how ordering works.
  const theme = (data?.restaurant.theme ?? '') as 'noir' | 'hut' | 'revery' | 'plain' | ''
  const noir = theme === 'noir'
  const hut = theme === 'hut'
  const revery = theme === 'revery'
  /**
   * "plain" is not a look of its own — it is the ordinary page with the
   * photographs left off. A restaurant whose pictures are not good enough to
   * sell the food is better read than looked at, and the standard layout is
   * easier to use than any of the dressed-up ones.
   */
  const noPhotos = theme === 'plain'

  /**
   * Finding one dish on a long menu.
   *
   * Nineteen sections and eighty dishes is four screens of scrolling to answer
   * "do they do a cold coffee". The section chips help someone browsing; they
   * are no help at all to someone who already knows what they want. Matching
   * the description as well as the name is deliberate — people search for
   * "paneer" and the paneer is often only in the description.
   */
  const [query, setQuery] = useState('')
  /** Themed restaurants share the menu and page shell, dressed differently. */
  const themed = noir || hut || revery
  const noirPage = themed

  /**
   * A themed restaurant takes the page's palette with it. The app otherwise
   * follows the device, and on a phone set to light this page rendered cream on
   * cream — the theme's own colours assume a dark ground. Cleared on the way
   * out so the rest of the app goes back to whatever the device asked for.
   */
  useEffect(() => applyTheme(theme), [theme])

  /** The menu as it should read right now: every section, minus what was typed out. */
  const words = searchWords(query)
  const needle = query.trim()
  const shown = !words.length
    ? (data?.menu ?? [])
    : (data?.menu ?? [])
        .map((c) => ({ ...c, items: c.items.filter((i) => dishMatches(i, c.name, words)) }))
        .filter((c) => c.items.length > 0)
  const foundCount = shown.reduce((n, c) => n + c.items.length, 0)

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
      <main className={`page ${themed ? 'noir-page' : ''} ${hut ? 'hut-page' : ''} ${revery ? 'revery-page' : ''}`}>
        {error && <ErrorState message={error} onRetry={load} />}
        {!data && !error && <LoadingBlock label="Loading the menu…" />}

        {data && (
          <>
            {themed ? (
              <header className="noir-hero">
                <div className="noir-hero-art">
                  <Art
                    emoji={data.restaurant.emoji}
                    hue={data.restaurant.hue}
                    imageUrl={noPhotos ? null : data.restaurant.imageUrl}
                    alt={data.restaurant.name}
                    className="noir-hero-img"
                  />
                  <span className="noir-hero-veil" aria-hidden />
                  <span className="noir-hero-sheen" aria-hidden />
                </div>

                <div className="noir-hero-lockup">
                  <span className="noir-hero-mark">
                    {revery ? <ReveryMark size={50} /> : hut ? <HutMark size={48} /> : <NoirMark size={46} />}
                  </span>
                  {revery ? <ReveryWordmark /> : hut ? <HutWordmark /> : <NoirWordmark />}
                  <p className="noir-hero-line">{data.restaurant.description}</p>
                  <div className="noir-hero-meta">
                    <span className={data.restaurant.isOpen ? 'noir-open' : 'noir-shut'}>
                      {data.restaurant.isOpen ? 'Open now' : 'Closed'}
                    </span>
                    <span>{data.restaurant.hours}</span>
                    <span>~{data.restaurant.prepMinutes} min</span>
                  </div>
                </div>

                {/* Ordering to wherever you are standing in the area, beside
                    eating in, takeaway and the kerb — because from the street
                    it is simply another way to order from this kitchen. */}
                {data.restaurant.isOpen &&
                  !dining &&
                  (data.restaurant.precincts ?? []).map((p) => (
                    <Link key={p.id} className="road-cta" to={`/r/${restaurantId}/nearby/${p.slug}`}>
                      <span className="road-cta-mark" aria-hidden>
                        🚶
                      </span>
                      <span>
                        <strong>Somewhere in {p.name}?</strong>
                        <span className="tiny muted">
                          Tell them where you are and they&rsquo;ll walk it over.
                        </span>
                      </span>
                      <span className="road-cta-go" aria-hidden>
                        →
                      </span>
                    </Link>
                  ))}
                {data.restaurant.isOpen && data.restaurant.acceptsCar && !dining && (
                  <Link className="road-cta" to={`/r/${restaurantId}/car`}>
                    <span className="road-cta-mark" aria-hidden>
                      🚗
                    </span>
                    <span>
                      <strong>Sitting in your car?</strong>
                      <span className="tiny muted">Order from the road — we&rsquo;ll bring it out.</span>
                    </span>
                    <span className="road-cta-go" aria-hidden>
                      →
                    </span>
                  </Link>
                )}
                {data.restaurant.isOpen && data.restaurant.acceptsDelivery && !dining && (
                  <Link className="road-cta" to={`/r/${restaurantId}/delivery`}>
                    <span className="road-cta-mark" aria-hidden>
                      🛵
                    </span>
                    <span>
                      <strong>Want it at home?</strong>
                      <span className="tiny muted">{deliversTo(data.restaurant.deliveryAreas)}</span>
                    </span>
                    <span className="road-cta-go" aria-hidden>
                      →
                    </span>
                  </Link>
                )}
                {data.restaurant.isOpen && (
                  <div className="noir-hero-dining">
                    <DiningBar restaurantId={restaurantId} />
                  </div>
                )}
                {inThisGroup && (
                  <Link className="noir-hero-group" to="/group">
                    You&rsquo;re at table {activeGroup!.code} — add to it
                  </Link>
                )}
              </header>
            ) : (
            <div className="r-hero">
              <Art
                emoji={data.restaurant.emoji}
                hue={data.restaurant.hue}
                imageUrl={noPhotos ? null : data.restaurant.imageUrl}
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
                {/* Ordering to wherever you are standing in the area, beside
                    eating in, takeaway and the kerb — because from the street
                    it is simply another way to order from this kitchen. */}
                {data.restaurant.isOpen &&
                  !dining &&
                  (data.restaurant.precincts ?? []).map((p) => (
                    <Link key={p.id} className="road-cta" to={`/r/${restaurantId}/nearby/${p.slug}`}>
                      <span className="road-cta-mark" aria-hidden>
                        🚶
                      </span>
                      <span>
                        <strong>Somewhere in {p.name}?</strong>
                        <span className="tiny muted">
                          Tell them where you are and they&rsquo;ll walk it over.
                        </span>
                      </span>
                      <span className="road-cta-go" aria-hidden>
                        →
                      </span>
                    </Link>
                  ))}
                {data.restaurant.isOpen && data.restaurant.acceptsCar && !dining && (
                  <Link className="road-cta" to={`/r/${restaurantId}/car`}>
                    <span className="road-cta-mark" aria-hidden>
                      🚗
                    </span>
                    <span>
                      <strong>Sitting in your car?</strong>
                      <span className="tiny muted">Order from the road — we&rsquo;ll bring it out.</span>
                    </span>
                    <span className="road-cta-go" aria-hidden>
                      →
                    </span>
                  </Link>
                )}
                {data.restaurant.isOpen && data.restaurant.acceptsDelivery && !dining && (
                  <Link className="road-cta" to={`/r/${restaurantId}/delivery`}>
                    <span className="road-cta-mark" aria-hidden>
                      🛵
                    </span>
                    <span>
                      <strong>Want it at home?</strong>
                      <span className="tiny muted">{deliversTo(data.restaurant.deliveryAreas)}</span>
                    </span>
                    <span className="road-cta-go" aria-hidden>
                      →
                    </span>
                  </Link>
                )}
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
            )}

            {themed ? (
              <NoirMenu
                theme={theme}
                menu={data.menu}
                isOpen={data.restaurant.isOpen}
                quantityOf={quantityOf}
                setQuantity={setQuantity}
                onAdd={onAdd}
                inThisCart={cart.restaurantId === data.restaurant.id}
              />
            ) : (
              <>
            {/* Above the section chips, because someone who knows what they
                want should not have to read the chips to find out it is not
                there. */}
            <div className="menu-find">
              <span className="menu-find-mark" aria-hidden>
                ⌕
              </span>
              <input
                className="input menu-find-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${data.restaurant.name}\u2019s menu`}
                aria-label="Search the menu"
                type="search"
              />
              {!!needle && (
                <button className="menu-find-clear" onClick={() => setQuery('')} aria-label="Clear search">
                  ✕
                </button>
              )}
            </div>
            {!!needle && (
              <p className="tiny muted menu-find-count">
                {foundCount} {foundCount === 1 ? 'dish' : 'dishes'} matching &ldquo;{query.trim()}&rdquo;
              </p>
            )}

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
              {shown.map((c) => (
                <a key={c.id} href={`#cat-${c.id}`} className="chip">
                  {c.name}
                </a>
              ))}
            </nav>

            {!!needle && foundCount === 0 && (
              <EmptyState
                emoji="🔍"
                title={`Nothing matching \u201c${query.trim()}\u201d`}
                body={veg ? 'Try another word, or turn off Veg only.' : 'Try another word.'}
                action={
                  <button className="btn btn-secondary" onClick={() => setQuery('')}>
                    Show the whole menu
                  </button>
                }
              />
            )}

            {!needle &&
              data.menu.every((c) => c.items.length === 0) &&
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

            {shown.map((category) => (
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
                          imageUrl={noPhotos ? null : item.imageUrl}
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
