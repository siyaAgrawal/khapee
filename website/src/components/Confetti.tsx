import { motion, useTransform, type MotionValue } from 'framer-motion'

/**
 * The one moment on the page worth celebrating.
 *
 * Not decoration. It fires exactly once, on the line that the whole film has
 * been building to — you walked in and the food was already there — and
 * nowhere else. Confetti that appears more than once is a party popper; used
 * once, at the payoff, it is the feeling being described.
 *
 * Deterministic rather than random, so it behaves the same every time somebody
 * scrolls back over it. A burst that is different on the second viewing reads
 * as a glitch rather than as a memory.
 */
const PIECES = Array.from({ length: 54 }, (_, i) => {
  /* A cheap deterministic spread — no seeding library, and stable across
     reloads because it is only arithmetic on the index. */
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1
  const angle = r(1) * Math.PI * 2
  return {
    angle,
    reach: 120 + r(2) * 360,
    drop: 180 + r(3) * 340,
    spin: (r(4) - 0.5) * 900,
    size: 5 + r(5) * 8,
    long: r(6) > 0.5,
    delay: r(7) * 0.22,
    tone: ['var(--gold)', 'var(--cream)', 'var(--clay)', 'var(--accent)'][Math.floor(r(8) * 4)],
  }
})

export function Confetti({ p }: { p: MotionValue<number> }) {
  return (
    <div className="absolute inset-0 z-30 overflow-hidden pointer-events-none" aria-hidden>
      {PIECES.map((c, i) => (
        <Piece key={i} c={c} p={p} />
      ))}
    </div>
  )
}

function Piece({ c, p }: { c: (typeof PIECES)[number]; p: MotionValue<number> }) {
  /* Each piece runs its own slightly later clock, so the burst has a front
     edge rather than everything leaving at once. */
  const k = useTransform(p, [c.delay, 1], [0, 1], { clamp: true })
  const x = useTransform(k, (v) => Math.cos(c.angle) * c.reach * v)
  /* Up first, then gravity takes it — which is why the fall is squared. */
  const y = useTransform(k, (v) => Math.sin(c.angle) * c.reach * v * 0.55 + c.drop * v * v)
  const rotate = useTransform(k, (v) => c.spin * v)
  const opacity = useTransform(k, [0, 0.08, 0.72, 1], [0, 1, 1, 0])

  return (
    <motion.span
      className="absolute left-1/2 top-1/2 block"
      style={{
        x,
        y,
        rotate,
        opacity,
        width: c.long ? c.size * 0.45 : c.size,
        height: c.long ? c.size * 1.9 : c.size,
        background: c.tone,
        borderRadius: 1,
      }}
    />
  )
}
