import { motion, useTransform } from 'framer-motion'
import { useCue, useLoop, useScene } from '../lib/scene'
import { Cue, Line, Section, Shot } from '../components/Scene'
import { Beats } from '../components/Beats'
import { CAST, Walker } from '../components/Figure'

/**
 * Taking it with you.
 *
 * All that survives of a whole takeaway scene that told the same story a third
 * time — the phone, the split screen, the kitchen, again. The one thing in it
 * that was not a repeat is this: a shelf with your name on a bag, and walking
 * past everybody who is still queueing.
 *
 * So it is a single beat, and it is short. The argument has already been made;
 * this is the other shape it takes.
 */
export function Pickup() {
  const { ref, t, lengthVh } = useScene(250)
  const loop = useLoop(1)

  const collect = useCue(t, 0.24, 0.72)
  const mood = useTransform(t, [0.2, 0.5, 0.8], [0.35, 0.6, 1])
  const stride = useTransform(loop, (v) => v * 1.7)

  return (
    <Section id="pickup" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />

      <Cue t={t} a={-0.06} b={0} c={0.1} d={0.16}>
        <span className="chip mb-5 block">Or take it with you</span>
        <span className="display block" style={{ fontSize: 'clamp(26px, min(5.2vw, 7.4vh), 74px)' }}>
          Past the queue.
          <br />
          <span className="text-gold">Not through it.</span>
        </span>
      </Cue>

      <Shot t={t} a={0.14} b={0.22} c={0.86} d={0.95} from={1.08} to={1}>
        <div className="absolute inset-0 flex flex-col" style={{ background: 'var(--s2)' }}>
          <div className="h-[16vh] shrink-0" />
          <div className="flex-1 grid place-items-center min-h-0 px-[4vw] pb-[10vh]">
            <svg viewBox="0 0 940 420" className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
              <rect width="940" height="420" fill="var(--s2)" />
              <rect y="320" width="940" height="100" fill="var(--s2)" />
              <rect y="317" width="940" height="3" fill="var(--s5)" />

              {/* the shelf, and the bag with a name on it */}
              <g transform="translate(700 104)">
                <rect x="-118" y="-46" width="236" height="32" rx="3" fill="#b9563c" />
                <text x="0" y="-24" textAnchor="middle" fontSize="13" letterSpacing="4"
                      fontWeight="700" fill="var(--porcelain)">PICK UP</text>
                <rect x="-118" y="0" width="236" height="150" rx="4" fill="var(--s4)" />
                <rect x="-118" y="70" width="236" height="6" fill="var(--s6)" />
                <rect x="-118" y="144" width="236" height="6" fill="var(--s6)" />

                {/* yours, until you take it */}
                <motion.g style={{ opacity: useTransform(collect, [0.42, 0.52], [1, 0]) }}>
                  <g transform="translate(-58 34)">
                    <path d="M-22 -50 h44 l5 50 h-54 z" fill="var(--gold)" />
                    <path d="M-11 -50 q11 -13 22 0" fill="none" stroke="#a87c26" strokeWidth="3.4" strokeLinecap="round" />
                    <rect x="-15" y="-26" width="30" height="14" rx="2" fill="var(--porcelain)" />
                  </g>
                  <motion.ellipse
                    cx="-58" cy="34" rx="58" ry="17" fill="var(--gold)"
                    style={{ opacity: useTransform(collect, [0, 0.42], [0.26, 0]) }}
                  />
                </motion.g>
                <g transform="translate(52 34)">
                  <path d="M-22 -50 h44 l5 50 h-54 z" fill="var(--s6)" />
                </g>
                <g transform="translate(-4 108)">
                  <path d="M-22 -50 h44 l5 50 h-54 z" fill="var(--s6)" />
                </g>
              </g>

              {/* the queue that is not moving */}
              {[
                { x: 150, s: 0.74, look: CAST.hurried },
                { x: 250, s: 0.8, look: CAST.driver },
              ].map((q) => (
                <g key={q.x} transform={`translate(${q.x} 148) scale(${q.s})`} opacity="0.5">
                  <Walker mood={useTransform(collect, () => 0.1)} look={q.look} />
                </g>
              ))}
              <rect x="96" y="286" width="230" height="8" rx="4" fill="var(--s6)" />

              {/* and you, going straight to the shelf and out again */}
              <motion.g style={{ x: useTransform(collect, [0, 0.5, 1], [-230, 0, 300]) }}>
                <g transform="translate(470 140) scale(0.94)">
                  <Walker
                    mood={mood}
                    look={CAST.worker}
                    stride={stride}
                    carry={false}
                  />
                </g>
                {/* the bag, once it is in the hand */}
                <motion.g
                  transform="translate(506 250)"
                  style={{ opacity: useTransform(collect, [0.46, 0.54], [0, 1]) }}
                >
                  <path d="M-17 -38 h34 l4 38 h-42 z" fill="var(--gold)" />
                  <path d="M-8 -38 q8 -10 16 0" fill="none" stroke="#a87c26" strokeWidth="3" strokeLinecap="round" />
                  <rect x="-11" y="-20" width="22" height="11" rx="2" fill="var(--porcelain)" />
                </motion.g>
              </motion.g>
            </svg>
          </div>
        </div>
      </Shot>

      <Line t={t} a={0.9} b={0.95} c={0.99} d={1.02} size="lg">
        Packed, labelled, <span className="text-gold">waiting.</span>
      </Line>

      <Beats
        sceneRef={ref}
        t={t}
        marks={[
          { at: 0.01, label: 'The queue' },
          { at: 0.34, label: 'Straight to it' },
          { at: 0.62, label: 'And out' },
        ]}
      />
      <div className="vignette" />
    </Section>
  )
}
