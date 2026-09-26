import { motion, useTransform, type MotionValue } from 'framer-motion'
import { useLoop } from '../lib/scene'
import { Head, type Skin } from './Figure'

/**
 * The journey, as a moving vehicle rather than a picture of one.
 *
 * The car itself barely moves — the world moves past it, which is both how
 * driving actually feels and the only way to show travel without running out
 * of screen. `speed` scales everything that streams past, so the same scene
 * can pull away, cruise and arrive without any of it being a separate drawing.
 */
export function Car({
  speed,
  mood,
  look,
  night = true,
}: {
  speed: MotionValue<number>
  mood: MotionValue<number>
  look: Skin
  night?: boolean
}) {
  const loop = useLoop(1)

  /* Distance covered so far, so the streaks keep their spacing as speed
     changes instead of jumping when it does. */
  const travelled = useTransform(loop, (t) => t * 460)
  const dash = useTransform([travelled, speed], ([d, s]: number[]) => -((d * s) % 180))
  const wheel = useTransform([travelled, speed], ([d, s]: number[]) => (d * s) % 360)
  const blur = useTransform(speed, [0, 1], [0, 4])
  const bounce = useTransform(loop, (t) => Math.sin(t * 9) * 1.1)
  /* The skyline drifts at a fraction of the road's speed. That ratio is
     the only thing making this look like distance rather than a backdrop. */
  const cityX = useTransform(dash, (v) => v * 0.12)
  /* Two slower layers above it. Different rates are the whole of the effect —
     one layer moving is a backdrop, three is distance. */
  const skyX = useTransform(dash, (v) => v * 0.05)
  const cableX = useTransform(dash, (v) => v * 0.34)
  const blurCss = useTransform(blur, (b) => `blur(${b}px)`)

  return (
    <svg viewBox="0 -250 560 550" className="w-full h-full" preserveAspectRatio="xMidYMax meet" aria-hidden>
      <rect width="560" height="300" fill={night ? '#1a1030' : '#271640'} />

      {/* the high city, slowest of all — three layers of parallax now */}
      <motion.g style={{ x: skyX, opacity: 0.22 }}>
        {[0, 240, 480, 720].map((x) => (
          <g key={x} transform={`translate(${x} 0)`}>
            <rect x="12" y="-214" width="46" height="180" fill="#2a1f52" />
            <rect x="72" y="-158" width="34" height="124" fill="#261c4a" />
            <rect x="124" y="-238" width="52" height="204" fill="#2e2259" />
            <rect x="190" y="-186" width="30" height="152" fill="#261c4a" />
            {[0, 1, 2, 3].map((r) =>
              [0, 1].map((c) => (
                <rect key={`${r}-${c}`} x={132 + c * 18} y={-224 + r * 30} width="8" height="12"
                      fill="#d9a441" opacity={(r + c) % 3 === 0 ? 0.7 : 0.2} />
              )),
            )}
          </g>
        ))}
      </motion.g>

      {/* cables, which is what a street in Indore actually has overhead */}
      <motion.g style={{ x: cableX }}>
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${i * 300} 0)`}>
            <rect x="40" y="-190" width="5" height="172" fill="#221a3f" />
            <path d="M42 -176 q150 26 300 0" fill="none" stroke="#221a3f" strokeWidth="3" />
            <path d="M42 -164 q150 30 300 0" fill="none" stroke="#221a3f" strokeWidth="2.5" />
            {/* the lamp on the pole, and the cone it throws */}
            <path d="M42 -190 q26 -6 34 4" fill="none" stroke="#221a3f" strokeWidth="4" />
            <circle cx="78" cy="-184" r="6" fill="#d9a441" opacity="0.85" />
            <path d="M78 -178 L30 -10 L126 -10 Z" fill="#d9a441" opacity="0.07" />
          </g>
        ))}
      </motion.g>

      {/* the city, far away and barely moving: the parallax that gives depth */}
      <motion.g style={{ x: cityX, opacity: 0.32 }}>
        {[0, 190, 380, 570].map((x) => (
          <g key={x} transform={`translate(${x} 0)`}>
            <rect x="20" y="96" width="34" height="108" fill="#33215a" />
            <rect x="66" y="126" width="26" height="78" fill="#2b1b49" />
            <rect x="104" y="80" width="40" height="124" fill="#3d2566" />
            {[0, 1, 2].map((r) =>
              [0, 1].map((c) => (
                <rect key={`${r}-${c}`} x={112 + c * 14} y={92 + r * 22} width="7" height="10" fill="#d9a441" opacity="0.85" />
              )),
            )}
          </g>
        ))}
      </motion.g>

      {/* the road, and the streaks that make it read as speed */}
      <rect y="204" width="560" height="96" fill="#1a1030" />
      <rect y="202" width="560" height="3" fill="#b9563c" />
      <motion.g style={{ x: dash, filter: blurCss }}>
        {Array.from({ length: 9 }).map((_, i) => (
          <rect key={i} x={i * 180} y="252" width="96" height="4" rx="2" fill="#d9a441" opacity="0.6" />
        ))}
      </motion.g>

      {/* the car */}
      <motion.g style={{ y: bounce }}>
        {night && (
          <g>
            <path d="M104 212 L-40 176 L-40 248 Z" fill="#d9a441" opacity="0.12" />
            <circle cx="108" cy="212" r="7" fill="#ffe2b0" />
            <circle cx="108" cy="212" r="16" fill="#d9a441" opacity="0.25" />
          </g>
        )}
        {/* body */}
        <path
          d="M108 232 q-4 -46 44 -54 l30 -44 q7 -12 22 -12 h92 q15 0 22 12 l30 44 q48 8 44 54 z"
          fill="#b9563c"
        />
        <path d="M108 232 q-4 -46 44 -54 l30 -44 h12 l-26 46 q-44 10 -40 52 z" fill="#c9694a" />
        {/* glass */}
        <path d="M196 132 q-7 0 -11 7 l-22 38 h84 v-45 z" fill="#1a1030" />
        <path d="M258 132 h44 q9 0 13 8 l20 37 h-77 z" fill="#1a1030" />
        {/* whoever is driving, lit by their own phone */}
        <g transform="translate(212 154) scale(0.62)">
          <path d="M-24 46 q-4 -30 24 -30 q28 0 24 30 z" fill={look.cloth} />
          <g transform="translate(0 -2)">
            <Head mood={mood} look={look} />
          </g>
          <ellipse cx="34" cy="26" rx="20" ry="13" fill="#9fd4ff" opacity="0.18" />
          <rect x="26" y="16" width="14" height="24" rx="3" fill="#0d0d0f" />
          <rect x="27.5" y="18" width="11" height="20" rx="2" fill="#7fc1f5" opacity="0.65" />
        </g>
        {/* wheels */}
        {[168, 356].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="232" r="30" fill="#191125" />
            <motion.g style={{ rotate: wheel, originX: `${cx}px`, originY: '232px' }}>
              <circle cx={cx} cy="232" r="14" fill="#d9a441" />
              <rect x={cx - 1.6} y="216" width="3.2" height="32" fill="#8d5a12" />
              <rect x={cx - 16} y="230.4" width="32" height="3.2" fill="#8d5a12" />
            </motion.g>
          </g>
        ))}
        <ellipse cx="262" cy="266" rx="150" ry="10" fill="#0c0716" opacity="0.55" />
      </motion.g>
    </svg>
  )
}
