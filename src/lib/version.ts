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
