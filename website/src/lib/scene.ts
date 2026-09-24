import { useEffect, useRef } from 'react'
import {
  useAnimationFrame,
  useMotionValue,
  useScroll,
  useTransform,
  type MotionValue,
} from 'framer-motion'
import Lenis from 'lenis'

/**
 * The film's clock.
 *
 * Each scene is a tall section with a pinned, screen-height stage inside it.
 * Scrolling through the section does not move the stage — it advances a single
 * number from 0 to 1, and everything on that stage is a function of that
 * number. That is the whole architecture, and it is what makes the result feel
 * like continuous footage rather than a stack of slides: there is no moment
 * where one thing ends and another begins, only a timeline being scrubbed.
 *
 * @param lengthVh how much scrolling the scene is worth. Longer means the
 *   action plays more slowly under the same wheel movement — this is the pace
 *   control, and it is the one number worth tuning by feel.
 */
export function useScene(lengthVh = 320) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    // Starts the instant the section's top meets the viewport's top (which is
    // when the stage pins) and finishes as its bottom does (when it unpins).
    offset: ['start start', 'end end'],
  })
  return { ref, t: scrollYProgress, lengthVh }
}

/**
 * A cue: one thing's slice of the scene's timeline, as its own 0→1.
 *
 * Beats are written as windows of the parent scene — "the car pulls away
 * between 18% and 40%" — so a beat can be moved or stretched without
 * recalculating everything after it. Clamped, so a cue that has not started
 * sits at its opening frame and one that has finished holds its last.
 */
export function useCue(t: MotionValue<number>, from: number, to: number): MotionValue<number> {
  return useTransform(t, [from, to], [0, 1], { clamp: true })
}

/** A cue that goes out as well as in: 0 → 1 → 0 across four marks. */
export function useHold(
  t: MotionValue<number>,
  a: number,
  b: number,
  c: number,
  d: number,
): MotionValue<number> {
  return useTransform(t, [a, b, c, d], [0, 1, 1, 0], { clamp: true })
}

/**
 * Smooth scrolling, because the story is scrubbed rather than paged.
 *
 * A native wheel event arrives as a jump of sixty or a hundred pixels, and a
 * timeline driven straight from that steps rather than flows — every camera
 * move and every expression change lands in visible increments. Lenis puts a
 * spring between the wheel and the scroll position, which is the difference
 * between footage and a flip-book.
 *
 * Switched off entirely for anybody who has asked for reduced motion: taking
 * over someone's scrolling is exactly the kind of thing that setting exists to
 * refuse, and the page reads perfectly well scrolled normally.
 */
export function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Nor on touch: a phone's own scrolling is already smooth, and momentum
    // fought over by the browser and a library feels broken in the hand.
    if (window.matchMedia('(pointer: coarse)').matches) return

    const lenis = new Lenis({ duration: 1.05, wheelMultiplier: 0.9, touchMultiplier: 1.6 })
    let frame = 0
    const raf = (time: number) => {
      lenis.raf(time)
      frame = requestAnimationFrame(raf)
    }
    frame = requestAnimationFrame(raf)
    return () => {
      cancelAnimationFrame(frame)
      lenis.destroy()
    }
  }, [])
}

/**
 * A clock that runs on its own, for things that move whether or not you do.
 *
 * Wheels turn, steam rises, a chef stirs. Tying those to the scroll would mean
 * a kitchen that freezes the moment somebody stops reading, which is the exact
 * tell that a page is a diagram of a restaurant rather than a restaurant.
 *
 * Returns a motion value counting seconds, so callers can take whatever cycle
 * they need from it.
 */
export function useLoop(speed = 1): MotionValue<number> {
  const clock = useMotionValue(0)
  useAnimationFrame((time) => clock.set((time / 1000) * speed))
  return clock
}
