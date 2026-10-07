import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export type CartLine = {
  /** One line per dish *and* choice: "Pizza · Large" and "Pizza · Small" are two lines. */
  key: string
  menuItemId: number
  /** The variation picked, for a dish that has them. */
  variationId?: number | null
  /** The add-ons picked. */
  addonIds?: number[]
  /** "Large · Extra cheese", shown under the name. */
  options?: string
  name: string
  emoji: string
  hue: number
  priceCents: number
  quantity: number
}

export type CartState = {
  restaurantId: number | null
  restaurantName: string
  lines: CartLine[]
}

const KEY = 'khapee.cart'

/** What makes two cart lines the same line: the dish and exactly what was chosen. */
export function lineKey(menuItemId: number, variationId?: number | null, addonIds?: number[]): string {
  return `${menuItemId}|${variationId ?? ''}|${[...(addonIds ?? [])].sort((a, b) => a - b).join(',')}`
}

/** The cart as the server wants it: dishes, quantities and choices — never prices. */
export function cartItems(lines: CartLine[]) {
  return lines.map((l) => ({
    menuItemId: l.menuItemId,
    quantity: l.quantity,
    ...(l.variationId != null ? { variationId: l.variationId } : {}),
    ...(l.addonIds?.length ? { addonIds: l.addonIds } : {}),
  }))
}

/** A choice made in the options sheet. */
export type Choice = { variationId: number | null; addonIds: number[]; label: string; unitPriceCents: number }
const EMPTY: CartState = { restaurantId: null, restaurantName: '', lines: [] }

function load(): CartState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.lines)) return EMPTY
    // Baskets saved before lines had keys are given one.
    parsed.lines = parsed.lines.map((l: CartLine) => (l.key ? l : { ...l, key: lineKey(l.menuItemId) }))
    return parsed as CartState
  } catch {
    return EMPTY
  }
}

type CartValue = {
  cart: CartState
  count: number
  totalCents: number
  add: (
    restaurant: { id: number; name: string },
    item: { id: number; name: string; emoji: string; hue: number; priceCents: number },
    choice?: Choice,
  ) => 'added' | 'switched'
  /**
   * A line key sets that line. A dish id sets the dish's total, taking from
   * (or adding to) its most recent line — which is what a − on the menu means
   * for a dish that is in the basket more than one way.
   */
  setQuantity: (target: number | string, quantity: number) => void
  remove: (target: number | string) => void
  clear: () => void
  /** Every unit of this dish in the basket, whatever was chosen with it. */
  quantityOf: (menuItemId: number) => number
}

const CartContext = createContext<CartValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>(load)
  /** The current basket, readable outside a render — see add(). */
  const cartRef = useRef(cart)
  cartRef.current = cart

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cart))
    } catch {
      /* ignore quota / private mode */
    }
  }, [cart])

  const add: CartValue['add'] = useCallback((restaurant, item, choice) => {
    /*
     * Decided here rather than inside the updater below.
     *
     * It used to be assigned in there and read straight after the setCart
     * call — but React runs an updater when it renders, not when it is
     * handed over, so the value read back was always the one it started
     * with. "Started a new cart for this restaurant" therefore never
     * appeared, on the one occasion somebody needs telling: the moment
     * their previous basket is thrown away.
     */
    const outcome: 'added' | 'switched' =
      cartRef.current.restaurantId &&
      cartRef.current.restaurantId !== restaurant.id &&
      cartRef.current.lines.length
        ? 'switched'
        : 'added'

    const fresh: CartLine = {
      key: lineKey(item.id, choice?.variationId, choice?.addonIds),
      menuItemId: item.id,
      variationId: choice?.variationId ?? null,
      addonIds: choice?.addonIds ?? [],
      options: choice?.label ?? '',
      name: item.name,
      emoji: item.emoji,
      hue: item.hue,
      // A choice carries its own price: the variation, plus the add-ons.
      priceCents: choice?.unitPriceCents ?? item.priceCents,
      quantity: 1,
    }
    setCart((prev) => {
      // A cart belongs to exactly one restaurant — switching starts a fresh cart.
      if (prev.restaurantId && prev.restaurantId !== restaurant.id && prev.lines.length) {
        return { restaurantId: restaurant.id, restaurantName: restaurant.name, lines: [fresh] }
      }
      const lines = [...prev.lines]
      const i = lines.findIndex((l) => l.key === fresh.key)
      if (i >= 0) lines[i] = { ...lines[i], quantity: lines[i].quantity + 1 }
      else lines.push(fresh)
      return { restaurantId: restaurant.id, restaurantName: restaurant.name, lines }
    })
    return outcome
  }, [])

  const setQuantity = useCallback((target: number | string, quantity: number) => {
    setCart((prev) => {
      let lines: CartLine[]
      if (typeof target === 'string') {
        lines = prev.lines.map((l) => (l.key === target ? { ...l, quantity: Math.max(0, quantity) } : l))
      } else {
        // The dish's total, changed from its most recent line backwards.
        const mine = prev.lines.filter((l) => l.menuItemId === target)
        let delta = Math.max(0, quantity) - mine.reduce((n, l) => n + l.quantity, 0)
        lines = [...prev.lines]
        for (let k = lines.length - 1; k >= 0 && delta !== 0; k--) {
          if (lines[k].menuItemId !== target) continue
          const next = Math.max(0, lines[k].quantity + delta)
          delta -= next - lines[k].quantity
          lines[k] = { ...lines[k], quantity: next }
        }
      }
      lines = lines.filter((l) => l.quantity > 0)
      return lines.length ? { ...prev, lines } : EMPTY
    })
  }, [])

  const remove = useCallback((target: number | string) => setQuantity(target, 0), [setQuantity])
  const clear = useCallback(() => setCart(EMPTY), [])

  const value = useMemo<CartValue>(() => {
    const count = cart.lines.reduce((n, l) => n + l.quantity, 0)
    const totalCents = cart.lines.reduce((n, l) => n + l.quantity * l.priceCents, 0)
    return {
      cart,
      count,
      totalCents,
      add,
      setQuantity,
      remove,
      clear,
      quantityOf: (id: number) => cart.lines.filter((l) => l.menuItemId === id).reduce((n, l) => n + l.quantity, 0),
    }
  }, [cart, add, setQuantity, remove, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
