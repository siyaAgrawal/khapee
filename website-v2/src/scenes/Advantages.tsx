import { motion, useTransform } from 'framer-motion'
import { useLoop } from '../lib/scene'

/**
 * Section two: what it is worth to a restaurant.
 *
 * Three sentences and nothing wrapped around them. It had a headline, a big
 * figure and a paragraph for each point, which is four things to read before
 * reaching the one that mattered — and the sentences are already the argument.
 *
 * One of them is paraphrased and only one. "We take no commission, others take
 * a quarter to a third" is the right fact in the wrong order: it opens on the
 * good news and closes on the competitor, so the last thing in the reader's ear
 * is what somebody else charges. Turned around, the sentence ends on nothing,
 * which is the number worth remembering.
 *
 * On white, because after the film the eye needs somewhere to rest, and because
 * this is a commercial argument rather than an emotional one.
 */
const POINTS: { lead: string; hit: string; tail?: string }[] = [
  { lead: 'A table held by someone waiting', hit: ' is not earning.' },
  { lead: 'Other aggregators take a quarter to a third.', hit: ' We take nothing.' },
  { lead: '', hit: 'No queue', tail: ' at the door.' },
]

export function Advantages() {
  return (
    <section id="restaurants" className="relative bg-cream text-ink overflow-hidden">
      {/* a block of the brand colour running off the edge, so the section has
          a shape rather than being a white gap between two dark ones */}
      <div
        className="absolute -right-[12vw] -top-[8vh] w-[42vw] h-[42vw] rounded-full"
        style={{ background: 'rgb(var(--accent-rgb) / 0.16)' }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-[1060px] px-[7vw] py-[15vh]">
        <h2
          className="display mb-[8vh]"
          style={{ fontSize: 'clamp(34px, 6.4vw, 86px)', lineHeight: 0.95 }}
        >
          For <span style={{ color: 'var(--on-paper)' }}>restaurants</span>
        </h2>

        <div>
          {POINTS.map((p, i) => (
            <motion.div
              key={p.hit}
              className="flex items-baseline gap-[3vw] border-t py-[4.6vh]"
              style={{ borderColor: 'rgb(var(--s1-rgb) / 0.18)' }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-18%' }}
              transition={{ duration: 0.6, delay: i * 0.1, ease: [0.2, 0.8, 0.3, 1] }}
            >
              <span
                className="display shrink-0"
                style={{
                  fontSize: 'clamp(20px, 2.4vw, 32px)',
                  color: 'var(--on-paper)',
                  opacity: 0.55,
                  lineHeight: 1,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <p className="display" style={{ fontSize: 'clamp(24px, 4vw, 52px)', lineHeight: 1.08 }}>
                {p.lead}
                <span style={{ color: 'var(--on-paper)' }}>{p.hit}</span>
                {p.tail}
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
          <circle cx="110" cy="110" r="88" fill="var(--s2)" />
          <circle cx="110" cy="110" r="88" fill="none" stroke="var(--s6)" strokeWidth="6" />
          <line x1="110" y1="110" x2="110" y2="58" stroke="var(--paper)" strokeWidth="8" strokeLinecap="round" />
          <line x1="110" y1="110" x2="146" y2="128" stroke="var(--paper)" strokeWidth="8" strokeLinecap="round" />
          <motion.line
            x1="110" y1="110" x2="110" y2="44"
            stroke="var(--accent)" strokeWidth="4" strokeLinecap="round"
            style={{ rotate: hand, originX: '110px', originY: '110px' }}
          />
          <circle cx="110" cy="110" r="8" fill="var(--paper)" />
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
          {/* Down the page rather than off it: the argument for restaurants
              is the next section, and sending somebody to the app to read it
              throws away the one they are already on. */}
          <a className="cta cta-ghost" href="#restaurants">
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
