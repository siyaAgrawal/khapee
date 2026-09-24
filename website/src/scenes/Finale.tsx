import { motion, useTransform } from 'framer-motion'
import { useCue, useLoop, useScene } from '../lib/scene'
import { Section, Shot } from '../components/Scene'
import { Beats } from '../components/Beats'
import { Car } from '../components/Car'
import { Confetti } from '../components/Confetti'
import { CAST } from '../components/Figure'

/**
 * The end.
 *
 * Everything that has been shown separately, once more and briefly: a car
 * pulling in, a bag waiting under a lamp, a phone that already says ready.
 * Then the line the whole film exists to earn, in two halves with a pause
 * between them, because the pause is what makes it land.
 */
export function Finale() {
  const { ref, t, lengthVh } = useScene(300)
  const loop = useLoop(1)

  const mood = useTransform(t, [0, 0.2, 0.4], [0.4, 0.9, 1])
  const speed = useTransform(t, [0, 0.16], [1, 0])
  const warm = useTransform(t, [0.18, 0.34], [0.2, 0.7])

  const bag = useCue(t, 0.24, 0.42)
  const ready = useCue(t, 0.38, 0.52)
  const first = useTransform(t, [0.6, 0.66, 0.73, 0.78], [0, 1, 1, 0])
  const second = useTransform(t, [0.78, 0.82, 0.85, 0.88], [0, 1, 1, 0])
  const third = useTransform(t, [0.86, 0.9, 0.93, 0.96], [0, 1, 1, 0])
  const logo = useCue(t, 0.95, 0.99)

  return (
    <Section id="end" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-ink" />
      <motion.div
        className="warmth"
        style={{ opacity: useTransform(warm, [0, 1], [0, 0.18]), background: 'var(--gold)', top: '60%' }}
      />

      {/* a car, pulling in */}
      <Shot t={t} a={-0.06} b={0} c={0.16} d={0.24} from={1} to={1.06}>
        <Car speed={speed} mood={mood} look={CAST.driver} />
      </Shot>

      {/* a bag, waiting under the lamp */}
      <Shot t={t} a={0.2} b={0.3} c={0.46} d={0.56} from={1.12} to={1}>
        <svg viewBox="0 0 600 380" className="w-full h-full" aria-hidden>
          <rect width="600" height="380" fill="#0a0a0b" />
          <line x1="300" y1="0" x2="300" y2="58" stroke="#26262e" strokeWidth="2.5" />
          <path d="M262 58 h76 l-17 30 h-42 z" fill="#2e2e37" />
          <motion.ellipse cx="300" cy="250" rx="130" ry="34" fill="#d9a441" opacity={0.2} style={{ opacity: bag }} />
          <rect x="150" y="248" width="300" height="9" rx="4.5" fill="#5c3d84" />
          <motion.g style={{ opacity: bag, scale: useTransform(bag, [0, 1], [0.9, 1]), originX: '300px', originY: '248px' }}>
            <g transform="translate(300 248)">
              <path d="M-30 -66 h60 l7 66 h-74 z" fill="#b9563c" />
              <path d="M-30 -66 h60 l1 12 h-62 z" fill="#a84524" />
              <rect x="-20" y="-38" width="40" height="17" rx="2.5" fill="#f4ede1" opacity="0.94" />
            </g>
          </motion.g>
        </svg>
      </Shot>

      {/* the phone, already saying so */}
      <motion.div className="absolute inset-0 grid place-items-center" style={{ opacity: ready }}>
        <div className="text-center">
          <motion.div
            className="mx-auto w-3 h-3 rounded-full bg-gold"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          />
          <p className="display mt-6" style={{ fontSize: 'clamp(30px,5vw,68px)' }}>
            Order ready
          </p>
        </div>
      </motion.div>

      {/* and the one celebration on the whole page, at the end of it */}
      <motion.div
        className="absolute inset-0 z-30 pointer-events-none"
        style={{ opacity: useTransform(t, [0.5, 0.56, 0.86, 0.92], [0, 1, 1, 0]) }}
      >
        <Confetti p={useCue(t, 0.54, 0.92)} />
      </motion.div>

      {/* the line, in two halves, with the pause in between */}
      <motion.div className="absolute inset-0 grid place-items-center px-6" style={{ opacity: first }}>
        <p className="display text-center" style={{ fontSize: 'clamp(40px,8vw,112px)' }}>
          You don&rsquo;t wait.
        </p>
      </motion.div>
      <motion.div className="absolute inset-0 grid place-items-center px-6" style={{ opacity: second }}>
        <p className="display text-center text-gold" style={{ fontSize: 'clamp(40px,8vw,112px)' }}>
          Your food does.
        </p>
      </motion.div>
      <motion.div className="absolute inset-0 grid place-items-center px-6" style={{ opacity: third }}>
        <p className="display text-center" style={{ fontSize: 'clamp(34px,6.4vw,92px)' }}>
          That&rsquo;s <span className="text-gold">Khapee.</span>
        </p>
      </motion.div>

      {/* and the name */}
      <motion.div
        className="absolute inset-0 grid place-items-center px-6"
        style={{ opacity: logo, scale: useTransform(logo, [0, 1], [0.94, 1]) }}
      >
        <div className="text-center">
          <div className="flex items-center justify-center gap-4">
            <span className="grid place-items-center w-14 h-14 bg-white text-ink text-[24px]" style={{ borderRadius: 5 }}>
              ◗
            </span>
            <span className="display" style={{ fontSize: 'clamp(46px,8vw,104px)' }}>Khapee</span>
          </div>
          <p className="mt-5 text-ash text-[16px]">Order before you arrive.</p>
          <p className="mt-2 text-ash/70 text-[13px] tracking-[0.3em] uppercase">Order · Pay · Arrive · Eat</p>
          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <a className="cta cta-primary" href="https://khapee.com">Order with Khapee</a>
            <a className="cta cta-ghost" href="#for-restaurants">I run a restaurant</a>
          </div>
          <p className="mt-12 text-ash/50 text-[12px]">
            Made in Indore ·{' '}
            <motion.span style={{ opacity: useTransform(loop, (v) => 0.6 + Math.sin(v * 2) * 0.2) }}>
              khapee.com
            </motion.span>
          </p>
        </div>
      </motion.div>

      <Beats sceneRef={ref} t={t} marks={[{ at: 0.02, label: 'Pulling in' }, { at: 0.26, label: 'Waiting' }, { at: 0.42, label: 'Ready' }, { at: 0.62, label: 'You' }, { at: 0.9, label: 'Khapee' }]} />
      <div className="vignette" />
    </Section>
  )
}
