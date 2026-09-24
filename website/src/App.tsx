import { useEffect, useState } from 'react'
import { useScroll, useMotionValueEvent } from 'framer-motion'
import { useSmoothScroll } from './lib/scene'
import { Drive } from './scenes/Drive'
import { School } from './scenes/School'
import { Work } from './scenes/Work'
import { Takeaway } from './scenes/Takeaway'
import { Converge, Demo } from './scenes/Converge'
import { Owners } from './scenes/Owners'
import { Finale } from './scenes/Finale'

/**
 * Khapee, as a film you scrub.
 *
 * Five scenes, each a pinned stage driven by its own slice of the scroll, and
 * between them nothing at all — no section headings, no feature grid, no
 * explanation. The argument is the same one four times over from four
 * different lives, because "your food is ready when you get there" is a thing
 * people believe when they have watched it happen, not when they have read it.
 */
const CHAPTERS = [
  { id: 'drive', label: 'The drive' },
  { id: 'school', label: 'After school' },
  { id: 'work', label: 'After work' },
  { id: 'takeaway', label: 'Takeaway' },
  { id: 'idea', label: 'The idea' },
  { id: 'owners', label: 'For restaurants' },
  { id: 'demo', label: 'The app' },
  { id: 'end', label: 'Khapee' },
]

export default function App() {
  useSmoothScroll()
  return (
    <>
      <Masthead />
      <main>
        <Drive />
        <School />
        <Work />
        <Takeaway />
        <Converge />
        <Owners />
        <Demo />
        <Finale />
      </main>
      <Ledger />
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
      style={{ opacity: gone ? 0 : 1, transform: gone ? 'translateY(-12px)' : 'none', pointerEvents: gone ? 'none' : 'auto' }}
    >
      <span className="grid place-items-center w-9 h-9 bg-white text-ink text-[15px]" style={{ borderRadius: 3 }}>
        ◗
      </span>
      <span className="display text-[22px] tracking-[-0.04em]">Khapee</span>
      <span className="flex-1" />
      <a className="cta cta-ghost !py-2 !px-4 !text-[12px]" href="https://khapee.com">Open Khapee</a>
    </header>
  )
}

/**
 * Where you are in the story.
 *
 * A film that is scrolled has no scrubber of its own, and without one there is
 * no way to tell whether this is the whole thing or the first of twenty. It
 * names the chapter rather than showing a percentage, because the useful
 * question is "what am I watching", not "how far through am I".
 */
function Ledger() {
  const { scrollYProgress } = useScroll()
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

  useMotionValueEvent(scrollYProgress, 'change', () => {})

  return (
    <div className="ledger">
      {CHAPTERS.map((c, i) => (
        <a
          key={c.id}
          href={`#${c.id}`}
          className="transition-colors flex items-center gap-1.5"
          style={{ color: i === at ? '#d9a441' : undefined }}
        >
          <span style={{ opacity: 0.55 }}>{String(i + 1).padStart(2, '0')}</span>
          {i === at ? <b>{c.label}</b> : <span className="hidden xl:inline">{c.label}</span>}
        </a>
      ))}
    </div>
  )
}
