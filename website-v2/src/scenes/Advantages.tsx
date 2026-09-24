import { motion, useTransform } from 'framer-motion'
import { useLoop } from '../lib/scene'

/**
 * Section two: what it is worth to a restaurant.
 *
 * Short on purpose. The film has already taken a few minutes and this is the
 * second of three things on the page — an owner reading it wants three
 * numbers, not another story, and the moment it becomes a story it stops
 * being read.
 *
 * On white, because after four screens of dark purple the eye needs somewhere
 * to rest, and because the argument here is commercial rather than emotional.
 * The three are the three the notes kept: a table that waits is not earning,
 * aggregators take a quarter to a third and this takes nothing, and nobody
 * queues.
 */
const POINTS = [
  {
    figure: 'Twice',
    unit: 'the table turnover',
    line: 'A table held by somebody waiting is not earning. Ordering on the way turns the same hour into twice the covers.',
  },
  {
    figure: '0%',
    unit: 'commission',
    line: 'Aggregators take a quarter to a third of every bill. Khapee takes nothing — UPI goes from the customer’s bank straight into yours.',
  },
  {
    figure: 'No',
    unit: 'queue at the door',
    line: 'People who see a queue leave. Orders that are already paid for and already cooking do not make one.',
  },
]

export function Advantages() {
  return (
    <section id="restaurants" className="relative bg-cream text-ink">
      <div className="mx-auto max-w-[1100px] px-[7vw] py-[14vh]">
        <p className="kicker" style={{ color: 'var(--clay)' }}>
          For restaurants
        </p>
        <h2
          className="display mt-5 max-w-[16ch]"
          style={{ fontSize: 'clamp(28px, 5vw, 62px)' }}
        >
          The same kitchen.
          <br />
          <span style={{ color: 'var(--clay)' }}>A busier counter.</span>
        </h2>

        <div className="mt-[8vh] grid gap-y-14 gap-x-[5vw] md:grid-cols-3">
          {POINTS.map((p, i) => (
            <motion.div
              key={p.figure}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-15%' }}
              transition={{ duration: 0.55, delay: i * 0.08, ease: [0.2, 0.8, 0.3, 1] }}
            >
              <span className="block h-px w-12 mb-7" style={{ background: 'var(--clay)' }} />
              <p className="display" style={{ fontSize: 'clamp(38px, 5.2vw, 62px)', lineHeight: 0.95 }}>
                {p.figure}
              </p>
              <p className="mt-2 text-[14px] font-semibold tracking-[0.04em] uppercase" style={{ color: 'var(--clay)' }}>
                {p.unit}
              </p>
              <p className="mt-5 text-[15.5px] leading-relaxed" style={{ color: '#5d5566' }}>
                {p.line}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * Section three, and the end of the page.
 *
 * Two things to do and nothing else — the notes asked for exactly this and
 * the restraint is the point. A page that ends in a footer of links ends by
 * asking somebody to choose between nine things when they had already decided.
 */
export function Close() {
  const loop = useLoop(1)
  const hand = useTransform(loop, (v) => v * 340)

  return (
    <section id="start" className="relative bg-night">
      <div className="mx-auto max-w-[900px] px-[7vw] py-[18vh] text-center">
        {/* the clock again, small, because it is the whole idea in one shape */}
        <svg viewBox="0 0 220 220" className="w-[74px] h-[74px] mx-auto mb-10" aria-hidden>
          <circle cx="110" cy="110" r="88" fill="#211539" />
          <circle cx="110" cy="110" r="88" fill="none" stroke="#452c68" strokeWidth="6" />
          <line x1="110" y1="110" x2="110" y2="58" stroke="#f4ede1" strokeWidth="8" strokeLinecap="round" />
          <line x1="110" y1="110" x2="146" y2="128" stroke="#f4ede1" strokeWidth="8" strokeLinecap="round" />
          <motion.line
            x1="110" y1="110" x2="110" y2="44"
            stroke="#d9a441" strokeWidth="4" strokeLinecap="round"
            style={{ rotate: hand, originX: '110px', originY: '110px' }}
          />
          <circle cx="110" cy="110" r="8" fill="#f4ede1" />
        </svg>

        <h2 className="display mx-auto max-w-[14ch]" style={{ fontSize: 'clamp(30px, 5.4vw, 70px)' }}>
          Don&rsquo;t wait for your food.
          <br />
          <span className="text-gold">Let your food wait for you.</span>
        </h2>

        <div className="mt-12 flex flex-wrap gap-3 justify-center">
          <a className="cta cta-primary" href="https://khapee.com">
            Order with Khapee
          </a>
          <a className="cta cta-ghost" href="https://khapee.com/for-restaurants">
            I run a restaurant
          </a>
        </div>

        <p className="mt-16 text-[12.5px]" style={{ color: 'rgba(244,237,225,0.4)' }}>
          Indore · khapee.com
        </p>
      </div>
    </section>
  )
}
