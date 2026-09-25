import { motion, useMotionValue, useTransform, type MotionValue } from 'framer-motion'

/**
 * The cast.
 *
 * One construction used everywhere, so the person in the car and the person at
 * the counter are recognisably the same species of drawing. Warm skin, dark
 * clothing that sits down into a dark scene, and a single rim light down one
 * edge — which is what stops a flat figure reading as a sticker.
 *
 * The face is the point. Every expression here is built from transforms —
 * lids sliding down, brows tilting, a mouth scaling through flat into a smile
 * — rather than from swapping one drawing for another. Transforms interpolate
 * continuously, so an expression can be halfway, and halfway is where the
 * acting lives: the moment somebody's face starts to change as they see their
 * food is worth more than the smile it arrives at.
 *
 * `mood` runs 0 to 1: hungry and tired, through neutral, to genuinely pleased.
 */
export type Skin = { skin: string; hair: string; cloth: string; rim: string }

export const CAST: Record<string, Skin> = {
  driver: { skin: '#d79a63', hair: '#241a14', cloth: '#1f9e8c', rim: '#c98c33' },
  student: { skin: '#c1834f', hair: '#1c140f', cloth: '#b9563c', rim: 'var(--gold)' },
  worker: { skin: '#e0a978', hair: '#2b211a', cloth: 'var(--gold)', rim: '#7fae9f' },
  hurried: { skin: '#b0744a', hair: '#1a1310', cloth: '#8a9a55', rim: '#b9563c' },
  chef: { skin: '#cd9260', hair: '#1e1713', cloth: 'var(--porcelain)', rim: '#c98c33' },
}

export function Face({ mood, look }: { mood: MotionValue<number>; look: Skin }) {
  /* Tired eyes are half-shut. The lid is a shape that slides down over the
     eye rather than a different eye, so it can be anywhere in between. */
  const lid = useTransform(mood, [0, 1], [5.6, 0.6])
  /* Brows come down and in when somebody is flagging, and lift when they are
     not. This does more work than the mouth and is noticed less. */
  const browY = useTransform(mood, [0, 1], [1.8, -1.4])
  const browTilt = useTransform(mood, [0, 1], [11, -5])
  /* The mouth is one arc, scaled through flat. Negative is a frown, positive
     a smile, and zero is the unreadable line of somebody just existing. */
  const mouthFlip = useTransform(mood, [0, 0.42, 1], [-0.85, 0.06, 1])
  const mouthWide = useTransform(mood, [0, 1], [0.82, 1.12])
  const browTiltR = useTransform(browTilt, (v) => -v)
  /* Cheeks lift only at the top of the range, which is what separates a
     polite smile from a real one. */
  const cheek = useTransform(mood, [0.65, 1], [0, 0.5])

  return (
    <g>
      {/* brows */}
      <motion.g style={{ y: browY }}>
        <motion.rect
          x={-11.5} y={-9.5} width={9} height={1.9} rx={0.95}
          fill={look.hair} style={{ rotate: browTilt, originX: '50%', originY: '50%' }}
        />
        <motion.rect
          x={2.5} y={-9.5} width={9} height={1.9} rx={0.95}
          fill={look.hair}
          style={{ rotate: browTiltR, originX: '50%', originY: '50%' }}
        />
      </motion.g>

      {/* eyes, with a lid that can sit anywhere over them */}
      {[-7, 7].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={-3.4} rx={2.5} ry={2.9} fill="#15110e" />
          <circle cx={x - 0.8} cy={-4.4} r={0.8} fill="rgba(255,255,255,0.75)" />
          <motion.rect
            x={x - 3.2} y={-9.2} width={6.4} height={6} fill={look.skin}
            style={{ y: lid }}
          />
        </g>
      ))}

      {/* the bridge of a nose, one stroke */}
      <path d="M0 -2 q1.6 4 -1.4 5.4" stroke="rgba(0,0,0,0.22)" strokeWidth={1.1} fill="none" strokeLinecap="round" />

      {/* mouth */}
      <motion.path
        d="M-6 8 Q0 13.4 6 8"
        stroke="#4a2c20" strokeWidth={1.9} fill="none" strokeLinecap="round"
        style={{ scaleY: mouthFlip, scaleX: mouthWide, originX: '50%', originY: '8px' }}
      />
      <motion.g style={{ opacity: cheek }}>
        <ellipse cx={-11} cy={3.5} rx={3.6} ry={2.2} fill="#b9563c" opacity={0.5} />
        <ellipse cx={11} cy={3.5} rx={3.6} ry={2.2} fill="#b9563c" opacity={0.5} />
      </motion.g>
    </g>
  )
}

