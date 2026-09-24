import { motion, useTransform } from 'framer-motion'
import { useLoop, useScene } from '../lib/scene'
import { Section } from '../components/Scene'

/**
 * The cover.
 *
 * One clock and one question. The clock runs on its own rather than on the
 * scroll, because this is the first thing anybody sees and a picture that
 * only moves once you touch it looks broken — and because the whole argument
 * is about time passing whether you are watching it or not.
 *
 * The hand sweeps a full hour in eight seconds. Slow enough to read as a clock
 * rather than a spinner, fast enough that you can see it move while you are
 * still deciding whether to scroll.
 */
export function Cover({ next }: { next: string }) {
  const { ref, t, lengthVh } = useScene(180)
  const loop = useLoop(1)

  /* The hand, going round regardless of you. */
  const hand = useTransform(loop, (v) => (v * 45) % 360)
  /* And the minute mark it drags behind it, a quarter of the way back. */
  const trail = useTransform(loop, (v) => (v * 45) % 360 - 26)

  /* The cover leaves as the story starts — it does not scroll away, it fades,
     so the first scene is already there underneath it. */
  const out = useTransform(t, [0, 0.55], [1, 0])
  const lift = useTransform(t, [0, 1], [0, -70])
  const hint = useTransform(t, [0, 0.18], [1, 0])

  const go = () => {
    const el = document.getElementById(next)
    if (el) window.scrollTo({ top: el.offsetTop + 8, behavior: 'smooth' })
  }

  return (
    <Section id="cover" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />

      <motion.div
        className="absolute inset-0 grid items-center gap-[4vw] px-[7vw] pt-[12vh] pb-[16vh] sm:grid-cols-[1.05fr_auto]"
        style={{ opacity: out, y: lift }}
      >
        <div>
          <span className="chip mb-6 block">Indore</span>
          <h1 className="display" style={{ fontSize: 'clamp(28px, min(5.4vw, 8vh), 82px)' }}>
            Why wait for
            <br />
            your food when
            <br />
            your food{' '}
            <span className="text-gold">
              can
              <br />
              wait for you?
            </span>
          </h1>
        </div>

        {/* the clock */}
        <div className="justify-self-center">
          <svg viewBox="0 0 240 240" className="w-[38vw] max-w-[320px] min-w-[170px] h-auto" aria-hidden>
            <circle cx="120" cy="120" r="108" fill="none" stroke="rgba(244,237,225,0.1)" strokeWidth="2" />
            <circle cx="120" cy="120" r="94" fill="rgba(244,237,225,0.03)" />
            {/* the hours, twelve of them, the four cardinals heavier */}
            {Array.from({ length: 12 }).map((_, i) => (
              <rect
                key={i}
                x="118.5" y={i % 3 === 0 ? 20 : 24} width="3" height={i % 3 === 0 ? 18 : 11} rx="1.5"
                fill="#f4ede1" opacity={i % 3 === 0 ? 0.55 : 0.22}
                transform={`rotate(${i * 30} 120 120)`}
              />
            ))}
            {/* the sweep it leaves behind */}
            <motion.path
              d="M120 120 L120 34 A86 86 0 0 1 180 60 Z"
              fill="#d9a441" opacity={0.1}
              style={{ rotate: trail, originX: '120px', originY: '120px' }}
            />
            <motion.g style={{ rotate: hand, originX: '120px', originY: '120px' }}>
              <rect x="117" y="38" width="6" height="86" rx="3" fill="#d9a441" />
              <circle cx="120" cy="38" r="5" fill="#d9a441" />
            </motion.g>
            <circle cx="120" cy="120" r="7" fill="#f4ede1" />
            <circle cx="120" cy="120" r="3" fill="#271640" />
          </svg>
        </div>
      </motion.div>

      {/*
        Somewhere to start, for both kinds of person.

        A page that only responds to scrolling leaves anybody who has not
        realised it is a film staring at a still picture. This says what to do,
        moves so it is noticed, and is a button as well — so it works for
        somebody who scrolls and somebody who clicks.
      */}
      <motion.button
        onClick={go}
        className="absolute inset-x-0 bottom-[11vh] z-30 flex flex-col items-center gap-3 group"
        style={{ opacity: hint }}
        aria-label="Start"
      >
        <span className="kicker" style={{ color: 'var(--dust)' }}>
          Scroll, or tap
        </span>
        <span className="relative block w-px h-12 overflow-hidden" style={{ background: 'rgba(244,237,225,0.18)' }}>
          <motion.span
            className="absolute inset-x-0 block"
            style={{ height: 22, background: 'var(--gold)' }}
            animate={{ y: [-24, 50] }}
            transition={{ duration: 1.9, repeat: Infinity, ease: [0.4, 0, 0.3, 1] }}
          />
        </span>
      </motion.button>
    </Section>
  )
}
