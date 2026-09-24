import { motion, useTransform, type MotionValue } from 'framer-motion'

/**
 * The signature idea, drawn.
 *
 * Two things are happening at once and neither of them is waiting for the
 * other: a person travelling, and food being made. Every other ordering
 * product runs them end to end — you arrive, and then you wait — and this one
 * runs them side by side.
 *
 * So the two timelines start apart, fill at their own pace, and physically
 * move toward each other until they are the same line. That convergence is
 * the product. Nothing else on the page has to explain it afterwards.
 */
const YOURS = ['Leaving', 'On the way', 'Nearly there', 'Arrived']
const FOOD = ['Order received', 'Cooking', 'Packed', 'Ready']

export function Timelines({ p, compact = false }: { p: MotionValue<number>; compact?: boolean }) {
  /* They drift together across the middle of the scene and meet at the end. */
  const gap = useTransform(p, [0, 0.72, 1], [compact ? 54 : 92, compact ? 54 : 92, 0])
  const merged = useTransform(p, [0.86, 1], [0, 1])
  const labelOut = useTransform(p, [0.86, 1], [1, 0])
  const fill = useTransform(p, [0.06, 0.9], ['0%', '100%'])

  return (
    <div className="w-full" style={{ maxWidth: compact ? 460 : 760 }}>
      <motion.div style={{ marginBottom: gap }}>
        <Rail title="Your journey" marks={YOURS} p={p} fill={fill} labelOut={labelOut} />
      </motion.div>
      <Rail title="Your food" marks={FOOD} p={p} fill={fill} labelOut={labelOut} align="right" />

      {/* what the convergence means, said once, at the moment it happens */}
      <motion.p
        className="display text-center mt-7"
        style={{ opacity: merged, fontSize: compact ? 22 : 34 }}
      >
        <span className="text-gold">Arrived</span>
        <span className="text-ash mx-3">=</span>
        <span className="text-gold">Ready</span>
      </motion.p>
    </div>
  )
}

function Rail({
  title,
  marks,
  p,
  fill,
  labelOut,
  align = 'left',
}: {
  title: string
  marks: string[]
  p: MotionValue<number>
  fill: MotionValue<string>
  labelOut: MotionValue<number>
  align?: 'left' | 'right'
}) {
  return (
    <div>
      <motion.p className={`kicker mb-3 ${align === 'right' ? 'text-right' : ''}`} style={{ opacity: labelOut }}>
        {title}
      </motion.p>
      <div className="rail">
        <motion.div className="rail-fill" style={{ width: fill }} />
        <div className="absolute inset-0 flex justify-between items-center">
          {marks.map((m, i) => (
            <Node key={m} label={m} at={0.06 + (i / (marks.length - 1)) * 0.84} p={p} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Node({ label, at, p }: { label: string; at: number; p: MotionValue<number> }) {
  const on = useTransform(p, [at - 0.02, at], [0, 1])
  return (
    <div className="relative">
      <motion.span className="node block" style={{ opacity: useTransform(on, [0, 1], [0.6, 1]) }} />
      <motion.span
        className="absolute left-1/2 -translate-x-1/2 top-4 whitespace-nowrap text-[10.5px] text-ash"
        style={{ opacity: on }}
      >
        {label}
      </motion.span>
      {/* the node lights only once its step has actually happened */}
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{
          opacity: on,
          background: '#d9a441',
          boxShadow: '0 0 16px rgba(217,164,65,0.9)',
        }}
      />
    </div>
  )
}
