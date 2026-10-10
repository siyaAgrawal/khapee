import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'

export type StaffedRestaurant = { id: number; name: string; emoji: string; jobTitle: string }

export type User = {
  id: number
  name: string
  email: string
  phone: string
  memberSince: string
  role: 'customer' | 'staff'
  /** Restaurants this account runs — empty means customer only. */
  restaurants: StaffedRestaurant[]
  restaurantId: number | null
  restaurantName: string | null
  jobTitle: string | null
  /** An email Google has confirmed this person owns, or ''. */
  verifiedEmail?: string
}

type SessionValue = {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (name: string, email: string, password: string) => Promise<User>
  logout: () => Promise<void>
  /** Re-reads the session after a token is set outside this provider. */
  refresh: () => Promise<User | null>
  /** Takes a session made elsewhere — "Continue with Google". */
  adopt: (token: string, user: User) => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!getToken()) {
      setLoading(false)
      return
    }
    api<{ user: User }>('/auth/me')
      .then((r) => !cancelled && setUser(r.user))
      .catch(() => {
        setToken(null)
        if (!cancelled) setUser(null)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } })
    setToken(r.token)
    setUser(r.user)
    return r.user
  }, [])

  const register = useCallback(async (name: string, email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/register', { body: { name, email, password } })
    setToken(r.token)
    setUser(r.user)
    return r.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      /* the local session is cleared regardless */
    }
    setToken(null)
    setUser(null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: User }>('/auth/me')
      setUser(r.user)
      return r.user
    } catch {
      setUser(null)
      return null
    }
  }, [])

  const adopt = useCallback((token: string, next: User) => {
    setToken(token)
    setUser(next)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh, adopt }),
    [user, loading, login, register, logout, refresh, adopt],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
