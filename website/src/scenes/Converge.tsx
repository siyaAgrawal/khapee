import { motion, useTransform } from 'framer-motion'
import { useCue, useScene } from '../lib/scene'
import { Line, Section } from '../components/Scene'
import { Timelines } from '../components/Timelines'
import { PhoneDemo } from '../components/Phone'

/**
 * The idea, on its own, with nothing else on screen.
 *
 * Every scene has shown this happening; this is the one place it is stated.
 * Two lines that were running in parallel move together until they are one
 * line, and at that moment arriving and being ready are the same event.
 */
export function Converge() {
  const { ref, t, lengthVh } = useScene(380)
  const rails = useCue(t, 0.12, 0.92)
  const head = useTransform(t, [0, 0.1, 0.2], [0, 1, 1])

  return (
    <Section id="idea" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-ink" />
      <motion.div className="absolute inset-x-0 top-[14vh] px-6 text-center" style={{ opacity: head }}>
        <p className="kicker">The whole idea</p>
        <h2 className="display mt-4" style={{ fontSize: 'clamp(28px,4.6vw,62px)' }}>
          Two clocks, running together.
        </h2>
      </motion.div>

      <div className="absolute inset-0 grid place-items-center px-6">
        <Timelines p={rails} />
      </div>

      <Line t={t} a={0.94} b={0.98} c={1} d={1.01} size="sm" place="bottom">
        Everything else makes you wait at the end. This waits at the start.
      </Line>
      <div className="vignette" />
    </Section>
  )
}

/**
 * The product itself, to be poked at.
 *
 * After four scenes of being shown what it does, the natural next question is
 * what it is actually like — so this is the real flow, tappable, on the same
 * screens the film used.
 */
export function Demo() {
  return (
    <section id="demo" className="relative py-[14vh] px-6">
      <div className="mx-auto max-w-[1080px] grid gap-[6vw] items-center md:grid-cols-[1fr_auto]">
        <div>
          <p className="kicker">The app</p>
          <h2 className="display mt-4" style={{ fontSize: 'clamp(30px,4.4vw,58px)' }}>
            Nine taps, from hungry to cooking.
          </h2>
          <p className="mt-6 text-ash max-w-[42ch] text-[16.5px] leading-relaxed">
            No download, no account. Scan the code on the table or find a place near you, pay by UPI
            straight to the restaurant, and watch it being made while you travel.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a className="cta cta-primary" href="https://khapee.com">Order with Khapee</a>
            <a className="cta cta-ghost" href="https://khapee.com/for-restaurants">I run a restaurant</a>
          </div>
        </div>
        <div className="justify-self-center">
          <PhoneDemo />
        </div>
      </div>
    </section>
  )
}
