import { motion, useTransform } from 'framer-motion'
import { useCue, useLoop, useScene } from '../lib/scene'
import { Cue, Line, Section, Shot } from '../components/Scene'
import { Beats } from '../components/Beats'
import { CAST, Walker } from '../components/Figure'

/**
 * The other side of the counter.
 *
 * Everything above this is an argument to a customer. A restaurant is a
 * business, and the questions a business asks are how many more covers, how
 * much of the money reaches me, and what does it cost to try. So three
 * arguments, each one a number that moves rather than a claim that is made.
 *
 * The three were chosen because they are the three that are actually true and
 * actually matter, in the order an owner cares about them:
 *
 *  1. The same hour serves more people. A table held by somebody waiting is a
 *     table not earning. This is the real economics of a small restaurant and
 *     it is almost never said out loud.
 *  2. All of the money arrives. An aggregator takes a quarter to a third of
 *     the bill; this takes nothing, because it is not in the middle of the
 *     payment at all.
 *  3. The people who walk away stop walking away. A queue at the door is a
 *     queue of people deciding to eat somewhere else.
 */
export function Owners() {
  const { ref, t, lengthVh } = useScene(620)
  const loop = useLoop(1)

  /* --- 1: covers per hour ------------------------------------------- */
  const turn = useCue(t, 0.16, 0.34)
  /* Two counters, same hour. The gap between them is the argument. */
  const slowCount = useTransform(turn, (v) => Math.floor(v * 2.99))
  const fastCount = useTransform(turn, (v) => Math.floor(v * 5.99))
  const clock = useTransform(turn, (v) => v * 360)

  /* --- 2: what reaches the kitchen ---------------------------------- */
  const cut = useCue(t, 0.46, 0.62)
  /* The slice an aggregator removes, taken out of a bill in front of you. */
  const sliceX = useTransform(cut, [0, 1], [0, -46])
  const theirs = useTransform(cut, (v) => Math.round(100 - v * 28))

  /* --- 3: the queue that never forms -------------------------------- */
  const queue = useCue(t, 0.72, 0.95)
  const walkAway = useTransform(queue, [0, 1], [0, -190])

  return (
    <Section id="owners" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />

      {/* ============ 1. the same hour, twice ============ */}
      <Shot t={t} a={0.08} b={0.14} c={0.32} d={0.38} from={1.05} to={1}>
        <div className="w-full h-full flex flex-col justify-center gap-[2.6vh] pt-[13vh] pb-[15vh] px-[6vw]">
          {/* the reason, said before the numbers rather than after them */}
          <p
            className="display text-center text-cream mx-auto max-w-[26ch]"
            style={{ fontSize: 'clamp(16px, min(2.6vw, 3.4vh), 30px)', lineHeight: 1.15 }}
          >
            A table at which people are waiting is a table that is not earning.
          </p>
          {/* the hour being measured, above the thing it measures */}
          <div className="flex items-center justify-center gap-3">
            <svg viewBox="0 0 100 100" className="w-[26px] h-[26px]" aria-hidden>
              <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(244,237,225,0.22)" strokeWidth="6" />
              <motion.line
                x1="50" y1="50" x2="50" y2="16"
                stroke="var(--gold)" strokeWidth="7" strokeLinecap="round"
                style={{ rotate: clock, originX: '50px', originY: '50px' }}
              />
            </svg>
            <span className="kicker" style={{ color: 'var(--ash)' }}>One hour, one table</span>
          </div>

          <div className="w-full max-w-[860px] mx-auto grid sm:grid-cols-2 gap-[4vw] items-end">
            <Covers
              label="Waiting for food"
              count={slowCount}
              total={3}
              tone="rgba(244,237,225,0.26)"
              note="Ordered at the table. Forty minutes of it spent sitting."
            />
            <Covers
              label="On Khapee"
              count={fastCount}
              total={6}
              tone="var(--gold)"
              note="Ordered on the way. The table is for eating."
            />
          </div>
        </div>
      </Shot>

      <Cue t={t} a={-0.06} b={0} c={0.06} d={0.11}>
        <span className="chip mb-5 block">For restaurants</span>
        <span className="display block" style={{ fontSize: 'clamp(28px, min(5.6vw, 8vh), 78px)' }}>
          The same hour.
          <br />
          <span className="text-gold">Twice the table
          <br />
          turnover.</span>
        </span>
      </Cue>

      {/* ============ 2. all of it arrives ============ */}
      <Shot t={t} a={0.44} b={0.5} c={0.64} d={0.7} from={1.06} to={1}>
        <div className="w-full h-full grid place-items-center px-[6vw] pt-[14vh] pb-[15vh]">
          <div className="w-full max-w-[620px]">
            <p className="kicker mb-7">On a ₹100 order</p>
            <div className="relative h-[76px] flex">
              {/* what the kitchen keeps */}
              <motion.div
                className="h-full grid place-items-center"
                style={{ background: 'var(--gold)', width: '72%' }}
              >
                <motion.span className="display text-ink text-[30px]">
                  {useTransform(theirs, (v) => `₹${v}`)}
                </motion.span>
              </motion.div>
              {/* what a marketplace removes, physically taken out */}
              <motion.div
                className="h-full grid place-items-center relative"
                style={{ background: 'var(--clay)', width: '28%', x: sliceX, opacity: useTransform(cut, [0, 0.85, 1], [1, 1, 0.25]) }}
              >
                <span className="text-[13px] font-semibold text-cream">−₹28</span>
              </motion.div>
            </div>
            <motion.p
              className="mt-6 text-[15px] text-dust/75 max-w-[44ch]"
              style={{ opacity: useTransform(cut, [0.5, 1], [0, 1]) }}
            >
              Aggregators take a quarter to a third. Khapee takes nothing, because it is never
              holding your money — UPI goes from the customer&rsquo;s bank straight into yours.
            </motion.p>
          </div>
        </div>
      </Shot>

      <Cue t={t} a={0.4} b={0.44} c={0.48} d={0.52}>
        <span className="display block" style={{ fontSize: 'clamp(26px, min(5vw, 7.5vh), 68px)' }}>
          All of it
          <br />
          <span className="text-gold">reaches you.</span>
        </span>
      </Cue>

      {/* ============ 3. the queue that never forms ============ */}
      <Shot t={t} a={0.62} b={0.68} c={0.97} d={1.02} from={1.06} to={1}>
        <svg viewBox="0 0 900 420" className="w-full h-full" aria-hidden>
          <rect width="900" height="420" fill="var(--s1)" />
          <rect y="330" width="900" height="90" fill="var(--s2)" />
          {/* the door */}
          <rect x="560" y="96" width="280" height="234" rx="5" fill="var(--s4)" />
          <rect x="590" y="126" width="220" height="120" rx="4" fill="var(--s1)" />
          <motion.rect
            x="590" y="126" width="220" height="120" rx="4" fill="var(--gold)"
            style={{ opacity: useTransform(queue, [0, 1], [0.05, 0.16]) }}
          />
          {/* the people who used to give up and leave */}
          <motion.g style={{ x: walkAway, opacity: useTransform(queue, [0.3, 1], [1, 0.12]) }}>
            {[0, 1, 2].map((i) => (
              <g key={i} transform={`translate(${330 - i * 96} 176) scale(0.72)`}>
                <Walker mood={useTransform(queue, [0, 1], [0.12, 0.08])} look={CAST.hurried} />
              </g>
            ))}
          </motion.g>
          {/* and the one walking straight in */}
          <motion.g style={{ opacity: useTransform(queue, [0.45, 1], [0, 1]) }}>
            <g transform="translate(470 168) scale(0.86)">
              <Walker mood={useTransform(queue, [0.45, 1], [0.4, 1])} look={CAST.driver} stride={useTransform(loop, (v) => v * 1.3)} carry />
            </g>
          </motion.g>
        </svg>
      </Shot>

      <Cue t={t} a={0.58} b={0.62} c={0.68} d={0.73}>
        <span className="display block" style={{ fontSize: 'clamp(26px, min(5vw, 7.5vh), 68px)' }}>
          Nobody sees
          <br />
          <span className="text-gold">a queue.</span>
        </span>
      </Cue>

      <Line t={t} a={0.9} b={0.94} c={0.98} d={1.01} size="lg">
        Busier counter. <span className="text-gold">Same kitchen.</span>
      </Line>

      {/* the way on, for somebody who has just been convinced */}
      <motion.div
        className="absolute inset-x-0 bottom-[13vh] z-30 flex justify-center gap-3 px-6"
        style={{ opacity: useTransform(t, [0.93, 0.98], [0, 1]) }}
      >
        <a className="cta cta-primary" href="https://khapee.com/for-restaurants">
          Put your menu on Khapee
        </a>
        <a className="cta cta-ghost" href="#">
          See it from a customer&rsquo;s side
        </a>
      </motion.div>

      <Beats
        sceneRef={ref}
        t={t}
        marks={[
          { at: 0.02, label: 'More covers' },
          { at: 0.44, label: 'All the money' },
          { at: 0.6, label: 'No queue' },
        ]}
      />
      <div className="vignette" />
    </Section>
  )
}

