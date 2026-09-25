import { useEffect, useState } from 'react'

/**
 * Noticing that the app on this machine is out of date.
 *
 * A browser tab picks up a new build the next time it loads a page, which is
 * often. An installed app on a till does not: it is opened once, never
 * closed, and never navigates — so it goes on running the JavaScript it
 * started with for days. Everything shipped in the meantime is invisible to
 * it, and the faults it reports come from code that no longer exists, which
 * is a very expensive way to debug.
 *
 * The service worker was supposed to handle this and cannot on its own. It
 * updates the worker, not the page: the running document keeps its own
 * scripts until something reloads it, and nothing was going to.
 *
 * So the app asks. The build's asset name is a content hash — it changes
 * exactly when the code does — and the page knows its own from the script it
 * was loaded with. Different means out of date.
 */

/** The build this page is running, taken from its own script tag. */
function runningBuild(): string {
  if (typeof document === 'undefined') return ''
  const src = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src ?? ''
  return src.split('/').pop() ?? ''
}

/** Every ten minutes, and whenever somebody comes back to the window. */
const EVERY = 10 * 60 * 1000

export function useNewVersion(): { stale: boolean; reload: () => void } {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    const mine = runningBuild()
    // Nothing to compare against in development, where there is no hashed
    // bundle — and no staleness either, since Vite reloads on every change.
    if (!mine) return

    let stopped = false
    const check = async () => {
      if (stopped || stale) return
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const { build } = (await r.json()) as { build?: string }
        if (build && build !== mine) setStale(true)
      } catch {
        // Offline, or the server is waking up. Neither means out of date.
      }
    }

    void check()
    const timer = setInterval(check, EVERY)
    const onWake = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [stale])

  return {
    stale,
    /**
     * Clears the worker's cached assets first.
     *
     * A plain reload can be served the old bundle again by the service
     * worker, which caches anything under /assets — and a reload that
     * changes nothing is worse than no button, because it teaches somebody
     * the button does not work.
     */
    reload: () => {
      const done = () => window.location.reload()
      if (!('caches' in window)) return done()
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {})
        .finally(done)
    },
  }
}

/**
 * Picking the new build up without anybody being asked to.
 *
 * The banner was the whole answer and it was the wrong one: the machine this
 * matters most on is a till nobody is looking at, left open behind a counter
 * for days, and a message asking somebody to press Reload is a message nobody
 * presses. Restaurants were running week-old code and being told about it by
 * a bar they had stopped seeing.
 *
 * So it reloads itself, on two rules that between them never interrupt work:
 *
 * Nobody is looking — the tab is in the background, or the screen is off.
 * Reload immediately; there is nothing to lose and nothing to interrupt.
 *
 * Somebody is looking — wait until they have not touched anything for a
 * while, and never while a box has focus. Reloading under somebody's hands is
 * how a half-typed order disappears, which is a far worse bug than an old
 * build. The banner stays for the person who would rather not wait.
 */
const IDLE_BEFORE_RELOAD = 25_000

export function useAutoReload(stale: boolean, reload: () => void) {
  useEffect(() => {
    if (!stale) return
    let done = false
    const go = () => {
      if (done) return
      // Never out from under a keyboard. A focused field means somebody is
      // mid-sentence, whatever the idle timer thinks.
      const el = document.activeElement as HTMLElement | null
      const typing =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) return
      done = true
      reload()
    }

    let idle = setTimeout(go, IDLE_BEFORE_RELOAD)
    const stir = () => {
      clearTimeout(idle)
      idle = setTimeout(go, IDLE_BEFORE_RELOAD)
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') go()
    }

    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, stir, { passive: true }))
    document.addEventListener('visibilitychange', hidden)
    // A tab that is already in the background when the new build lands.
    if (document.visibilityState === 'hidden') go()

    return () => {
      clearTimeout(idle)
      events.forEach((e) => window.removeEventListener(e, stir))
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [stale, reload])
}
