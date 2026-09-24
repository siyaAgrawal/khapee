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
  { id: 'aubergine', name: 'Aubergine & Gold', dot: '#271640', ring: '#d9a441' },
  { id: 'chartreuse', name: 'Ink & Chartreuse', dot: '#0b0e13', ring: '#cdfa4a' },
  { id: 'oxblood', name: 'Oxblood & Brass', dot: '#33161a', ring: '#d6a756' },
  { id: 'forest', name: 'Forest & Butter', dot: '#132a21', ring: '#f0cd7c' },
  { id: 'cobalt', name: 'Cobalt & Saffron', dot: '#101d4a', ring: '#f6a723' },
] as const

const KEY = 'khapee.palette'

export function Palette() {
  const [on, setOn] = useState<string>(() => localStorage.getItem(KEY) ?? 'aubergine')

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
