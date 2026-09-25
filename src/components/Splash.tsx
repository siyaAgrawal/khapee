import { useEffect, useState } from 'react'

const DOODLES = ['🍜', '🍕', '🥐', '🍣', '🥗', '☕']

/**
 * The opening title sequence. Plays once per page load, covering the app until
 * it lifts away. Tapping skips it, and anyone who prefers reduced motion is
 * taken straight through.
 */
export default function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      onDone()
      return
    }
    const lift = setTimeout(() => setLeaving(true), 1900)
    const done = setTimeout(onDone, 2650)
    return () => {
      clearTimeout(lift)
      clearTimeout(done)
    }
  }, [onDone])

  return (
    <div
      className={`splash ${leaving ? 'is-leaving' : ''}`}
      onClick={() => setLeaving(true)}
      role="presentation"
    >
      <div className="splash-field" aria-hidden>
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} className="splash-doodle" style={{ '--i': i } as React.CSSProperties}>
            {DOODLES[i % DOODLES.length]}
          </span>
        ))}
      </div>

      <div className="splash-core">
        {/* The word is the logo, so the title card is the word — there is no
            separate mark to snap in ahead of it any more. */}
        <h1 className="splash-word" aria-label="khapee">
          {'khapee'.split('').map((c, i) => (
            <span key={i} style={{ '--c': i } as React.CSSProperties}>
              {c}
            </span>
          ))}
          {/* The logo's full stop, arriving last and in gold. */}
          <span className="splash-dot-mark" style={{ '--c': 6 } as React.CSSProperties}>
            .
          </span>
        </h1>
        <p className="splash-tag">Your table is already ordering</p>
      </div>

      <span className="splash-skip">tap to skip</span>
    </div>
  )
}
