import { useEffect, useState } from 'react'

/**
 * The opening card, in the front page's look: the wordmark on jamun, its haldi
 * dot dropping in, then the whole sheet tearing away upward along the same
 * ticket edge the top of the front page has. About a second, nothing floating
 * about, and a tap anywhere lifts it at once. Anyone who prefers reduced
 * motion is taken straight through.
 */
export default function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      onDone()
      return
    }
    const lift = setTimeout(() => setLeaving(true), 1050)
    const done = setTimeout(onDone, 1550)
    return () => {
      clearTimeout(lift)
      clearTimeout(done)
    }
  }, [onDone])

  return (
    <div
      className={`ksplash ${leaving ? 'is-leaving' : ''}`}
      onClick={() => {
        setLeaving(true)
        setTimeout(onDone, 450)
      }}
      role="presentation"
    >
      <div className="ksplash-core">
        <h1 className="ksplash-word" aria-label="khapee">
          {'khapee'.split('').map((c, i) => (
            <span key={i} style={{ '--c': i } as React.CSSProperties}>
              {c}
            </span>
          ))}
          <i className="ksplash-dot" aria-hidden />
        </h1>
        <p className="ksplash-tag">kuch khapee lo.</p>
      </div>
    </div>
  )
}
