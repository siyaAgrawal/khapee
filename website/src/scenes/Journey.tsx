import { motion, useTransform } from 'framer-motion'
import { useCue, useScene } from '../lib/scene'
import { Band, Cue, Line, Section, Shot } from '../components/Scene'
import { Beats } from '../components/Beats'
import { PhoneFilm, usePhoneStep } from '../components/Phone'
import { Car } from '../components/Car'
import { Kitchen } from '../components/Kitchen'
import { CAST, Walker } from '../components/Figure'

/**
 * The story, once.
 *
 * This was three scenes — a drive, the end of school, the end of a shift —
 * each making the identical argument with the identical pictures. Three times
 * is not emphasis, it is a page somebody stops scrolling through. So it is one
 * journey now, told properly and at length: the end of a long day, an order
 * placed on the way out, the road and the kitchen running together, and
 * walking in to food already on the table.
 *
 * The two clocks stay because they are the clearest thing on the page — you
 * down one side, the kitchen down the other, both filling at once.
 */
const YOU = ['Leaving the office', '5 min away', '2 min away', 'Pulling in']
const THEM = ['Order received', 'On the range', 'Packing', 'On the pass']

export function Journey() {
  const { ref, t, lengthVh } = useScene(520)

  /* One face across the whole thing: flat out at the start, and genuinely
     pleased at the moment the food is in front of them. */
  const mood = useTransform(t, [0, 0.2, 0.3, 0.74, 0.88], [0.03, 0.03, 0.35, 0.42, 1])
  const speed = useTransform(t, [0.32, 0.42, 0.7, 0.78], [0, 1, 1, 0])
  const kitchen = useCue(t, 0.34, 0.76)
  const clocks = useCue(t, 0.36, 0.78)
  const arrival = useCue(t, 0.84, 1)

  const phone = usePhoneStep(t, [
    [0, 'location'],
    [0.07, 'nearby'],
    [0.1, 'restaurant'],
    [0.13, 'menu'],
    [0.16, 'item'],
    [0.19, 'cart'],
    [0.22, 'paying'],
    [0.25, 'paid'],
    [0.4, 'cooking'],
    [0.72, 'ready'],
  ])

  return (
    <Section id="journey" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />

      {/*
        ---- clocking off ----
        Nothing but the words and the phone. There was an office block behind
        the copy and it was doing no work: the line says the day is over, which
        is the whole of what the building was there to establish, and a dim
        drawing behind text is just something for the eye to trip on.
      */}
      <Shot t={t} a={-0.06} b={0} c={0.28} d={0.34} from={1.05} to={1}>
        {/* and the phone, with the right half to itself */}
        <div className="absolute inset-y-0 right-0 w-1/2 grid place-items-center px-[3vw]">
          <PhoneFilm step={phone} scale={0.92} />
        </div>
      </Shot>

      <Cue t={t} a={-0.06} b={0} c={0.07} d={0.12}>
        <span className="chip mb-5 block">Vijay Nagar, 9:10pm</span>
        <span className="display block" style={{ fontSize: 'clamp(26px, min(5.2vw, 7.4vh), 74px)' }}>
          The work is over.
          <br />
          <span className="text-gold">Your wait is not.</span>
        </span>
      </Cue>

      <Cue t={t} a={0.15} b={0.19} c={0.24} d={0.29}>
        <span className="display block" style={{ fontSize: 'clamp(21px, min(3.8vw, 5.4vh), 50px)' }}>
          &ldquo;We&rsquo;ll have your order
          <br />
          ready <span className="text-gold">for you.</span>&rdquo;
        </span>
      </Cue>

      {/* ---- the road and the kitchen, on one clock ---- */}
      <Shot t={t} a={0.3} b={0.36} c={0.78} d={0.84} from={1.06} to={1}>
        <div className="absolute inset-0 flex flex-col" style={{ background: '#1e1636' }}>
          <div className="h-[19vh] shrink-0" />
          <div className="flex-1 grid place-items-center min-h-0">
            <div className="split">
              <div style={{ background: '#1b1330' }}>
                <Car speed={speed} mood={mood} look={CAST.worker} />
                <span className="absolute left-9 top-6 kicker">You</span>
              </div>
              <div style={{ background: '#241a3d' }}>
                <Kitchen p={kitchen} />
                <span className="absolute left-9 top-6 kicker">Cafe Vijay Bhaiya</span>
              </div>
            </div>
          </div>
        </div>
      </Shot>

      <Band t={t} a={0.36} b={0.42} c={0.74} d={0.8}>
        Both of you started at the same time.{' '}
        <span className="text-gold">Neither of you is waiting.</span>
      </Band>

      {/* the two clocks, spelled out under the picture */}
      <motion.div
        className="absolute inset-x-0 bottom-[6vh] z-20 px-8 flex justify-center pointer-events-none"
        style={{ opacity: clocks }}
      >
        <div className="w-full max-w-[780px] grid grid-cols-2 gap-x-10 gap-y-2">
          <Column title="You" marks={YOU} p={clocks} />
          <Column title="Khapee" marks={THEM} p={clocks} align="right" />
        </div>
      </motion.div>

      {/* ---- inside, and it is already on the table ---- */}
      <Shot t={t} a={0.82} b={0.88} c={0.97} d={1.01} from={1.14} to={1}>
        <svg viewBox="0 0 900 460" className="w-full h-full" aria-hidden>
          <rect width="900" height="460" fill="#191125" />
          <rect y="286" width="900" height="174" fill="#241735" />
          <rect y="283" width="900" height="3" fill="#33215a" />

          <rect x="612" y="78" width="132" height="208" rx="4" fill="#2e1d44" />
          <motion.rect
            x="622" y="88" width="112" height="188" rx="3" fill="#d9a441"
            style={{ opacity: useTransform(arrival, [0, 0.5], [0.3, 0.1]) }}
          />
          <line x1="300" y1="0" x2="300" y2="58" stroke="#3a2752" strokeWidth="3" />
          <path d="M268 58 h64 l-15 28 h-34 z" fill="#b9563c" />

          <g transform="translate(300 300)">
            <rect x="-128" y="0" width="256" height="9" rx="4" fill="#5a3f78" />
            <rect x="-74" y="9" width="9" height="86" fill="#452c68" />
            <rect x="65" y="9" width="9" height="86" fill="#452c68" />
            <motion.ellipse
              cy="-4" rx="76" ry="17" fill="#d9a441"
              style={{ opacity: useTransform(arrival, [0, 1], [0, 0.22]) }}
            />
            <ellipse cy="-6" rx="52" ry="16" fill="#f4ede1" />
            <ellipse cy="-9" rx="37" ry="11" fill="#e0d3bc" />
            <ellipse cy="-11" rx="26" ry="7.5" fill="#b9563c" />
            <path d="M52 -30 h22 l-4 26 h-14 z" fill="#8a7fb0" opacity="0.55" />
            <g transform="translate(0 -26)">
              {[-13, 0, 13].map((x, i) => (
                <motion.path
                  key={x}
                  d={`M${x} 0 c${i % 2 ? 5 : -5} -7 ${i % 2 ? -5 : 5} -11 0 -18`}
                  stroke="#d9a441" strokeWidth="2.6" fill="none" strokeLinecap="round"
                  style={{ opacity: useTransform(arrival, [0.25, 0.7], [0, 0.55]) }}
                />
              ))}
            </g>
          </g>

          <motion.g style={{ x: useTransform(arrival, [0, 1], [230, 0]) }}>
            <g transform="translate(560 128) scale(0.92)">
              <Walker mood={mood} look={CAST.worker} />
            </g>
          </motion.g>
        </svg>
      </Shot>

      <Line t={t} a={0.88} b={0.93} c={0.985} d={1.02} size="xl" place="top">
        Long day. <span className="text-gold">Short wait.</span>
      </Line>

      <Beats
        sceneRef={ref}
        t={t}
        marks={[
          { at: 0.01, label: 'Clocking off' },
          { at: 0.15, label: 'Ordering' },
          { at: 0.36, label: 'Both moving' },
          { at: 0.6, label: 'Cooking' },
          { at: 0.86, label: 'Sitting down' },
        ]}
      />
      <div className="vignette" />
    </Section>
  )
}

/** One side of the pair of clocks. */
function Column({
  title,
  marks,
  p,
  align = 'left',
}: {
  title: string
  marks: string[]
  p: ReturnType<typeof useCue>
  align?: 'left' | 'right'
}) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p className="kicker mb-2.5">{title}</p>
      <div className="space-y-1.5">
        {marks.map((m, i) => (
          <Mark key={m} label={m} at={0.1 + (i / marks.length) * 0.8} p={p} align={align} />
        ))}
      </div>
    </div>
  )
}

function Mark({
  label,
  at,
  p,
  align,
}: {
  label: string
  at: number
  p: ReturnType<typeof useCue>
  align: 'left' | 'right'
}) {
  const on = useTransform(p, [at - 0.04, at], [0.22, 1])
  return (
    <motion.p
      className={`text-[13px] flex items-center gap-2.5 ${align === 'right' ? 'justify-end' : ''}`}
      style={{ opacity: on }}
    >
      {align === 'right' && <span className="text-cream">{label}</span>}
      <motion.span className="node" style={{ opacity: on }} />
      {align === 'left' && <span className="text-cream">{label}</span>}
    </motion.p>
  )
}
