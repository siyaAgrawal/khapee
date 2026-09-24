import { useState } from 'react'
import { motion, useMotionValueEvent, type MotionValue } from 'framer-motion'

/**
 * The beats of a scene, as something you can see and jump to.
 *
 * The complaint this exists to answer was that everything arrived at once and
 * no single thing could be watched. Two causes, and this is the second half of
 * the fix — the first is simply giving each scene far more scroll to happen
 * over.
 *
 * A film that is scrubbed by scrolling has no transport controls, so there is
 * no way to know how many moments a scene has, which one you are in, or how to
 * go back to the one you missed. These are those controls: one dot per beat,
 * the current one filled, and clicking any of them scrolls to exactly where
 * that beat begins.
 *
 * Deliberately on the right edge and small. It is a scrubber, not a menu.
 */
export type Beat = { at: number; label: string }

export function Beats({
  sceneRef,
  t,
  marks,
}: {
  sceneRef: React.RefObject<HTMLElement>
  t: MotionValue<number>
  marks: Beat[]
}) {
  const [now, setNow] = useState(0)
  const [showing, setShowing] = useState(false)

  useMotionValueEvent(t, 'change', (v) => {
    let i = 0
    marks.forEach((m, n) => {
      if (v >= m.at) i = n
    })
    setNow(i)
    // Only while the scene is actually pinned; otherwise two scenes' scrubbers
    // would be on screen at the same time, which is the confusion again.
    setShowing(v > 0.001 && v < 0.999)
  })

  const goTo = (at: number) => {
    const el = sceneRef.current
    if (!el) return
    const top = el.offsetTop
    const runway = el.offsetHeight - window.innerHeight
    window.scrollTo({ top: top + runway * at + 2, behavior: 'smooth' })
  }

  return (
    <motion.div
      className="fixed right-4 sm:right-7 top-1/2 -translate-y-1/2 z-40 flex flex-col items-end gap-3"
      animate={{ opacity: showing ? 1 : 0, x: showing ? 0 : 8 }}
      transition={{ duration: 0.35 }}
      style={{ pointerEvents: showing ? 'auto' : 'none' }}
    >
      {marks.map((m, i) => (
        <button
          key={m.label}
          onClick={() => goTo(m.at)}
          className="group flex items-center gap-2.5"
          aria-label={m.label}
        >
          <span
            className="text-[10px] tracking-[0.18em] uppercase transition-opacity duration-200"
            style={{
              opacity: i === now ? 0.9 : 0,
              color: 'var(--cream)',
            }}
          >
            {m.label}
          </span>
          <span
            className="block rounded-full transition-all duration-300"
            style={{
              width: i === now ? 9 : 5,
              height: i === now ? 9 : 5,
              background: i === now ? 'var(--gold)' : 'rgba(244,237,225,0.34)',
            }}
          />
        </button>
      ))}
    </motion.div>
  )
}
