import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'

export type User = {
  id: number
  name: string
  email: string
  role: 'customer' | 'staff'
  restaurantId: number | null
  restaurantName: string | null
  jobTitle: string | null
}

type SessionValue = {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (name: string, email: string, password: string) => Promise<User>
  logout: () => Promise<void>
  /** Re-reads the session after a token is set outside this provider. */
  refresh: () => Promise<User | null>
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

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
