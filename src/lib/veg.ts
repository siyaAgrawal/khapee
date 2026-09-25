import { useSyncExternalStore } from 'react'

const KEY = 'khapee.veg'

/**
 * Veg mode is a preference, not a filter you re-apply on every screen: turn it
 * on once and the whole app — the list, the menus, the search — only shows
 * vegetarian food until you turn it off.
 */
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let current = read()

export function setVegMode(on: boolean) {
  current = on
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* a private-mode browser still gets the preference for this tab */
  }
  listeners.forEach((fn) => fn())
}

export function useVegMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
    () => false,
  )
  return [on, setVegMode]
}

/** Appends veg=1 to an API path when the preference is on. */
export function vegQuery(path: string): string {
  if (!current) return path
  return path + (path.includes('?') ? '&' : '?') + 'veg=1'
}
