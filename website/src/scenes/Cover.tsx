import { motion, useTransform } from 'framer-motion'
import { useLoop, useScene } from '../lib/scene'
import { Section } from '../components/Scene'
import { PhoneFilm, usePhoneStep } from '../components/Phone'

/**
 * The cover.
 *
 * The clock and the phone, side by side, exactly as they were in the takeaway
 * scene — which is where this pairing was invented and where it worked. A
 * proper clock face with hour and minute hands sitting still and a second hand
 * that will not, next to a screen showing an order being placed. Two things
 * about time, and one of them is losing.
 *
 * The second hand runs on its own rather than on the scroll, because a first
 * screen that only moves once you touch it looks broken — and because the
 * argument is about time passing whether you are watching or not.
 */
export function Cover({ next }: { next: string }) {
  const { ref, t, lengthVh } = useScene(150)
  const loop = useLoop(1)

  /* The second hand that will not stop, which is the feeling being drawn. */
  const hand = useTransform(loop, (v) => v * 340)

  /* A couple of steps of the order, so the screen is doing something too. */
  const phone = usePhoneStep(t, [
    [0, 'location'],
    [0.22, 'nearby'],
    [0.42, 'menu'],
    [0.62, 'cart'],
  ])

  /* The cover leaves by fading rather than scrolling away, so the first scene
     is already underneath it when it goes. */
  const out = useTransform(t, [0.62, 0.95], [1, 0])
  const hint = useTransform(t, [0, 0.14], [1, 0])

  const go = () => {
    const el = document.getElementById(next)
    if (el) window.scrollTo({ top: el.offsetTop + 8, behavior: 'smooth' })
  }

  return (
    <Section id="cover" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />

      <motion.div
        className="absolute inset-0 grid items-center gap-[3vw] px-[6vw] pt-[11vh] pb-[16vh] lg:grid-cols-[1fr_auto]"
        style={{ opacity: out }}
      >
        <div>
          <span className="chip mb-6 block">Indore</span>
          <h1 className="display" style={{ fontSize: 'clamp(26px, min(4.8vw, 7.4vh), 76px)' }}>
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

        {/* the clock and the phone, as a pair */}
        <div className="flex items-center gap-[4vw] justify-self-center">
          <svg viewBox="0 0 220 220" className="w-[20vw] min-w-[130px] max-w-[250px] h-auto" aria-hidden>
            <circle cx="110" cy="110" r="88" fill="#211539" />
            <circle cx="110" cy="110" r="88" fill="none" stroke="#452c68" strokeWidth="3" />
            {Array.from({ length: 12 }).map((_, i) => (
              <rect
                key={i}
                x="108" y="30" width="4" height="13" rx="2" fill="#5c3d84"
                transform={`rotate(${i * 30} 110 110)`}
              />
            ))}
            <line x1="110" y1="110" x2="110" y2="58" stroke="#f4ede1" strokeWidth="5" strokeLinecap="round" />
            <line x1="110" y1="110" x2="146" y2="128" stroke="#f4ede1" strokeWidth="5" strokeLinecap="round" />
            <motion.line
              x1="110" y1="110" x2="110" y2="44"
              stroke="#b9563c" strokeWidth="2.4" strokeLinecap="round"
              style={{ rotate: hand, originX: '110px', originY: '110px' }}
            />
            <circle cx="110" cy="110" r="5" fill="#f4ede1" />
          </svg>

          <div className="hidden sm:block">
            <PhoneFilm step={phone} scale={0.9} />
          </div>
        </div>
      </motion.div>

      {/*
        Somewhere to start, for both kinds of person.

        A page that only answers to scrolling leaves anybody who has not
        realised it is a film staring at a still picture. This says what to do,
        moves so it is noticed, and is a button as well — so it works for
        somebody who scrolls and somebody who clicks.
      */}
      <motion.button
        onClick={go}
        className="absolute inset-x-0 bottom-[9vh] z-30 flex flex-col items-center gap-3"
        style={{ opacity: hint }}
        aria-label="Start"
      >
        <span className="kicker" style={{ color: 'var(--dust)' }}>
          Scroll, or tap
        </span>
        <span
          className="relative block w-px h-12 overflow-hidden"
          style={{ background: 'rgba(244,237,225,0.18)' }}
        >
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