/** The head, with hair that reads at small sizes and a lit edge. */
export function Head({ mood, look, rim = true }: { mood: MotionValue<number>; look: Skin; rim?: boolean }) {
  return (
    <g>
      <ellipse cx={0} cy={0} rx={19} ry={21} fill={look.skin} />
      {/* the rim light: the whole reason these figures sit in a dark room */}
      {rim && <path d="M14 -15 q7 13 0 28 q5 -15 0 -28" fill={look.rim} opacity={0.5} />}
      <path d="M-19 -5 q1 -22 19 -22 q18 0 19 22 q-4 -13 -19 -13 q-15 0 -19 13 z" fill={look.hair} />
      <Face mood={mood} look={look} />
    </g>
  )
}

/**
 * A standing or walking figure, seen from the front.
 *
 * `stride` is the walk cycle's own phase, kept separate from the scene clock
 * so a figure can keep walking while the camera does something else. When it
 * is absent the figure simply stands, which is what it should do on arrival.
 */
export function Walker({
  mood,
  look,
  stride,
  carry,
}: {
  mood: MotionValue<number>
  look: Skin
  stride?: MotionValue<number>
  carry?: boolean
}) {
  /* A figure that is not walking still needs the same hooks, in the same
     order, every render — so the phase is a motion value either way and a
     standing figure simply holds at zero. */
  const still = useMotionValue(0)
  const phase = stride ?? still
  const legA = useTransform(phase, (v) => Math.sin(v * Math.PI * 2) * 17)
  const legB = useTransform(phase, (v) => -Math.sin(v * Math.PI * 2) * 17)
  const armA = useTransform(phase, (v) => -Math.sin(v * Math.PI * 2) * 13)
  const armB = useTransform(armA, (v) => -v)
  const bob = useTransform(phase, (v) => -Math.abs(Math.sin(v * Math.PI)) * 2.2)

  return (
    <motion.g style={{ y: bob }}>
      <ellipse cx={0} cy={150} rx={26} ry={5} fill="var(--s0)" opacity={0.5} />
      {/* legs */}
      <motion.g style={{ originX: '0px', originY: '78px', rotate: legA }}>
        <path d="M-7 78 q-2 38 -1 66" stroke="var(--s4)" strokeWidth={13} fill="none" strokeLinecap="round" />
      </motion.g>
      <motion.g style={{ originX: '0px', originY: '78px', rotate: legB }}>
        <path d="M7 78 q2 38 1 66" stroke="var(--s6)" strokeWidth={13} fill="none" strokeLinecap="round" />
      </motion.g>
      {/* torso */}
      <path d="M-22 82 q-4 -52 22 -52 q26 0 22 52 z" fill={look.cloth} />
      <path d="M17 34 q8 24 5 48 l-5 0 z" fill={look.rim} opacity={0.28} />
      {/* arms */}
      <motion.g style={{ originX: '0px', originY: '40px', rotate: armA }}>
        <path d="M-21 40 q-9 22 -6 38" stroke={look.cloth} strokeWidth={11} fill="none" strokeLinecap="round" />
      </motion.g>
      <motion.g style={{ originX: '0px', originY: '40px', rotate: armB }}>
        <path d="M21 40 q9 22 6 38" stroke={look.cloth} strokeWidth={11} fill="none" strokeLinecap="round" />
        {carry && (
          <g transform="translate(27 86)">
            <path d="M-15 -10 h30 l3 34 h-36 z" fill="#c98c33" />
            <path d="M-7 -10 q7 -10 14 0" stroke="#8f6426" strokeWidth={2.6} fill="none" strokeLinecap="round" />
            <rect x={-10} y={4} width={20} height={10} rx={2} fill="var(--porcelain)" opacity={0.9} />
          </g>
        )}
      </motion.g>
      {/* head */}
      <g transform="translate(0 6)">
        <rect x={-5} y={12} width={10} height={14} fill={look.skin} />
        <Head mood={mood} look={look} />
      </g>
    </motion.g>
  )
}
