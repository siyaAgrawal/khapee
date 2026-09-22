import { useEffect, useState } from 'react'

/**
 * Offering to install Khapee, rather than leaving it in a browser menu.
 *
 * Khapee is a website, and on a phone or a billing computer it is better as
 * an app: its own icon, its own window, no address bar, and it can be set to
 * open when the machine starts. Chrome will do all of that — it just never
 * says so unless the page asks.
 *
 * The browser fires `beforeinstallprompt` when a site is installable and then
 * does nothing visible with it. Caught here, it becomes a button. Without one
 * somebody has to be told to open a three-dot menu and find "Install page as
 * app", which is the sort of instruction that gets relayed over the phone to a
 * cafe and quietly never happens.
 */
type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstall() {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    // Already running as an app: there is nothing to offer.
    const standalone =
      (navigator as any).standalone === true ||
      window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
      window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches === true
    if (standalone) {
      setInstalled(true)
      return
    }

    const offer = (e: Event) => {
      // Chrome shows its own bar unless this is cancelled, and its bar is
      // easy to dismiss by accident and never comes back in that session.
      e.preventDefault()
      setEvent(e as InstallEvent)
    }
    const done = () => {
      setInstalled(true)
      setEvent(null)
    }
    window.addEventListener('beforeinstallprompt', offer)
    window.addEventListener('appinstalled', done)
    return () => {
      window.removeEventListener('beforeinstallprompt', offer)
      window.removeEventListener('appinstalled', done)
    }
  }, [])

  /**
   * Safari never fires the event — on an iPhone the only route is Share, then
   * Add to Home Screen — so the offer there is the instructions, not a button.
   */
  const iPhone =
    typeof navigator !== 'undefined' &&
    (/iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

  return {
    /** True when a tap can install it here and now. */
    canInstall: !!event && !installed,
    installed,
    iPhone,
    install: async () => {
      if (!event) return 'unavailable' as const
      await event.prompt()
      const { outcome } = await event.userChoice
      if (outcome === 'accepted') setInstalled(true)
      // Spent either way: a prompt cannot be shown twice.
      setEvent(null)
      return outcome
    },
  }
}
