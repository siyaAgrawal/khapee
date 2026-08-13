const KEY = 'tablo.dining'

export type DiningSession = {
  token: string
  restaurantId: number
  restaurantName: string
  restaurantEmoji: string
  tableId: number | null
  tableLabel: string | null
  source: 'code' | 'table_qr' | 'payment'
  active: boolean
  secondsLeft: number
}

/** The open "I'm here" session, kept for the length of the meal. */
export function saveDining(session: DiningSession) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    /* ignore */
  }
}

export function readDining(restaurantId?: number): DiningSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as DiningSession
    if (restaurantId && s.restaurantId !== restaurantId) return null
    return s
  } catch {
    return null
  }
}

export function clearDining() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
