const KEY = 'tablo.group'

export type GroupHandle = { token: string; code: string; restaurantId: number }

/** The membership token for the group session on this device. */
export function saveGroup(handle: GroupHandle) {
  try {
    localStorage.setItem(KEY, JSON.stringify(handle))
  } catch {
    /* ignore */
  }
}

export function readGroup(): GroupHandle | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as GroupHandle) : null
  } catch {
    return null
  }
}

export function clearGroup() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
