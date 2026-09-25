import { motion, useTransform, type MotionValue } from 'framer-motion'
import { useLoop } from '../lib/scene'
import { CAST, Head } from './Figure'

/**
 * The other half of every scene: the kitchen, working.
 *
 * This is what the customer never sees and the whole product depends on. It
 * runs on the same clock as their journey, which is the entire argument made
 * visible — while they are travelling, this is happening, and the two finish
 * together.
 *
 * `p` is the kitchen's own progress, 0 to 1: cooking, plating, sealing, and
 * onto the pass. Steam and stirring run on their own clock, because a kitchen
 * that freezes when you stop scrolling is a diagram of a kitchen.
 */
export function Kitchen({ p }: { p: MotionValue<number> }) {
  const loop = useLoop(1)
  const mood = useTransform(p, [0, 1], [0.55, 0.8])

  /* the stir: a small ellipse traced by the hand, forever */
  const stirX = useTransform(loop, (t) => Math.cos(t * 6) * 9)
  const stirY = useTransform(loop, (t) => Math.sin(t * 6) * 4)

  /* steam, three wisps out of phase */
  const wisp = (o: number) => ({
    y: useTransform(loop, (t) => -((t * 26 + o * 20) % 46)),
    opacity: useTransform(loop, (t) => {
      const k = ((t * 26 + o * 20) % 46) / 46
      return k < 0.15 ? k / 0.15 * 0.5 : (1 - k) * 0.5
    }),
  })
  const w1 = wisp(0), w2 = wisp(1), w3 = wisp(2)

  /* the bag: appears when packing starts, is sealed, then goes to the pass */
  const bagIn = useTransform(p, [0.42, 0.56], [0, 1])
  const bagScale = useTransform(p, [0.42, 0.58], [0.7, 1])
  const flap = useTransform(p, [0.6, 0.74], [-120, 0])
  const sticker = useTransform(p, [0.74, 0.82], [0, 1])
  const bagX = useTransform(p, [0.84, 1], [0, 128])
  const panOut = useTransform(p, [0.42, 0.56], [1, 0.25])
  const glow = useTransform(p, [0.86, 1], [0, 1])

  return (
    <svg viewBox="-20 -190 560 550" className="w-full h-full" preserveAspectRatio="xMidYMax meet" aria-hidden>
      {/* back of house */}
      <rect x="0" y="-190" width="520" height="550" fill="var(--s3)" />
      {/* the wall above the pass: tiles, an extractor, a rail of pans */}
      <g opacity="0.55">
        {Array.from({ length: 13 }).map((_, c) =>
          Array.from({ length: 4 }).map((_, r) => (
            <rect key={`${c}-${r}`} x={4 + c * 40} y={-186 + r * 38} width="36" height="34" rx="2"
                  fill={(c + r) % 2 ? 'var(--s4)' : 'var(--s4)'} />
          )),
        )}
      </g>
      <g>
        <path d="M150 -190 h220 l36 74 h-292 z" fill="var(--s5)" />
        <rect x="112" y="-118" width="296" height="12" rx="3" fill="var(--s6)" />
        <rect x="128" y="-106" width="264" height="5" fill="var(--s3)" opacity="0.6" />
      </g>
      <g>
        <rect x="40" y="-92" width="150" height="4" rx="2" fill="var(--s6)" />
        {[62, 104, 146].map((x, i) => (
          <g key={x} transform={`translate(${x} -88)`}>
            <path d={`M-14 0 a14 14 0 0 0 28 0 z`} fill="var(--s7)" />
            <rect x="-1.5" y="-14" width="3" height="14" fill="var(--s7)" />
            {i === 1 && <ellipse cy="1" rx="9" ry="3" fill="var(--gold)" opacity="0.25" />}
          </g>
        ))}
      </g>
      <rect y="250" width="520" height="110" fill="var(--s2)" />

      {/* heat lamps over the pass */}
      {[150, 250, 350].map((x) => (
        <g key={x}>
          <line x1={x} y1="0" x2={x} y2="44" stroke="var(--s2)" strokeWidth="2" />
          <path d={`M${x - 20} 44 h40 l-9 17 h-22 z`} fill="#b9563c" />
          <ellipse cx={x} cy="70" rx="30" ry="9" fill="var(--gold)" opacity="0.16" />
        </g>
      ))}

      {/* shelving, for depth rather than detail */}
      <rect x="20" y="86" width="120" height="4" fill="var(--s2)" />
      <rect x="34" y="62" width="16" height="24" rx="2" fill="#7fae9f" opacity="0.5" />
      <rect x="58" y="68" width="14" height="18" rx="2" fill="var(--gold)" opacity="0.45" />

      {/* the chef */}
      <g transform="translate(196 150)">
        <path d="M-30 106 q-6 -62 30 -62 q36 0 30 62 z" fill={CAST.chef.cloth} />
        <path d="M20 48 q10 28 7 58 l-7 0 z" fill="var(--gold)" opacity="0.18" />
        {/* the stirring arm */}
        <motion.g style={{ x: stirX, y: stirY }}>
          <path d="M26 58 q34 16 44 34" stroke={CAST.chef.skin} strokeWidth="12" fill="none" strokeLinecap="round" />
        </motion.g>
        <path d="M-26 58 q-16 22 -12 40" stroke={CAST.chef.skin} strokeWidth="12" fill="none" strokeLinecap="round" />
        <g transform="translate(0 4)">
          <rect x="-5" y="14" width="10" height="16" fill={CAST.chef.skin} />
          <Head mood={mood} look={CAST.chef} />
          {/* a cap, so it is obvious who this is */}
          <path d="M-20 -14 q2 -18 20 -18 q18 0 20 18 z" fill="var(--porcelain)" />
        </g>
      </g>

      {/* the range */}
      <rect x="252" y="236" width="196" height="16" rx="4" fill="var(--s2)" />
      <motion.g style={{ opacity: panOut }}>
        <ellipse cx="316" cy="234" rx="44" ry="13" fill="var(--s2)" />
        <ellipse cx="316" cy="230" rx="36" ry="10" fill="#b9563c" />
        <ellipse cx="316" cy="228" rx="26" ry="7" fill="var(--gold)" />
        <path d="M352 232 q34 -4 44 -14" stroke="var(--s2)" strokeWidth="7" fill="none" strokeLinecap="round" />
        <g transform="translate(316 216)">
          <motion.path d="M-14 0 c-5 -8 5 -12 0 -20" stroke="var(--gold)" strokeWidth="3" fill="none" strokeLinecap="round" style={w1} />
          <motion.path d="M0 0 c5 -8 -5 -12 0 -20" stroke="var(--gold)" strokeWidth="3" fill="none" strokeLinecap="round" style={w2} />
          <motion.path d="M14 0 c-5 -8 5 -12 0 -20" stroke="var(--gold)" strokeWidth="3" fill="none" strokeLinecap="round" style={w3} />
        </g>
      </motion.g>

      {/* the pass, where finished food waits */}
      <rect x="320" y="286" width="200" height="8" rx="4" fill="#c98c33" />
      <motion.ellipse cx="452" cy="286" rx="60" ry="18" fill="var(--gold)" style={{ opacity: glow }} opacity={0.18} />

      {/* the bag: filled, sealed, then set down on the pass */}
      <motion.g style={{ opacity: bagIn, scale: bagScale, x: bagX, originX: '324px', originY: '286px' }}>
        <g transform="translate(324 286)">
          <path d="M-24 -54 h48 l5 54 h-58 z" fill="#b9563c" />
          <path d="M-24 -54 h48 l1 10 h-50 z" fill="#8f6426" />
          {/* the fold, closing */}
          <motion.g style={{ originX: '0px', originY: '-54px', rotateX: flap }}>
            <path d="M-24 -54 h48 v-13 h-48 z" fill="#cf9a4a" />
          </motion.g>
          <motion.rect x="-9" y="-62" width="18" height="12" rx="2" fill="var(--porcelain)" style={{ opacity: sticker }} />
          <rect x="-16" y="-30" width="32" height="14" rx="2" fill="var(--porcelain)" opacity="0.92" />
        </g>
      </motion.g>
    </svg>
  )
}
