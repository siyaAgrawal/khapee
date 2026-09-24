import { motion, useTransform } from 'framer-motion'
import { useCue, useScene } from '../lib/scene'
import { Band, Section, Shot } from '../components/Scene'
import { Beats } from '../components/Beats'
import { Confetti } from '../components/Confetti'
import { CAST, Walker } from '../components/Figure'

/**
 * The end.
 *
 * Somebody walks in, the food is already on the table, the confetti goes off
 * once, and then a plain field of colour with the name on it. That is the
 * whole scene and the whole ending — there is no logo shot, no calls to
 * action stacked underneath, nothing after the punchline.
 *
 * The line sits in a band the picture never enters. It used to be floated over
 * the middle of the frame, which put words across the one thing the scene
 * exists to show.
 */
export function Arrival() {
  const { ref, t, lengthVh } = useScene(380)

  const arrival = useCue(t, 0.12, 0.6)
  const mood = useTransform(t, [0.1, 0.4, 0.62], [0.3, 0.55, 1])

  return (
    <Section id="end" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />

      <Shot t={t} a={-0.06} b={0} c={0.82} d={0.9} from={1.08} to={1}>
        <div className="absolute inset-0 flex flex-col">
          {/* the strip kept for the words */}
          <div className="h-[19vh] shrink-0" />
          <div className="flex-1 grid place-items-center min-h-0 px-[3vw] pb-[8vh]">
            <svg viewBox="0 0 900 430" className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
              <rect width="900" height="430" fill="#191125" />
              <rect y="262" width="900" height="168" fill="#241735" />
              <rect y="259" width="900" height="3" fill="#33215a" />

              {/* the door at the back, open on the street */}
              <rect x="612" y="54" width="132" height="208" rx="4" fill="#2e1d44" />
              <motion.rect
                x="622" y="64" width="112" height="188" rx="3" fill="#d9a441"
                style={{ opacity: useTransform(arrival, [0, 0.5], [0.3, 0.1]) }}
              />
              <line x1="300" y1="0" x2="300" y2="34" stroke="#3a2752" strokeWidth="3" />
              <path d="M268 34 h64 l-15 28 h-34 z" fill="#b9563c" />

              {/* the table, laid, with the food on it and hot */}
              <g transform="translate(300 276)">
                <rect x="-128" y="0" width="256" height="9" rx="4" fill="#5a3f78" />
                <rect x="-74" y="9" width="9" height="86" fill="#452c68" />
                <rect x="65" y="9" width="9" height="86" fill="#452c68" />
                <motion.ellipse
                  cy="-4" rx="76" ry="17" fill="#d9a441"
                  style={{ opacity: useTransform(arrival, [0, 1], [0, 0.22]) }}
                />
                <ellipse cy="-6" rx="52" ry="16" fill="#f4ede1" />
                <ellipse cy="-9" rx="37" ry="11" fill="#e0d3bc" />
                <ellipse cy="-11" rx="26" ry="7.5" fill="#b9563c" />
                <path d="M52 -30 h22 l-4 26 h-14 z" fill="#8a7fb0" opacity="0.55" />
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
                <g transform="translate(560 104) scale(0.92)">
                  <Walker mood={mood} look={CAST.worker} />
                </g>
              </motion.g>
            </svg>
          </div>
        </div>
      </Shot>

      <Band t={t} a={-0.06} b={0} c={0.5} d={0.58}>
        Long day. <span className="text-gold">Short wait.</span>
      </Band>

      <Band t={t} a={0.58} b={0.64} c={0.8} d={0.88}>
        Your order was <span className="text-gold">already here.</span>
      </Band>

      {/* the only celebration on the page, once */}
      <motion.div
        className="absolute inset-0 z-30 pointer-events-none"
        style={{ opacity: useTransform(t, [0.6, 0.66, 0.84, 0.9], [0, 1, 1, 0]) }}
      >
        <Confetti p={useCue(t, 0.62, 0.9)} />
      </motion.div>

      {/* and then nothing but the colour, and the name */}
      <motion.div
        className="absolute inset-0 z-40 grid place-items-center bg-night"
        style={{ opacity: useTransform(t, [0.86, 0.93], [0, 1]) }}
      >
        <p className="display text-center px-6" style={{ fontSize: 'clamp(34px, min(7.4vw, 11vh), 104px)' }}>
          That&rsquo;s <span className="text-gold">Khapee.</span>
        </p>
      </motion.div>

      <Beats
        sceneRef={ref}
        t={t}
        marks={[
          { at: 0.01, label: 'Walking in' },
          { at: 0.6, label: 'Already here' },
          { at: 0.88, label: 'Khapee' },
        ]}
      />
      <div className="vignette" />
    </Section>
  )
}
