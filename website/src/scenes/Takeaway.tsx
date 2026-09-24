import { motion, useTransform } from 'framer-motion'
import { useCue, useLoop, useScene } from '../lib/scene'
import { Line, Section, Shot, Warmth } from '../components/Scene'
import { Beats } from '../components/Beats'
import { PhoneFilm, usePhoneStep } from '../components/Phone'
import { Kitchen } from '../components/Kitchen'
import { CAST, Walker } from '../components/Figure'

/**
 * Scene four: takeaway, and no time.
 *
 * Shorter than the others on purpose. The scene is about not having time, so
 * it is worth less scrolling and everything in it happens faster — the cuts
 * are tighter, the walk is quicker, and the whole thing is over before the
 * previous scenes would have got to the kitchen.
 */
export function Takeaway() {
  const { ref, t, lengthVh } = useScene(440)
  const loop = useLoop(1)

  const mood = useTransform(t, [0, 0.18, 0.3, 0.72, 0.88], [0.12, 0.12, 0.38, 0.42, 1])
  /* A faster stride than the school walk. Small difference, does real work. */
  const stride = useTransform(loop, (v) => v * 2.4)
  const kitchen = useCue(t, 0.34, 0.72)
  const arrive = useCue(t, 0.78, 0.96)
  const warm = useTransform(t, [0.3, 0.5, 1], [0, 0.4, 0.85])

  /* A second hand that will not stop, which is the feeling being drawn. */
  const hand = useTransform(loop, (v) => v * 200)

  const phone = usePhoneStep(t, [
    [0, 'nearby'],
    [0.08, 'menu'],
    [0.13, 'cart'],
    [0.18, 'paying'],
    [0.22, 'paid'],
    [0.38, 'cooking'],
    [0.66, 'ready'],
  ])

  return (
    <Section id="takeaway" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />
      <Warmth o={warm} x="60%" y="55%" />

      {/* ---- late ---- */}
      <Shot t={t} a={-0.06} b={0} c={0.24} d={0.32} from={1.06} to={1}>
        <div className="flex items-center gap-[5vw] flex-wrap justify-center px-8 pt-[8vh] pb-[12vh]">
          <svg viewBox="0 0 220 220" className="w-[20vw] min-w-[150px] max-w-[240px]" aria-hidden>
            <circle cx="110" cy="110" r="88" fill="#211539" />
            <circle cx="110" cy="110" r="88" fill="none" stroke="#452c68" strokeWidth="3" />
            {Array.from({ length: 12 }).map((_, i) => (
              <rect key={i} x="108" y="30" width="4" height="13" rx="2" fill="#5c3d84"
                    transform={`rotate(${i * 30} 110 110)`} />
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
          <PhoneFilm step={phone} scale={0.9} />
        </div>
      </Shot>

      <Line t={t} a={-0.06} b={0} c={0.055} d={0.08} size="lg">
        Running late. Still have to eat.
      </Line>

      {/* ---- both moving at once ---- */}
      <Shot t={t} a={0.28} b={0.36} c={0.74} d={0.82} from={1.08} to={1}>
        <div className="absolute inset-0 flex flex-col" style={{ background: '#1e1636' }}>
          <div className="h-[19vh] shrink-0" />
          <div className="flex-1 grid place-items-center min-h-0">
          <div className="split">
          <div>
            <div className="absolute inset-0 bg-ink" />
            {/* the street going past, fast enough to smear */}
            <motion.div
              className="absolute bottom-[30%] left-0 right-0 h-px bg-white/10 smear"
              style={{ x: useTransform(loop, (v) => -((v * 300) % 240)) }}
            />
            <motion.div className="absolute bottom-[12%]" style={{ left: useTransform(t, [0.3, 0.76], ['6%', '58%']) }}>
              <svg viewBox="-60 -20 120 190" className="w-[128px] h-[196px]" aria-hidden>
                <Walker mood={mood} look={CAST.hurried} stride={stride} />
              </svg>
            </motion.div>
            <span className="absolute left-9 top-6 kicker">Four minutes away</span>
          </div>
          <motion.div className="" style={{ background: '#241a3d' }}>
            <Kitchen p={kitchen} />
            <span className="absolute left-9 top-6 kicker">Packing now</span>
          </motion.div>
          </div>
          </div>
        </div>
      </Shot>

      {/* ---- in, and straight out ---- */}
      <Shot t={t} a={0.76} b={0.84} c={0.97} d={1.01} from={1.12} to={1}>
        <svg viewBox="0 0 760 400" className="w-full h-full" aria-hidden>
          <rect width="760" height="400" fill="#191125" />
          <rect y="312" width="760" height="88" fill="#211539" />
          <rect x="380" y="76" width="340" height="236" rx="5" fill="#2b1b49" />
          <rect x="404" y="52" width="292" height="30" rx="5" fill="#33215a" />
          <text x="550" y="73" textAnchor="middle" fontSize="13" letterSpacing="4" fill="#d9a441" fontWeight="600">
            PICK UP
          </text>
          <rect x="404" y="196" width="292" height="7" rx="3.5" fill="#5c3d84" />
          <rect x="404" y="270" width="292" height="7" rx="3.5" fill="#5c3d84" />
          {/* the bag that was theirs, leaving with them */}
          <motion.g style={{ opacity: useTransform(arrive, [0, 0.45], [1, 0]) }}>
            <g transform="translate(470 196)">
              <path d="M-20 -44 h40 l4 44 h-48 z" fill="#b9563c" />
              <rect x="-13" y="-24" width="26" height="12" rx="2" fill="#f4ede1" opacity="0.92" />
            </g>
          </motion.g>
          <g transform="translate(624 196)">
            <path d="M-20 -44 h40 l4 44 h-48 z" fill="#3a2560" />
          </g>
          <motion.g style={{ x: useTransform(arrive, [0, 1], [-60, 90]) }}>
            <g transform="translate(220 172)">
              <Walker mood={mood} look={CAST.hurried} carry />
            </g>
          </motion.g>
          <motion.ellipse cx="470" cy="196" rx="60" ry="18" fill="#d9a441" opacity={0.26}
            style={{ opacity: useTransform(arrive, [0, 0.4], [0.26, 0]) }} />
        </svg>
      </Shot>

      <Line t={t} a={0.86} b={0.9} c={0.93} d={0.955} size="lg">
        Don&rsquo;t wait for your food.
      </Line>
      <Line t={t} a={0.955} b={0.975} c={1} d={1.01} size="xl">
        Let your food wait for you.
      </Line>

      <Beats sceneRef={ref} t={t} marks={[{ at: 0.02, label: 'Late' }, { at: 0.12, label: 'Ordering' }, { at: 0.36, label: 'Both moving' }, { at: 0.8, label: 'Straight out' }]} />
      <div className="vignette" />
    </Section>
  )
}
