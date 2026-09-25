import { useEffect, useState } from 'react'

/**
 * A way to look at the options rather than read them.
 *
 * Colour cannot be judged from a hex code or a swatch on a white page — it has
 * to be seen at the size and against the things it will actually sit next to.
 * So each palette is applied to the whole site, artwork included, and the
 * choice is made by looking.
 *
 * Temporary. Once a palette is chosen this component and its styles come out
 * and the winner becomes the only :root in the stylesheet.
 */
export const PALETTES = [
  { id: 'aubergine', name: 'Aubergine & Gold — as it is', dot: '#271640', ring: '#d9a441' },
  { id: 'pistachio', name: 'Aubergine, Honey & Pistachio', dot: '#2e1842', ring: '#a8c66c' },
  { id: 'blackcurrant', name: 'Violet, Acid & Ice', dot: '#6604b8', ring: '#e9e04f' },
  { id: 'mulberry', name: 'Mulberry & Apricot', dot: '#38142a', ring: '#f0a95c' },
] as const

const KEY = 'khapee.palette'

export function Palette() {
  const [on, setOn] = useState<string>(() => localStorage.getItem(KEY) ?? 'blackcurrant')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', on)
    try {
      localStorage.setItem(KEY, on)
    } catch {
      /* a private window can refuse this; the theme still applies */
    }
  }, [on])

  return (
    <div className="swatches" role="group" aria-label="Colour">
      {PALETTES.map((p) => (
        <button
          key={p.id}
          className="swatch"
          aria-pressed={on === p.id}
          title={p.name}
          onClick={() => setOn(p.id)}
          style={{ background: p.dot, boxShadow: `inset 0 0 0 3px ${p.ring}` }}
        />
      ))}
    </div>
  )
}
