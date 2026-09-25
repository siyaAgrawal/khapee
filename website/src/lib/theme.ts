import { useCallback, useEffect, useState } from 'react'

/**
 * Which time of day the film is playing in.
 *
 * Light is the default, and the system preference is deliberately not read.
 * A shop front opens in daylight: somebody arriving from a search result on a
 * phone that happens to be in dark mode should still get the bright version,
 * because that is the version the brand is drawn for. Dark is a choice, and
 * once it is made it is remembered.
 *
 * The attribute is set in index.html before the first paint — this hook only
 * keeps React in step with it and writes the changes back.
 */
export type Theme = 'light' | 'dark'

const KEY = 'khapee.theme'

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    // A private window cannot remember; it gets the default, which is fine.
    return 'light'
  }
}

/** The phone's own chrome sits directly above the page and should match it. */
function paintBrowserChrome(theme: Theme) {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c0716' : '#ffffff')
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.setAttribute('data-theme', 'dark')
    else root.removeAttribute('data-theme')
    paintBrowserChrome(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* nothing to do: the page still looks right, it just will not persist */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return { theme, toggle }
}
