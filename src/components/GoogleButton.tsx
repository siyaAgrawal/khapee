import { useEffect, useRef, useState } from 'react'
import { api, type ApiError } from '../lib/api'
import { useSession, type User } from '../lib/session'

/**
 * "Continue with Google" — Google's own button, from Google's own script.
 *
 * The person signs in on Google's page; Khapee gets a token saying which
 * account it was and checks it on the server (routes/auth.ts). Used where an
 * email has to be real, like a coupon for one college's addresses.
 *
 * Renders nothing until Google sign-in is switched on (GOOGLE_CLIENT_ID).
 */
declare global {
  interface Window {
    google?: any
  }
}

let script: Promise<void> | null = null
function loadGoogle(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Google sign-in could not load'))
    document.head.appendChild(s)
  })
  return script
}

export default function GoogleButton({
  hint,
  onSignedIn,
  onError,
}: {
  /** The domain to suggest in Google's account picker, e.g. dalycollege.org. */
  hint?: string
  onSignedIn?: (user: User) => void
  onError?: (message: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const { adopt } = useSession()
  const [clientId, setClientId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    api<{ clientId: string | null }>('/auth/google-config')
      .then((r) => setClientId(r.clientId))
      .catch(() => setClientId(null))
  }, [])

  useEffect(() => {
    if (!clientId || !host.current) return
    let gone = false
    loadGoogle()
      .then(() => {
        if (gone || !host.current) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          ...(hint ? { hd: hint } : {}),
          callback: async (resp: { credential: string }) => {
            try {
              const r = await api<{ token: string; user: User }>('/auth/google', { body: { credential: resp.credential } })
              adopt(r.token, r.user)
              onSignedIn?.(r.user)
            } catch (e) {
              onError?.((e as ApiError).message ?? 'Google sign-in failed.')
            }
          },
        })
        window.google.accounts.id.renderButton(host.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 260,
        })
      })
      .catch(() => onError?.('Google sign-in could not load. Check your connection.'))
    return () => {
      gone = true
    }
  }, [clientId, hint]) // eslint-disable-line react-hooks/exhaustive-deps

  if (clientId === null) return <p className="tiny muted">Google sign-in is coming soon.</p>
  return <div ref={host} className="google-button" />
}
