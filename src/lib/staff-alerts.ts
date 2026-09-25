import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { currentEndpoint, enablePush, needsHomeScreen, pushSupported, type AlertState } from './push'

/**
 * Order alerts that switch themselves on.
 *
 * Every restaurant on Khapee should be told about an order on the phone in
 * their pocket, with the app shut, without anyone explaining anything. Until
 * now that was a button on the orders screen labelled "Alert me" — which meant
 * a restaurant heard about orders only if somebody had once noticed a small
 * button and pressed it. Most never did, and the failure is silent: the board
 * fills up and nothing rings.
 *
 * So this runs on every dashboard load and does as much as the browser allows
 * without being asked:
 *
 * Permission already granted — subscribe again, silently, every time. That
 * looks redundant and is the most important line here. This server keeps no
 * disk, so the subscriptions table is rebuilt from the published snapshot
 * whenever it restarts or wakes from sleeping, and every device quietly falls
 * off it. The phone still believes it is subscribed, the server has never
 * heard of it, and nobody finds out until a busy Friday. Re-registering on
 * each load repairs that within one page view.
 *
 * Permission not asked for yet — the browser requires a real person to answer
 * a prompt, and that cannot be done for them. What can be done is ask once,
 * plainly, at the top of the screen they just signed in to, instead of hiding
 * it in a button. One tap, once, ever.
 *
 * Permission refused — say so, and stop. A blocked site cannot re-ask; it has
 * to be changed in browser settings, and pretending otherwise wastes taps.
 */
export type AlertStatus =
  /** Ringing. Nothing to do and nothing shown. */
  | 'on'
  /** Supported, never answered. One tap away. */
  | 'ask'
  /** Blocked in the browser; only settings can undo it. */
  | 'blocked'
  /** iPhone in Safari, not installed — Apple allows alerts only to an installed app. */
  | 'install'
  /** No push on this browser at all. */
  | 'unsupported'
  /** Still working it out. Shows nothing, because a flash of a warning is worse. */
  | 'checking'

export function useOrderAlerts() {
  const [status, setStatus] = useState<AlertStatus>('checking')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef('')
  /* React 18 runs effects twice in development; subscribing twice against the
     same push service is harmless but the round trip is not free. */
  const ran = useRef(false)

  const settle = useCallback(async () => {
    if (!pushSupported()) {
      setStatus(needsHomeScreen() ? 'install' : 'unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setStatus('blocked')
      return
    }

    let state: AlertState | null = null
    try {
      state = await api<AlertState>('/staff/alerts')
    } catch {
      /* Signed out, or the server is waking. Either way this is not the
         moment to tell somebody their alerts are broken. */
      setStatus('checking')
      return
    }
    key.current = state?.push?.publicKey ?? ''
    if (!state?.push?.available || !key.current) {
      setStatus('unsupported')
      return
    }

    if (Notification.permission !== 'granted') {
      setStatus('ask')
      return
    }

    /*
     * Granted. Register again anyway — see the note at the top. Silent on
     * purpose: no prompt appears, nothing is shown, and the person who
     * switched this on months ago never learns it needed doing.
     */
    const r = await enablePush(key.current)
    setStatus(r.ok ? 'on' : 'ask')
    if (!r.ok && r.error) setError(r.error)
  }, [])

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void settle()
  }, [settle])

  /**
   * Re-checked when the app comes back to the front.
   *
   * A till is left open for days and a phone sleeps in an apron. Coming back
   * to the foreground is the moment worth re-confirming, both because the
   * server may have restarted since and because somebody may have answered
   * the permission prompt in another tab.
   */
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') void settle()
    }
    document.addEventListener('visibilitychange', wake)
    return () => document.removeEventListener('visibilitychange', wake)
  }, [settle])

  /** The one tap, for the one case the browser will not let us do alone. */
  const turnOn = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const r = await enablePush(key.current)
      if (r.ok) setStatus('on')
      else {
        setError(r.error ?? 'The browser refused.')
        setStatus(Notification.permission === 'denied' ? 'blocked' : 'ask')
      }
    } finally {
      setBusy(false)
    }
  }, [])

  return { status, busy, error, turnOn }
}

/** Whether this device is registered right now, for the settings screen. */
export async function alertsLive(): Promise<boolean> {
  return !!(await currentEndpoint())
}