/**
 * A count of people served, drawn as people rather than as a number.
 *
 * The figure is the argument — six heads against three is read instantly and a
 * bar chart is not — so the number beside it is confirmation rather than the
 * point.
 */
function Covers({
  label,
  count,
  total,
  tone,
  note,
}: {
  label: string
  count: ReturnType<typeof useTransform<number, number>>
  total: number
  tone: string
  note: string
}) {
  return (
    <div>
      <p className="kicker mb-4" style={{ color: tone === 'var(--gold)' ? 'var(--gold)' : 'var(--ash)' }}>
        {label}
      </p>
      <div className="flex items-end gap-2 h-[120px]">
        {Array.from({ length: total }).map((_, i) => (
          <Cover key={i} i={i} count={count} tone={tone} />
        ))}
      </div>
      <motion.p className="display mt-5" style={{ fontSize: 42, color: tone }}>
        {useTransform(count, (v) => `${v + 1}`)}
      </motion.p>
      <p className="text-[13.5px] text-dust/60 mt-2 max-w-[26ch]">{note}</p>
    </div>
  )
}

function Cover({
  i,
  count,
  tone,
}: {
  i: number
  count: ReturnType<typeof useTransform<number, number>>
  tone: string
}) {
  const on = useTransform(count, (v) => (v >= i ? 1 : 0.14))
  return (
    <motion.svg viewBox="0 0 30 60" className="w-[26px] h-[60px]" style={{ opacity: on }} aria-hidden>
      <circle cx="15" cy="13" r="9" fill={tone} />
      <path d="M2 56 q0 -25 13 -25 q13 0 13 25 z" fill={tone} />
    </motion.svg>
  )
}
