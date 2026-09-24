import { motion, useTransform } from 'framer-motion'
import { useCue, useLoop, useScene } from '../lib/scene'
import { Line, Section, Shot, Warmth } from '../components/Scene'
import { Beats } from '../components/Beats'
import { PhoneFilm, usePhoneStep } from '../components/Phone'
import { Kitchen } from '../components/Kitchen'
import { CAST, Walker } from '../components/Figure'

/**
 * Scene two: school ends.
 *
 * Deliberately built as a literal split screen, because the argument here is
 * about simultaneity and a split screen is the only shot that can show two
 * places at one moment. On the left somebody walks; on the right their food is
 * made; the divider slides away when the two meet.
 */
export function School() {
  const { ref, t, lengthVh } = useScene(520)
  const loop = useLoop(1)

  const mood = useTransform(t, [0, 0.2, 0.34, 0.78, 0.9], [0.1, 0.1, 0.45, 0.5, 1])
  const stride = useTransform(loop, (v) => v * 1.5)

  const phone = usePhoneStep(t, [
    [0, 'location'],
    [0.08, 'nearby'],
    [0.13, 'menu'],
    [0.18, 'cart'],
    [0.23, 'paying'],
    [0.27, 'paid'],
    [0.42, 'cooking'],
    [0.74, 'ready'],
  ])

  const kitchen = useCue(t, 0.36, 0.8)
  /* The divider between the two halves narrows as they converge, then goes. */
  const divide = useTransform(t, [0.74, 0.88], [1, 0])
  const walk = useTransform(t, [0.34, 0.8], ['8%', '62%'])
  const arrive = useCue(t, 0.84, 1)
  const warm = useTransform(t, [0.3, 0.5, 1], [0, 0.4, 0.8])

  return (
    <Section id="school" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />
      <Warmth o={warm} x="72%" y="50%" />

      {/* ---- outside the gates ---- */}
      <Shot t={t} a={-0.06} b={0} c={0.26} d={0.34} from={1.05} to={1}>
        <div className="flex items-center gap-[5vw] flex-wrap justify-center px-8 pt-[8vh] pb-[12vh]">
          <svg viewBox="0 0 320 300" className="w-[30vw] min-w-[220px] max-w-[360px]" aria-hidden>
            {/* the building, the gate, and everybody else leaving */}
            <rect x="24" y="52" width="272" height="188" rx="5" fill="#271640" />
            {Array.from({ length: 10 }).map((_, i) => (
              <rect key={i} x={46 + (i % 5) * 50} y={74 + Math.floor(i / 5) * 56} width="30" height="34" rx="2" fill="#140d20" />
            ))}
            <rect x="120" y="176" width="80" height="64" rx="3" fill="#2b1b49" />
            <rect y="240" width="320" height="60" fill="#1a1030" />
            {[52, 96, 250].map((x, i) => (
              <motion.g key={x} style={{ x: useTransform(loop, (v) => ((v * 14 + i * 40) % 320) - 40), opacity: 0.35 }}>
                <ellipse cx={x} cy="238" rx="11" ry="3" fill="#000" />
                <path d={`M${x - 8} 236 q-2 -30 8 -30 q10 0 8 30 z`} fill="#33215a" />
                <circle cx={x} cy="198" r="9" fill="#452c68" />
              </motion.g>
            ))}
          </svg>
          <PhoneFilm step={phone} scale={0.92} />
        </div>
      </Shot>

      <Line t={t} a={-0.06} b={0} c={0.06} d={0.085} size="lg">
        The bell goes. You are starving.
      </Line>
      <Line t={t} a={0.26} b={0.29} c={0.32} d={0.35} size="sm">
        &ldquo;Your order will be ready when you arrive.&rdquo;
      </Line>

      {/* ---- the split: walking, and cooking ---- */}
      <Shot t={t} a={0.3} b={0.38} c={0.86} d={0.94} from={1.08} to={1}>
        <div className="relative w-full h-full">
          {/* left: the walk */}
          <div className="absolute inset-y-0 left-0 right-1/2 overflow-hidden">
            <div className="absolute inset-0 bg-ink" />
            <div className="absolute bottom-[26%] left-0 right-0 h-px bg-white/10" />
            <motion.div className="absolute bottom-[10%]" style={{ left: walk }}>
              <svg viewBox="-60 -20 120 190" className="w-[130px] h-[200px]" aria-hidden>
                <Walker mood={mood} look={CAST.student} stride={stride} />
              </svg>
            </motion.div>
            <span className="absolute left-9 top-6 kicker">You, walking</span>
          </div>

          {/* right: the kitchen */}
          <motion.div className="absolute inset-y-0 right-0 left-1/2 overflow-hidden" style={{ opacity: kitchen }}>
            <Kitchen p={kitchen} />
            <span className="absolute left-9 top-6 kicker">The kitchen</span>
          </motion.div>

          {/* the line between them, which stops existing when they meet */}
          <motion.div
            className="absolute inset-y-[18%] left-1/2 w-px bg-gold/45"
            style={{ opacity: divide, scaleY: divide }}
          />
        </div>
      </Shot>

      <Line t={t} a={0.44} b={0.5} c={0.6} d={0.66} size="sm" place="bottom">
        Two hundred metres. Six minutes. Both of you are halfway.
      </Line>

      {/* ---- collecting ---- */}
      <Shot t={t} a={0.88} b={0.94} c={0.99} d={1.01} from={1.05} to={1}>
        <svg viewBox="0 0 760 420" className="w-full h-full" aria-hidden>
          <rect width="760" height="420" fill="#191125" />
          <rect y="320" width="760" height="100" fill="#211539" />
          <rect x="380" y="120" width="330" height="200" rx="5" fill="#2b1b49" />
          <rect x="404" y="146" width="282" height="104" rx="3" fill="#140d20" />
          <motion.rect x="404" y="146" width="282" height="104" rx="3" fill="#d9a441" opacity={0.14} style={{ opacity: arrive }} />
          {/* the shelf, and the one bag with a name on it */}
          <rect x="430" y="262" width="230" height="7" rx="3.5" fill="#5c3d84" />
          <g transform="translate(545 262)">
            <path d="M-22 -48 h44 l5 48 h-54 z" fill="#b9563c" />
            <rect x="-15" y="-27" width="30" height="13" rx="2" fill="#f4ede1" opacity="0.92" />
          </g>
          <g transform="translate(250 190) scale(1.05)">
            <Walker mood={mood} look={CAST.student} carry />
          </g>
        </svg>
      </Shot>

      <Line t={t} a={0.92} b={0.96} c={0.99} d={1.01} size="xl">
        School ended. Waiting didn&rsquo;t have to.
      </Line>

      <Beats sceneRef={ref} t={t} marks={[{ at: 0.02, label: 'Bell' }, { at: 0.14, label: 'Ordering' }, { at: 0.4, label: 'Walking' }, { at: 0.7, label: 'Almost' }, { at: 0.9, label: 'Collected' }]} />
      <div className="vignette" />
    </Section>
  )
}
