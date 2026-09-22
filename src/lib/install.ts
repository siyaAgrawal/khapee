import { useEffect, useState } from 'react'

/**
 * Offering to install Khapee, rather than leaving it in a browser menu.
 *
 * Khapee is a website, and on a phone or a billing computer it is better as
 * an app: its own icon, its own window, no address bar, and it can be set to
 * open when the machine starts. Chrome will do all of that — it just never
 * says so unless the page asks.
 */
type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** How this browser can install, when it cannot be done with a button. */
export type InstallRoute = 'button' | 'menu' | 'ios' | 'none' | 'installed'

declare global {
  interface Window {
    __khapeeInstall: InstallEvent | null
  }
}

function standalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (navigator as any).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches === true
  )
}

/** iPhones and iPads, where Safari has no install button for any website. */
function isApple(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/**
 * Whether this is a browser that installs web apps, whatever it has said.
 *
 * Chrome and Edge both do, and both have a menu item for it that works at any
 * time — the automatic offer is a convenience on top, not the mechanism. So
 * their absence of an offer is not an inability, and telling somebody at a
 * till on Windows that "this browser cannot install it" was simply wrong.
 */
function installsApps(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const chromium = /Chrome|Chromium|CriOS|Edg/.test(ua) && !/OPR|SamsungBrowser/.test(ua)
  return chromium && !isApple()
}

export function useInstall() {
  const [event, setEvent] = useState<InstallEvent | null>(
    typeof window === 'undefined' ? null : window.__khapeeInstall,
  )
  const [installed, setInstalled] = useState(standalone)

  useEffect(() => {
    if (standalone()) {
      setInstalled(true)
      return
    }

    /**
     * The offer may already have happened.
     *
     * Chrome fires beforeinstallprompt as soon as it decides a site is
     * installable, which is routinely before React has mounted — and it fires
     * once. index.html catches it into a global and says so with its own
     * event; this reads whichever arrives first.
     */
    const take = () => setEvent(window.__khapeeInstall)
    take()

    const done = () => {
      setInstalled(true)
      setEvent(null)
    }
    window.addEventListener('khapee:installable', take)
    window.addEventListener('beforeinstallprompt', take)
    window.addEventListener('appinstalled', done)
    return () => {
      window.removeEventListener('khapee:installable', take)
      window.removeEventListener('beforeinstallprompt', take)
      window.removeEventListener('appinstalled', done)
    }
  }, [])

  const route: InstallRoute = installed
    ? 'installed'
    : event
      ? 'button'
      : isApple()
        ? 'ios'
        : installsApps()
          ? 'menu'
          : 'none'

  return {
    /** True when a tap can install it here and now. */
    canInstall: route === 'button',
    installed,
    iPhone: isApple(),
    /** What to tell somebody who cannot simply press a button. */
    route,
    install: async () => {
      const e = event ?? window.__khapeeInstall
      if (!e) return 'unavailable' as const
      await e.prompt()
      const { outcome } = await e.userChoice
      if (outcome === 'accepted') setInstalled(true)
      // Spent either way: a prompt cannot be shown twice.
      window.__khapeeInstall = null
      setEvent(null)
      return outcome
    },
  }
}
