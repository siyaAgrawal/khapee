import { PhoneDemo } from '../components/Phone'

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
