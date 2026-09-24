import { motion, useTransform, type MotionValue } from 'framer-motion'
import { useHold } from '../lib/scene'

/**
 * A scene: a tall section with the picture pinned inside it.
 *
 * The section's height is how much scrolling the scene is worth; the stage
 * inside never moves. Scrolling therefore does not move the page past the
 * picture — it runs the picture.
 */
export function Section({
  sceneRef,
  lengthVh,
  children,
  id,
}: {
  sceneRef: React.RefObject<HTMLElement>
  lengthVh: number
  children: React.ReactNode
  id?: string
}) {
  return (
    <section id={id} ref={sceneRef as React.RefObject<HTMLDivElement>} style={{ height: `${lengthVh}vh` }}>
      <div className="stage">{children}</div>
    </section>
  )
}

/**
 * A shot: something visible for part of the scene, with a camera move on it.
 *
 * Shots overlap rather than cut. `scale` running slightly through the shot is
 * what sells it as footage — a completely still frame in the middle of moving
 * ones reads as a slide that got stuck.
 */
export function Shot({
  t,
  a,
  b,
  c,
  d,
  from = 1,
  to = 1,
  children,
  className = '',
}: {
  t: MotionValue<number>
  a: number
  b: number
  c: number
  d: number
  from?: number
  to?: number
  children: React.ReactNode
  className?: string
}) {
  const opacity = useHold(t, a, b, c, d)
  const scale = useTransform(t, [a, d], [from, to])
  return (
    <motion.div
      className={`absolute inset-0 grid place-items-center ${className}`}
      style={{ opacity, scale }}
    >
      {children}
    </motion.div>
  )
}

/**
 * A line of the script.
 *
 * Short, large, and gone again. The film is making the argument; anything
 * here that explains the film is an admission the film did not work.
 */
export function Line({
  t,
  a,
  b,
  c,
  d,
  children,
  size = 'lg',
  place = 'center',
}: {
  t: MotionValue<number>
  a: number
  b: number
  c: number
  d: number
  children: React.ReactNode
  size?: 'sm' | 'lg' | 'xl'
  place?: 'center' | 'bottom' | 'top'
}) {
  const opacity = useHold(t, a, b, c, d)
  const y = useTransform(t, [a, d], [14, -14])
  const font =
    size === 'xl'
      ? 'clamp(30px, min(7vw, 11vh), 92px)'
      : size === 'lg'
        ? 'clamp(21px, min(4.2vw, 6.6vh), 56px)'
        : 'clamp(15px, min(2.2vw, 3vh), 26px)'
  const pos =
    place === 'bottom'
      ? 'items-end pb-[10vh]'
      : place === 'top'
        ? 'items-start pt-[12vh]'
        : 'items-center'

  return (
    <motion.div
      className={`absolute inset-0 z-20 flex justify-center px-6 pointer-events-none ${pos}`}
      style={{ opacity, y }}
    >
      <p
        className={
          size === 'sm'
            ? 'display text-center text-dust/85 max-w-[34ch]'
            : 'display text-center max-w-[18ch]'
        }
        style={{ fontSize: font }}
      >
        {children}
      </p>
    </motion.div>
  )
}

/**
 * The warmth a scene gains once there is food in it.
 *
 * Twice wrong before this. First as a soft radial glow, which is the single
 * most generated-looking object on the web — every one of those pages has a
 * coloured blur behind the hero. Then as a hard-edged ellipse of solid gold,
 * which was worse: a blob sitting on top of the picture.
 *
 * What it is now is a band of warm colour lying along the floor of the frame,
 * with a straight edge, the way a screen-printed poster adds a second colour.
 * It is capped low on purpose — this is meant to be felt rather than seen, and
 * the moment anybody notices the layer itself it has failed.
 */
export function Warmth({ o }: { o: MotionValue<number>; x?: string; y?: string }) {
  const held = useTransform(o, [0, 1], [0, 0.16])
  return (
    <motion.div
      className="warmth"
      style={{ opacity: held, background: 'var(--gold)', top: '62%' }}
    />
  )
}

/**
 * A cue: words that take the left of the frame while the picture holds the rest.
 *
 * Distinct from Line, which centres a single statement over everything. A cue
 * is copy with structure in it — a label, a headline, a line of detail — and
 * it sits where the picture is not, so the two never fight. This is the shape
 * the opening of a scene wants: something to read, and something to watch,
 * neither on top of the other.
 */
export function Cue({
  t,
  a,
  b,
  c,
  d,
  children,
}: {
  t: MotionValue<number>
  a: number
  b: number
  c: number
  d: number
  children: React.ReactNode
}) {
  const opacity = useHold(t, a, b, c, d)
  const y = useTransform(t, [a, d], [18, -18])
  return (
    <motion.div
      className="absolute inset-y-0 left-0 z-20 flex flex-col justify-center pl-[7vw] pr-[6vw] sm:pr-0 sm:max-w-[46vw] pointer-events-none"
      style={{ opacity, y }}
    >
      {children}
    </motion.div>
  )
}

/**
 * The caption band at the top of a split-screen shot.
 *
 * White, and in a strip of its own that the picture never enters. The line
 * used to be a muted grey floated over the middle of the frame, where it sat
 * on top of whichever half happened to be busy — so it was both hard to read
 * and in the way. A band reserved for it costs a sixth of the height and the
 * words are legible for it.
 */
export function Band({
  t,
  a,
  b,
  c,
  d,
  children,
}: {
  t: MotionValue<number>
  a: number
  b: number
  c: number
  d: number
  children: React.ReactNode
}) {
  const opacity = useHold(t, a, b, c, d)
  return (
    <motion.div
      className="absolute inset-x-0 top-0 h-[16vh] z-20 flex items-center justify-center px-8 pointer-events-none"
      style={{ opacity }}
    >
      <p
        className="display text-center text-cream"
        style={{ fontSize: 'clamp(16px, min(2.4vw, 3.2vh), 28px)' }}
      >
        {children}
      </p>
    </motion.div>
  )
}
