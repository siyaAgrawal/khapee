import { motion, useTransform } from 'framer-motion'
import { useCue, useScene } from '../lib/scene'
import { Cue, Line, Section, Shot, Warmth } from '../components/Scene'
import { PhoneFilm, usePhoneStep } from '../components/Phone'
import { Car } from '../components/Car'
import { Kitchen } from '../components/Kitchen'
import { CAST, Walker } from '../components/Figure'
import { Timelines } from '../components/Timelines'

/**
 * Scene one: the drive.
 *
 * The whole product in a single continuous take. Somebody hungry in a car
 * orders and pays; the camera pulls out of the phone and into the street; the
 * kitchen starts while they are still driving; they arrive and the food is
 * already on the pass.
 *
 * The scene is deliberately long — it is worth five screens of scrolling —
 * because the point being made is about time, and rushing it would prove the
 * opposite of what it is claiming.
 */
export function Drive() {
  const { ref, t, lengthVh } = useScene(560)

  /* The face, across the whole scene: tired and hungry at the start, and
     genuinely pleased at the moment the food is there. Nothing about this is
     a cut — it is one number moving, which is why it reads as a person. */
  const mood = useTransform(t, [0, 0.22, 0.3, 0.8, 0.92], [0.05, 0.05, 0.4, 0.45, 1])

  /* The car: still, pulling away, cruising, then slowing into the kerb. */
  const speed = useTransform(t, [0.3, 0.4, 0.74, 0.82], [0, 1, 1, 0])

  const phone = usePhoneStep(t, [
    [0, 'location'],
    [0.055, 'nearby'],
    [0.095, 'restaurant'],
    [0.13, 'menu'],
    [0.165, 'item'],
    [0.2, 'cart'],
    [0.235, 'paying'],
    [0.265, 'paid'],
    [0.42, 'cooking'],
    [0.76, 'ready'],
  ])

  const kitchen = useCue(t, 0.36, 0.8)
  const rails = useCue(t, 0.34, 0.86)
  const arrival = useCue(t, 0.84, 1)
  const warm = useTransform(t, [0.36, 0.5, 0.86, 1], [0, 0.55, 0.55, 1])

  /* The pull out of the phone and into the street: the phone grows and goes
     as the car comes in behind it, so there is never a frame of nothing. */
  const phoneScale = useTransform(t, [0.26, 0.34], [1, 2.4])

  return (
    <Section id="drive" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />
      <Warmth o={warm} />

      {/*
        ---- in the car, ordering ----
        The picture holds the frame and the words arrive over it in sequence,
        one at a time, the way a title card does. A static column of copy beside
        the phone was tried and it stopped being a film the moment it appeared —
        it read as a landing page with an animation on it.

        The phone sits right of centre so the words have somewhere to live.
      */}
      <Shot t={t} a={-0.06} b={0} c={0.26} d={0.34} from={1.06} to={1}>
        <motion.div
          style={{ scale: phoneScale }}
          className="relative sm:translate-x-[26%] md:translate-x-[34%]"
        >
          {/* the colour a lit screen actually throws in a dark car */}
          <div className="absolute -inset-12" style={{ background: 'rgba(217,164,65,0.1)' }} aria-hidden />
          <PhoneFilm step={phone} />
        </motion.div>
      </Shot>

      {/* the words, in order, each getting the frame to itself */}
      <Cue t={t} a={-0.06} b={0} c={0.06} d={0.1}>
        <span className="chip mb-5 block">Indore, 8:40pm</span>
        <span className="display block" style={{ fontSize: 'clamp(30px, min(6.2vw, 9vh), 88px)' }}>
          Hungry,
          <br />
          and twenty
          <br />
          minutes <span className="text-gold">away.</span>
        </span>
      </Cue>

      <Cue t={t} a={0.1} b={0.13} c={0.17} d={0.2}>
        <span className="display block" style={{ fontSize: 'clamp(24px, min(4.6vw, 7vh), 62px)' }}>
          So you order
          <br />
          on the way.
        </span>
      </Cue>

      <Cue t={t} a={0.205} b={0.23} c={0.26} d={0.285}>
        <span className="display block" style={{ fontSize: 'clamp(22px, min(4vw, 6vh), 54px)' }}>
          ₹250, by UPI.
        </span>
        <span className="block mt-4 text-[15px] text-dust/70 max-w-[30ch]">
          Straight into the restaurant&rsquo;s own account.
          <span className="text-sage"> No commission, no middleman.</span>
        </span>
      </Cue>

      <Line t={t} a={0.285} b={0.31} c={0.335} d={0.36} size="lg">
        &ldquo;Keep it ready. I&rsquo;m coming.&rdquo;
      </Line>

      {/* ---- the road, and the kitchen, at the same time ---- */}
      <Shot t={t} a={0.3} b={0.38} c={0.8} d={0.88} from={1.1} to={1}>
        <div className="w-full h-full grid grid-rows-2 md:grid-rows-1 md:grid-cols-2">
          <div className="relative overflow-hidden">
            <Car speed={speed} mood={mood} look={CAST.driver} />
            <span className="absolute left-6 top-6 kicker">You</span>
          </div>
          <motion.div className="relative overflow-hidden border-l border-white/5" style={{ opacity: kitchen }}>
            <Kitchen p={kitchen} />
            <span className="absolute left-6 top-6 kicker">Cafe Vijay Bhaiya</span>
          </motion.div>
        </div>
      </Shot>

      {/* the two clocks, running together under the picture */}
      <motion.div
        className="absolute left-0 right-0 bottom-[7vh] z-20 flex justify-center px-6 pointer-events-none"
        style={{ opacity: rails }}
      >
        <Timelines p={useCue(t, 0.36, 0.9)} compact />
      </motion.div>

      <Line t={t} a={0.5} b={0.55} c={0.62} d={0.68} size="sm" place="top">
        You are driving. It is cooking. Neither of you is waiting.
      </Line>

      {/* ---- arriving ---- */}
      <Shot t={t} a={0.82} b={0.9} c={0.97} d={1} from={1.16} to={1}>
        <svg viewBox="0 0 900 460" className="w-full h-full" aria-hidden>
          <rect width="900" height="460" fill="#191125" />
          <rect y="340" width="900" height="120" fill="#241735" />
          {/* the front of the restaurant, lit */}
          <rect x="120" y="70" width="660" height="272" rx="6" fill="#2e1d44" />
          <rect x="150" y="104" width="600" height="150" rx="4" fill="#140d20" />
          <motion.rect x="150" y="104" width="600" height="150" rx="4" fill="#d9a441" style={{ opacity: arrival }} opacity={0.12} />
          <rect x="392" y="40" width="116" height="34" rx="6" fill="#382550" />
          <text x="450" y="63" textAnchor="middle" fontSize="15" letterSpacing="4" fill="#d9a441" fontWeight="600">OPEN</text>
          {/* the pass, seen through the window, with one bag on it */}
          <rect x="520" y="212" width="200" height="7" rx="3.5" fill="#5a3f78" />
          <g transform="translate(610 212)">
            <path d="M-22 -50 h44 l5 50 h-54 z" fill="#b9563c" />
            <rect x="-15" y="-28" width="30" height="13" rx="2" fill="#f4ede1" opacity="0.9" />
            <motion.ellipse cy="0" rx="54" ry="16" fill="#d9a441" style={{ opacity: arrival }} opacity={0.3} />
          </g>
          {/* the door, and somebody coming through it */}
          <rect x="196" y="176" width="104" height="166" rx="4" fill="#3a2752" />
          <motion.g style={{ x: useTransform(arrival, [0, 1], [-120, 0]) }}>
            <g transform="translate(300 190) scale(0.92)">
              <Walker mood={mood} look={CAST.driver} />
            </g>
          </motion.g>
        </svg>
      </Shot>

      <Line t={t} a={0.9} b={0.94} c={0.965} d={0.985} size="xl">
        You arrived. Your food was already here.
      </Line>
      <Line t={t} a={0.975} b={0.99} c={1} d={1.01} size="xl">
        That&rsquo;s Khapee.
      </Line>

      <div className="vignette" />
    </Section>
  )
}
