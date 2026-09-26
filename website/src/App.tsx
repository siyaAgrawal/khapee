import { useEffect, useState } from 'react'
import { useScroll, useMotionValueEvent } from 'framer-motion'
import { useSmoothScroll } from './lib/scene'
import { Cover } from './scenes/Cover'
import { Journey } from './scenes/Journey'
import { Pickup } from './scenes/Pickup'
import { Demo } from './scenes/Converge'
import { Owners } from './scenes/Owners'
import { Arrival } from './scenes/Arrival'

/**
 * Khapee, as a film you scrub.
 *
 * One story, told once: somebody orders on the way home, the kitchen starts
 * while they travel, and they walk in to food already on the table. Then the
 * other shape it takes — a bag on a shelf with your name on it — the product
 * itself to tap through, and the end.
 *
 * The case to restaurants is deliberately not in that sequence. It is an
 * argument about covers per hour and commission, which is the right argument
 * for somebody who owns a kitchen and the wrong one for somebody who is
 * hungry — and putting it in the middle of the film made every customer sit
 * through a pitch that was never addressed to them. It lives behind its own
 * link now, and the people who want it are exactly the people who click it.
 */
const CHAPTERS = [
  { id: 'cover', label: 'Khapee' },
  { id: 'journey', label: 'The wait' },
  { id: 'pickup', label: 'Takeaway' },
  { id: 'demo', label: 'The app' },
  { id: 'end', label: 'Khapee' },
]

const OWNERS_HASH = '#for-restaurants'

export default function App() {
  useSmoothScroll()

  /*
   * Two views, chosen by the address bar.
   *
   * A hash rather than a router: there is one page here and pulling in
   * react-router to switch between two of them would be more machinery than
   * the thing it manages. It also means the link can be shared, opened cold,
   * and gone back from with the browser's own back button.
   */
  const [owners, setOwners] = useState(
    () => typeof window !== 'undefined' && window.location.hash === OWNERS_HASH,
  )

  useEffect(() => {
    const read = () => {
      const on = window.location.hash === OWNERS_HASH
      setOwners(on)
      // Either view starts at its own beginning; arriving halfway through a
      // film you have not started is disorienting.
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  if (owners) {
    return (
      <>
        <OwnersMasthead />
        <main>
          <Owners />
        </main>
        <div className="grain" aria-hidden />
      </>
    )
  }

  return (
    <>
      <Masthead />
      <main>
        <Cover next="journey" />
        <Journey />
        <Pickup />
        <Demo />
        <Arrival />
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
      style={{
        opacity: gone ? 0 : 1,
        transform: gone ? 'translateY(-12px)' : 'none',
        pointerEvents: gone ? 'none' : 'auto',
      }}
    >
      <Wordmark />
      <span className="flex-1" />
      <a className="cta cta-ghost !py-2 !px-4 !text-[12px]" href={OWNERS_HASH}>
        For restaurants
      </a>
      <a className="cta cta-primary !py-2 !px-4 !text-[12px]" href="https://khapee.com">
        Open Khapee
      </a>
    </header>
  )
}

/** The restaurants view keeps its header, because there is a way back. */
function OwnersMasthead() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 flex items-center gap-3 px-6 py-5">
      <Wordmark />
      <span className="flex-1" />
      <a className="cta cta-ghost !py-2 !px-4 !text-[12px]" href="#">
        Back to the film
      </a>
      <a className="cta cta-primary !py-2 !px-4 !text-[12px]" href="https://khapee.com/for-restaurants">
        Get set up
      </a>
    </header>
  )
}

function Wordmark() {
  return (
    <a href="#" className="flex items-center gap-3 no-underline">
      <span
        className="grid place-items-center w-9 h-9 bg-white text-ink text-[15px]"
        style={{ borderRadius: 3 }}
      >
        ◗
      </span>
      <span className="display text-[22px] tracking-[-0.04em]">Khapee</span>
    </a>
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
          style={{ color: i === at ? '#d9a441' : undefined }}
        >
          <span style={{ opacity: 0.55 }}>{String(i + 1).padStart(2, '0')}</span>
          {i === at ? <b>{c.label}</b> : <span className="hidden xl:inline">{c.label}</span>}
        </a>
      ))}
    </div>
  )
}
