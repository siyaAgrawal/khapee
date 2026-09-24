import { motion, useTransform } from 'framer-motion'
import { useCue, useScene } from '../lib/scene'
import { Line, Section, Shot, Warmth } from '../components/Scene'
import { PhoneFilm, usePhoneStep } from '../components/Phone'
import { Car } from '../components/Car'
import { Kitchen } from '../components/Kitchen'
import { CAST, Walker } from '../components/Figure'

/**
 * Scene three: the end of a long day.
 *
 * Same mechanism as the drive, different feeling and a different shot. Here
 * the two timelines are made explicit and numeric — minutes on one side,
 * stages on the other — because this is the scene for somebody who is tired
 * enough to want the promise stated rather than implied.
 */
const YOU = ['Leaving the office', '5 min', '2 min', 'Pulling in']
const THEM = ['Order received', 'On the range', 'Packing', 'On the pass']

export function Work() {
  const { ref, t, lengthVh } = useScene(480)

  const mood = useTransform(t, [0, 0.24, 0.36, 0.8, 0.92], [0.03, 0.03, 0.35, 0.4, 1])
  const speed = useTransform(t, [0.34, 0.44, 0.76, 0.84], [0, 1, 1, 0])
  const kitchen = useCue(t, 0.4, 0.82)
  const arrive = useCue(t, 0.86, 1)
  const warm = useTransform(t, [0.3, 0.55, 1], [0, 0.45, 0.85])
  const clocks = useCue(t, 0.36, 0.86)

  const phone = usePhoneStep(t, [
    [0, 'location'],
    [0.07, 'nearby'],
    [0.12, 'menu'],
    [0.17, 'cart'],
    [0.22, 'paying'],
    [0.27, 'paid'],
    [0.46, 'cooking'],
    [0.78, 'ready'],
  ])

  return (
    <Section id="work" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-wine" />
      <Warmth o={warm} y="62%" />

      {/* ---- leaving, in the dark, in the car park ---- */}
      <Shot t={t} a={-0.06} b={0} c={0.28} d={0.36} from={1.05} to={1}>
        <div className="flex items-center gap-[5vw] flex-wrap justify-center px-8 pt-[8vh] pb-[12vh]">
          <svg viewBox="0 0 300 320" className="w-[26vw] min-w-[200px] max-w-[330px]" aria-hidden>
            {/* an office with two windows still lit, which is the whole mood */}
            <rect x="40" y="20" width="220" height="266" rx="4" fill="#22201a" />
            {Array.from({ length: 24 }).map((_, i) => (
              <rect
                key={i}
                x={60 + (i % 4) * 48} y={44 + Math.floor(i / 4) * 40}
                width="32" height="26" rx="2"
                fill={i === 6 || i === 17 ? '#d9a441' : '#141308'}
                opacity={i === 6 || i === 17 ? 0.75 : 1}
              />
            ))}
            <rect y="286" width="300" height="34" fill="#1a1812" />
          </svg>
          <PhoneFilm step={phone} scale={0.92} />
        </div>
      </Shot>

      <Line t={t} a={-0.06} b={0} c={0.07} d={0.1} size="lg">
        Nine hours. One more thing to wait for.
      </Line>
      <Line t={t} a={0.28} b={0.31} c={0.34} d={0.37} size="sm">
        &ldquo;We&rsquo;ll have it ready when you arrive.&rdquo;
      </Line>

      {/* ---- the drive home, and the kitchen, on one clock ---- */}
      <Shot t={t} a={0.32} b={0.4} c={0.82} d={0.9} from={1.08} to={1}>
        <div className="w-full h-full grid grid-rows-2 md:grid-rows-1 md:grid-cols-2">
          <div className="relative overflow-hidden">
            <Car speed={speed} mood={mood} look={CAST.worker} />
          </div>
          <motion.div className="relative overflow-hidden border-l border-white/5" style={{ opacity: kitchen }}>
            <Kitchen p={kitchen} />
          </motion.div>
        </div>
      </Shot>

      {/* the two clocks, spelled out */}
      <motion.div
        className="absolute inset-x-0 bottom-[8vh] z-20 px-8 flex justify-center pointer-events-none"
        style={{ opacity: clocks }}
      >
        <div className="w-full max-w-[760px] grid grid-cols-2 gap-x-10 gap-y-2">
          <Column title="You" marks={YOU} p={clocks} />
          <Column title="Khapee" marks={THEM} p={clocks} align="right" />
        </div>
      </motion.div>

      {/* ---- handed over ---- */}
      <Shot t={t} a={0.86} b={0.92} c={0.99} d={1.01} from={1.12} to={1}>
        <svg viewBox="0 0 760 420" className="w-full h-full" aria-hidden>
          <rect width="760" height="420" fill="#17160f" />
          <rect y="330" width="760" height="90" fill="#1d1b15" />
          <rect x="60" y="96" width="640" height="234" rx="5" fill="#232019" />
          <motion.rect x="92" y="126" width="576" height="124" rx="4" fill="#d9a441" opacity={0.13} style={{ opacity: arrive }} />
          {/* the counter, and the hand-over */}
          <rect x="300" y="268" width="330" height="8" rx="4" fill="#4a4438" />
          <motion.g style={{ x: useTransform(arrive, [0, 1], [70, 0]) }}>
            <g transform="translate(470 268)">
              <path d="M-22 -48 h44 l5 48 h-54 z" fill="#b9563c" />
              <rect x="-15" y="-27" width="30" height="13" rx="2" fill="#f4ede1" opacity="0.92" />
            </g>
          </motion.g>
          <g transform="translate(240 178) scale(1.02)">
            <Walker mood={mood} look={CAST.worker} carry />
          </g>
        </svg>
      </Shot>

      <Line t={t} a={0.92} b={0.955} c={0.98} d={1.005} size="xl">
        Long day. Short wait.
      </Line>

      <div className="vignette" />
    </Section>
  )
}

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
