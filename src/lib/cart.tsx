import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type CartLine = {
  menuItemId: number
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
const EMPTY: CartState = { restaurantId: null, restaurantName: '', lines: [] }

function load(): CartState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.lines)) return EMPTY
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
  ) => 'added' | 'switched'
  setQuantity: (menuItemId: number, quantity: number) => void
  remove: (menuItemId: number) => void
  clear: () => void
  quantityOf: (menuItemId: number) => number
}

const CartContext = createContext<CartValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cart))
    } catch {
      /* ignore quota / private mode */
    }
  }, [cart])

  const add: CartValue['add'] = useCallback((restaurant, item) => {
    let outcome: 'added' | 'switched' = 'added'
    setCart((prev) => {
      // A cart belongs to exactly one restaurant — switching starts a fresh cart.
      if (prev.restaurantId && prev.restaurantId !== restaurant.id && prev.lines.length) {
        outcome = 'switched'
        return {
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          lines: [{ menuItemId: item.id, name: item.name, emoji: item.emoji, hue: item.hue, priceCents: item.priceCents, quantity: 1 }],
        }
      }
      const lines = [...prev.lines]
      const i = lines.findIndex((l) => l.menuItemId === item.id)
      if (i >= 0) lines[i] = { ...lines[i], quantity: lines[i].quantity + 1 }
      else
        lines.push({
          menuItemId: item.id,
          name: item.name,
          emoji: item.emoji,
          hue: item.hue,
          priceCents: item.priceCents,
          quantity: 1,
        })
      return { restaurantId: restaurant.id, restaurantName: restaurant.name, lines }
    })
    return outcome
  }, [])

  const setQuantity = useCallback((menuItemId: number, quantity: number) => {
    setCart((prev) => {
      const lines = prev.lines
        .map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: Math.max(0, quantity) } : l))
        .filter((l) => l.quantity > 0)
      return lines.length ? { ...prev, lines } : EMPTY
    })
  }, [])

  const remove = useCallback((menuItemId: number) => setQuantity(menuItemId, 0), [setQuantity])
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
      quantityOf: (id: number) => cart.lines.find((l) => l.menuItemId === id)?.quantity ?? 0,
    }
  }, [cart, add, setQuantity, remove, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
