import { useEffect, useRef, useState } from 'react'
import { Art, money } from './ui'
import { sectionVoice } from '../lib/themes'

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

type Props = {
  menu: Category[]
  isOpen: boolean
  quantityOf: (id: number) => number
  setQuantity: (id: number, qty: number) => void
  onAdd: (item: MenuItem) => void
  inThisCart: boolean
}

/**
 * The menu as one section at a time rather than a long scroll: you pick a
 * kitchen and the room changes colour for it. Each section carries its own
 * accent and its own line (see lib/themes), so moving between them feels like
 * walking to a different part of the restaurant instead of scrolling a list.
 *
 * Everything stays on charcoal throughout — the accent tints edges, rules and
 * prices, and never becomes a background. That is the whole point of the look.
 */
export default function NoirMenu({ menu, isOpen, quantityOf, setQuantity, onAdd, inThisCart }: Props) {
  const sections = menu.filter((c) => c.items.length > 0)
  // -1 is the whole menu at once, for people who would rather read than click.
  const [active, setActive] = useState(-1)
  const showingAll = active === -1
  const current = showingAll ? null : sections[Math.min(active, sections.length - 1)]
  const total = sections.reduce((n, c) => n + c.items.length, 0)

  // Re-running the entrance on every change is what makes switching feel like a
  // change of room. The key is the section, so React rebuilds the list and the
  // stagger plays again.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    setEntered(false)
    const t = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(t)
  }, [active])

  // Keeps the chosen tab in view on a phone, where the rail scrolls.
  const railRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = railRef.current?.querySelector('[data-active="true"]') as HTMLElement | null
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [active])

  if (!sections.length) return null
  const voice = sectionVoice('noir', current?.name ?? '')

  return (
    <div className="noir" style={{ ['--accent' as string]: voice.accent }}>
      <div className="noir-rail" ref={railRef}>
        <button
          data-active={showingAll}
          className={`noir-tab ${showingAll ? 'on' : ''}`}
          style={{ ['--tab-accent' as string]: '#c9b291' }}
          onClick={() => setActive(-1)}
          aria-pressed={showingAll}
        >
          <span className="noir-tab-glyph" aria-hidden>
            ◇
          </span>
          <span className="noir-tab-name">Everything</span>
          <span className="noir-tab-count">{total}</span>
        </button>
        {sections.map((c, i) => {
          const v = sectionVoice('noir', c.name)
          const on = !showingAll && c.id === current!.id
          return (
            <button
              key={c.id}
              data-active={on}
              className={`noir-tab ${on ? 'on' : ''}`}
              style={{ ['--tab-accent' as string]: v.accent }}
              onClick={() => setActive(i)}
              aria-pressed={on}
            >
              <span className="noir-tab-glyph" aria-hidden>
                {v.glyph}
              </span>
              <span className="noir-tab-name">{c.name}</span>
              <span className="noir-tab-count">{c.items.length}</span>
            </button>
          )
        })}
      </div>

      {showingAll ? (
        <div className={`noir-all ${entered ? 'in' : ''}`}>
          {sections.map((c, si) => {
            const v = sectionVoice('noir', c.name)
            return (
              <section key={c.id} className="noir-all-section" style={{ ['--accent' as string]: v.accent }}>
                <header className="noir-head">
                  <p className="noir-kicker">{v.kicker}</p>
                  <h2 className="noir-title">{c.name}</h2>
                  <span className="noir-rule" aria-hidden />
                </header>
                <div className="noir-grid in">
                  {c.items.map((item, i) => (
                    <Dish
                      key={item.id}
                      item={item}
                      index={si === 0 ? i : Math.min(i, 3)}
                      isOpen={isOpen}
                      qty={quantityOf(item.id)}
                      inThisCart={inThisCart}
                      setQuantity={setQuantity}
                      onAdd={onAdd}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <>
          <header className="noir-head" key={`head-${current!.id}`}>
            <p className="noir-kicker">{voice.kicker}</p>
            <h2 className="noir-title">{current!.name}</h2>
            <span className="noir-rule" aria-hidden />
          </header>

          <div className={`noir-grid ${entered ? 'in' : ''}`} key={current!.id}>
            {current!.items.map((item, i) => (
              <Dish
                key={item.id}
                item={item}
                index={i}
                isOpen={isOpen}
                qty={quantityOf(item.id)}
                inThisCart={inThisCart}
                setQuantity={setQuantity}
                onAdd={onAdd}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** One plate. Shared by the single-section view and the whole-menu view. */
function Dish({
  item,
  index,
  isOpen,
  qty,
  inThisCart,
  setQuantity,
  onAdd,
}: {
  item: MenuItem
  index: number
  isOpen: boolean
  qty: number
  inThisCart: boolean
  setQuantity: (id: number, qty: number) => void
  onAdd: (item: MenuItem) => void
}) {
  return (
    <article className={`noir-card ${item.isAvailable ? '' : 'sold'}`} style={{ ['--i' as string]: index }}>
      <div className="noir-card-art">
        <Art emoji={item.emoji} hue={item.hue} imageUrl={item.imageUrl} alt={item.name} className="noir-art" />
        <span className="noir-card-veil" aria-hidden />
        {item.isSpecial && <span className="noir-flag">This month</span>}
      </div>

      <div className="noir-card-body">
        <div className="noir-card-top">
          <h3>{item.name}</h3>
          <span className={`veg-dot ${item.isVeg ? '' : 'nonveg'}`} aria-hidden />
        </div>
        <p className="noir-card-desc">{item.description}</p>
        <div className="noir-card-foot">
          <span className="noir-price">{money(item.priceCents)}</span>
          {!item.isAvailable ? (
            <span className="noir-sold">Sold out</span>
          ) : qty > 0 && inThisCart ? (
            <div className="noir-step">
              <button onClick={() => setQuantity(item.id, qty - 1)} aria-label={`Remove one ${item.name}`}>
                −
              </button>
              <span>{qty}</span>
              <button onClick={() => onAdd(item)} aria-label={`Add one ${item.name}`}>
                +
              </button>
            </div>
          ) : (
            <button className="noir-add" onClick={() => onAdd(item)} disabled={!isOpen}>
              Add
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
