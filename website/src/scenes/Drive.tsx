import { motion, useTransform } from 'framer-motion'
import { useCue, useScene } from '../lib/scene'
import { Cue, Line, Section, Shot } from '../components/Scene'
import { Beats } from '../components/Beats'
import { Confetti } from '../components/Confetti'
import { PhoneFilm, usePhoneStep } from '../components/Phone'
import { Car } from '../components/Car'
import { Kitchen } from '../components/Kitchen'
import { CAST, Walker } from '../components/Figure'

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
  const { ref, t, lengthVh } = useScene(900)

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
  const arrival = useCue(t, 0.84, 1)

  /* The pull out of the phone and into the street: the phone grows and goes
     as the car comes in behind it, so there is never a frame of nothing. */
  const phoneScale = useTransform(t, [0.26, 0.34], [1, 2.4])

  return (
    <Section id="drive" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />

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
          className="relative sm:translate-x-[52%] md:translate-x-[46%] lg:translate-x-[38%]"
        >
          <PhoneFilm step={phone} />
        </motion.div>
      </Shot>

      {/* the words, in order, each getting the frame to itself */}
      <Cue t={t} a={-0.06} b={0} c={0.06} d={0.1}>
        <span className="chip mb-5 block">Indore, 8:40pm</span>
        {/*
          The thesis, up front and in seven words. It opened on "Hungry, and
          twenty minutes away", which is a situation rather than an argument —
          true of everybody, and it says nothing. This inverts the thing
          everybody has accepted without noticing they accepted it.
        */}
        <span className="display block" style={{ fontSize: 'clamp(30px, min(6.2vw, 9vh), 88px)' }}>
          The food should
          <br />
          be the one
          <br />
          <span className="text-gold">waiting.</span>
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
        <div className="split">
          <div>
            <Car speed={speed} mood={mood} look={CAST.driver} />
            <span className="absolute left-6 top-6 kicker">You</span>
          </div>
          <motion.div className="" style={{ opacity: kitchen }}>
            <Kitchen p={kitchen} />
            <span className="absolute left-6 top-6 kicker">Cafe Vijay Bhaiya</span>
          </motion.div>
        </div>
      </Shot>

      <Line t={t} a={0.5} b={0.55} c={0.62} d={0.68} size="sm" place="top">
        You are driving. It is cooking. Neither of you is waiting.
      </Line>

      {/*
        ---- inside, and it is already on the table ----
        Shot from within the room rather than from the street. The front of the
        restaurant was correct and said nothing: the whole point is the plate
        sitting on the table before the person reaches it, and you cannot see a
        table from outside. They come through the door at the back and walk to
        food that is already steaming.
      */}
      <Shot t={t} a={0.82} b={0.9} c={0.97} d={1} from={1.16} to={1}>
        <svg viewBox="0 0 900 460" className="w-full h-full" aria-hidden>
          <rect width="900" height="460" fill="#191125" />
          <rect y="286" width="900" height="174" fill="#241735" />
          <rect y="283" width="900" height="3" fill="#33215a" />

          {/* the door at the back, standing open on the street */}
          <rect x="612" y="78" width="132" height="208" rx="4" fill="#2e1d44" />
          <motion.rect
            x="622" y="88" width="112" height="188" rx="3" fill="#d9a441"
            style={{ opacity: useTransform(arrival, [0, 0.5], [0.3, 0.1]) }}
          />
          {/* a hanging lamp over the table */}
          <line x1="300" y1="0" x2="300" y2="58" stroke="#3a2752" strokeWidth="3" />
          <path d="M268 58 h64 l-15 28 h-34 z" fill="#b9563c" />

          {/* the table, laid, with the food on it and hot */}
          <g transform="translate(300 300)">
            <rect x="-128" y="0" width="256" height="9" rx="4" fill="#5a3f78" />
            <rect x="-74" y="9" width="9" height="86" fill="#452c68" />
            <rect x="65" y="9" width="9" height="86" fill="#452c68" />
            <motion.ellipse cy="-4" rx="76" ry="17" fill="#d9a441" opacity={0.14} style={{ opacity: useTransform(arrival, [0, 1], [0, 0.22]) }} />
            <ellipse cy="-6" rx="52" ry="16" fill="#f4ede1" />
            <ellipse cy="-9" rx="37" ry="11" fill="#e0d3bc" />
            <ellipse cy="-11" rx="26" ry="7.5" fill="#b9563c" />
            <path d="M52 -30 h22 l-4 26 h-14 z" fill="#8a7fb0" opacity="0.55" />
            {/* steam, so it reads as food that has just been put down */}
            <g transform="translate(0 -26)">
              {[-13, 0, 13].map((x, i) => (
                <motion.path
                  key={x}
                  d={`M${x} 0 c${i % 2 ? 5 : -5} -7 ${i % 2 ? -5 : 5} -11 0 -18`}
                  stroke="#d9a441" strokeWidth="2.6" fill="none" strokeLinecap="round"
                  style={{ opacity: useTransform(arrival, [0.25, 0.7], [0, 0.55]) }}
                />
              ))}
            </g>
          </g>

          {/* and the person, crossing the room to it */}
          <motion.g style={{ x: useTransform(arrival, [0, 1], [230, 0]) }}>
            <g transform="translate(560 128) scale(0.92)">
              <Walker mood={mood} look={CAST.driver} />
            </g>
          </motion.g>
        </svg>
      </Shot>

      {/* the payoff, and the only celebration on the page */}
      <motion.div
        className="absolute inset-0 z-30 pointer-events-none"
        style={{ opacity: useTransform(t, [0.895, 0.91, 0.985, 1], [0, 1, 1, 0]) }}
      >
        <Confetti p={useCue(t, 0.9, 1)} />
      </motion.div>

      <Line t={t} a={0.9} b={0.94} c={0.965} d={0.985} size="xl" place="top">
        You arrived. Your food was <span className="text-gold">already here.</span>
      </Line>
      <Line t={t} a={0.975} b={0.99} c={1} d={1.01} size="xl">
        That&rsquo;s Khapee.
      </Line>

      <Beats sceneRef={ref} t={t} marks={[{ at: 0.02, label: 'Hungry' }, { at: 0.12, label: 'Ordering' }, { at: 0.23, label: 'Paid' }, { at: 0.42, label: 'On the way' }, { at: 0.66, label: 'Cooking' }, { at: 0.88, label: 'Arrived' }]} />
      <div className="vignette" />
    </Section>
  )
}
