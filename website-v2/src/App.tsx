import { useEffect, useState } from 'react'
import { useScroll, useMotionValueEvent } from 'framer-motion'
import { useSmoothScroll } from './lib/scene'
import { Cover } from './scenes/Cover'
import { Journey } from './scenes/Journey'
import { Arrival } from './scenes/Arrival'
import { Advantages, Close } from './scenes/Advantages'
import { Palette } from './components/Palette'

/**
 * Khapee, in three sections and no more.
 *
 * One: the film. Somebody orders on the way home, the kitchen starts while
 * they travel, and they walk in to food already waiting. Two: what that is
 * worth to a restaurant, in three numbers. Three: the two things a visitor
 * might want to do.
 *
 * Everything else that was here — a takeaway scene, an interactive phone, a
 * finale with a logo the size of a poster — has gone. Each was defensible on
 * its own and together they were a page nobody reached the end of. The less
 * there is, the more of it gets read.
 */
const CHAPTERS = [
  { id: 'cover', label: 'Khapee' },
  { id: 'journey', label: 'The wait' },
  { id: 'end', label: 'Already ready' },
  { id: 'restaurants', label: 'For restaurants' },
  { id: 'start', label: 'Start' },
]

export default function App() {
  useSmoothScroll()
  return (
    <>
      <Masthead />
      <main>
        <Cover next="journey" />
        <Journey />
        <Arrival />
        <Advantages />
        <Close />
      </main>
      <Ledger />
      <Palette />
      <div className="grain" aria-hidden />
    </>
  )
}

/**
 * The only furniture on the page, and it gets out of the way.
 *
 * A fixed header over a film is a bar across the picture. It is there at the
 * start, when somebody needs to know whose site this is, and it leaves as soon
 * as the first scene starts playing.
 */
function Masthead() {
  const { scrollY } = useScroll()
  const [gone, setGone] = useState(false)
  useMotionValueEvent(scrollY, 'change', (v) => setGone(v > 240))

  return (
    <header
      className="fixed top-0 inset-x-0 z-50 flex items-center gap-3 px-6 py-5 transition-all duration-500"
      style={{
        opacity: gone ? 0 : 1,
        transform: gone ? 'translateY(-12px)' : 'none',
        pointerEvents: gone ? 'none' : 'auto',
      }}
    >
      <a href="#" className="flex items-center gap-3 no-underline">
        <span
          className="grid place-items-center w-9 h-9 bg-white text-ink text-[15px]"
          style={{ borderRadius: 3 }}
        >
          ◗
        </span>
        <span className="display text-[22px] tracking-[-0.04em]">Khapee</span>
      </a>
      <span className="flex-1" />
      <a className="cta cta-primary !py-2 !px-4 !text-[12px]" href="https://khapee.com">
        Open Khapee
      </a>
    </header>
  )
}

/**
 * Where you are in the story.
 *
 * A film that is scrolled has no scrubber of its own, and without one there is
 * no way to tell whether this is the whole thing or the first of twenty.
 */
function Ledger() {
  const [at, setAt] = useState(0)

  useEffect(() => {
    const spot = () => {
      const mid = window.innerHeight / 2
      let best = 0
      CHAPTERS.forEach((c, i) => {
        const el = document.getElementById(c.id)
        if (el && el.getBoundingClientRect().top <= mid) best = i
      })
      setAt(best)
    }
    spot()
    window.addEventListener('scroll', spot, { passive: true })
    return () => window.removeEventListener('scroll', spot)
  }, [])

  return (
    <div className="ledger">
      {CHAPTERS.map((c, i) => (
        <a
          key={c.id}
          href={`#${c.id}`}
          className="transition-colors flex items-center gap-1.5"
          style={{ color: i === at ? 'var(--accent)' : undefined }}
        >
          <span style={{ opacity: 0.55 }}>{String(i + 1).padStart(2, '0')}</span>
          {i === at ? <b>{c.label}</b> : <span className="hidden xl:inline">{c.label}</span>}
        </a>
      ))}
    </div>
  )
}
