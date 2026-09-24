import { motion, useTransform } from 'framer-motion'
import { useLoop } from '../lib/scene'

/**
 * Section two: what it is worth to a restaurant.
 *
 * Three sentences, and nothing wrapped around them. It had a headline, a
 * figure and a paragraph for each point, which is four things to read before
 * reaching the one that matters — and the three sentences are already the
 * argument. An owner does not need "the same kitchen, a busier counter" to
 * explain a line that explains itself.
 *
 * On white, because after the film the eye needs somewhere to rest, and
 * because this is a commercial argument rather than an emotional one.
 */
const POINTS = [
  'A table held by someone waiting is not earning.',
  'We take no commission. Others take a quarter to a third.',
  'No queue at the door.',
]

export function Advantages() {
  return (
    <section id="restaurants" className="relative bg-cream text-ink">
      <div className="mx-auto max-w-[1000px] px-[7vw] py-[16vh]">
        <p className="kicker mb-[7vh]" style={{ color: 'var(--clay)' }}>
          For restaurants
        </p>

        <div>
          {POINTS.map((line, i) => (
            <motion.p
              key={line}
              className="display border-t py-[4.5vh]"
              style={{
                fontSize: 'clamp(23px, 3.6vw, 46px)',
                lineHeight: 1.12,
                borderColor: 'rgba(23,17,37,0.14)',
              }}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-18%' }}
              transition={{ duration: 0.55, delay: i * 0.1, ease: [0.2, 0.8, 0.3, 1] }}
            >
              {line}
            </motion.p>
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
