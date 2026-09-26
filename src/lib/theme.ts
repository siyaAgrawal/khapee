import { useCallback, useEffect, useState } from 'react'

/**
 * Light or dark, chosen rather than inherited.
 *
 * This used to be whatever the phone was set to, through a media query, and
 * there was no way to disagree with it — a customer whose phone flips to dark
 * at sunset got a dark menu whether or not they were sitting under a
 * restaurant's lights, and a restaurant running the till on a bright counter
 * got the same. Now it is a choice, it is remembered, and the default for
 * everybody is light.
 *
 * The attribute is written to <html> in index.html before the first paint;
 * this only keeps React in step with it and writes changes back.
 */
export type Theme = 'light' | 'dark'

const KEY = 'khapee.theme'

/** Matches --bg in each theme: the browser's own bar sits directly above it. */
const CHROME: Record<Theme, string> = { light: '#f7f6f3', dark: '#0e0e0d' }

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    // A private window cannot remember, and gets the default, which is fine.
    return 'light'
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.setAttribute('data-theme', 'dark')
    else root.removeAttribute('data-theme')

    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', CHROME[theme])

    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* the page still looks right; it just will not persist */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return { theme, toggle }
}
