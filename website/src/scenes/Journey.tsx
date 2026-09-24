import { motion, useTransform } from 'framer-motion'
import { useCue, useScene } from '../lib/scene'
import { Band, Cue, Section, Shot } from '../components/Scene'
import { Beats } from '../components/Beats'
import { PhoneFilm, usePhoneStep } from '../components/Phone'
import { Car } from '../components/Car'
import { Kitchen } from '../components/Kitchen'
import { CAST } from '../components/Figure'

/**
 * The story, once.
 *
 * This was three scenes — a drive, the end of school, the end of a shift —
 * each making the identical argument with the identical pictures. Three times
 * is not emphasis, it is a page somebody stops scrolling through. So it is one
 * journey now, told properly and at length: the end of a long day, an order
 * placed on the way out, the road and the kitchen running together, and
 * walking in to food already on the table.
 *
 * The two clocks stay because they are the clearest thing on the page — you
 * down one side, the kitchen down the other, both filling at once.
 */
const YOU = ['Leaving the office', '5 min away', '2 min away', 'Pulling in']
const THEM = ['Order received', 'On the range', 'Packing', 'On the pass']

export function Journey() {
  const { ref, t, lengthVh } = useScene(520)

  /* One face across the whole thing: flat out at the start, and genuinely
     pleased at the moment the food is in front of them. */
  const mood = useTransform(t, [0, 0.2, 0.3, 0.74, 0.88], [0.03, 0.03, 0.35, 0.42, 1])
  const speed = useTransform(t, [0.32, 0.42, 0.7, 0.78], [0, 1, 1, 0])
  const kitchen = useCue(t, 0.34, 0.76)
  const pair = useCue(t, 0.82, 0.99)

  const phone = usePhoneStep(t, [
    [0, 'location'],
    [0.07, 'nearby'],
    [0.1, 'restaurant'],
    [0.13, 'menu'],
    [0.16, 'item'],
    [0.19, 'cart'],
    [0.22, 'paying'],
    [0.25, 'paid'],
    [0.4, 'cooking'],
    [0.72, 'ready'],
  ])

  return (
    <Section id="journey" sceneRef={ref} lengthVh={lengthVh}>
      <div className="absolute inset-0 bg-night" />

      {/*
        ---- clocking off ----
        Nothing but the words and the phone. There was an office block behind
        the copy and it was doing no work: the line says the day is over, which
        is the whole of what the building was there to establish, and a dim
        drawing behind text is just something for the eye to trip on.
      */}
      <Shot t={t} a={-0.06} b={0} c={0.28} d={0.34} from={1.05} to={1}>
        {/* and the phone, with the right half to itself */}
        <div className="absolute inset-y-0 right-0 w-1/2 grid place-items-center px-[3vw]">
          <PhoneFilm step={phone} scale={0.92} />
        </div>
      </Shot>

      <Cue t={t} a={-0.06} b={0} c={0.07} d={0.12}>
        <span className="chip mb-5 block">Vijay Nagar, 9:10pm</span>
        <span className="display block" style={{ fontSize: 'clamp(26px, min(5.2vw, 7.4vh), 74px)' }}>
          The work is over.
          <br />
          <span className="text-gold">Your wait is not.</span>
        </span>
      </Cue>

      <Cue t={t} a={0.15} b={0.19} c={0.24} d={0.29}>
        <span className="display block" style={{ fontSize: 'clamp(21px, min(3.8vw, 5.4vh), 50px)' }}>
          &ldquo;We&rsquo;ll have your order
          <br />
          ready <span className="text-gold">for you.</span>&rdquo;
        </span>
      </Cue>

      {/* ---- the road and the kitchen, on one clock ---- */}
      <Shot t={t} a={0.3} b={0.36} c={0.78} d={0.84} from={1.06} to={1}>
        <div className="absolute inset-0 flex flex-col" style={{ background: '#1e1636' }}>
          <div className="h-[19vh] shrink-0" />
          <div className="flex-1 grid place-items-center min-h-0">
            <div className="split">
              <div style={{ background: '#1b1330' }}>
                <Car speed={speed} mood={mood} look={CAST.worker} />
                <span className="absolute left-9 top-6 kicker">You</span>
              </div>
              <div style={{ background: '#241a3d' }}>
                <Kitchen p={kitchen} />
                <span className="absolute left-9 top-6 kicker">Cafe Vijay Bhaiya</span>
              </div>
            </div>
          </div>
        </div>
      </Shot>

      <Band t={t} a={0.36} b={0.42} c={0.74} d={0.8}>
        Both of you started at the same time.{' '}
        <span className="text-gold">Neither of you is waiting.</span>
      </Band>

      {/*
        ---- you, and them, on one clock ----
        Its own beat rather than a strip crushed under the split screen. This
        is the clearest statement of the idea on the whole page — two columns
        filling at the same time — and it was being read as a caption.
      */}
      <Shot t={t} a={0.78} b={0.84} c={0.97} d={1.02} from={1.04} to={1}>
        <div className="w-full max-w-[900px] px-[6vw] grid grid-cols-2 gap-x-[6vw]">
          <Column title="You" marks={YOU} p={pair} big />
          <Column title="Khapee" marks={THEM} p={pair} align="right" big />
        </div>
      </Shot>

      <Band t={t} a={0.8} b={0.86} c={0.97} d={1.02}>
        Two clocks. <span className="text-gold">One finish line.</span>
      </Band>

      <Beats
        sceneRef={ref}
        t={t}
        marks={[
          { at: 0.01, label: 'Clocking off' },
          { at: 0.15, label: 'Ordering' },
          { at: 0.36, label: 'Both moving' },
          { at: 0.6, label: 'Cooking' },
          { at: 0.8, label: 'You vs Khapee' },
        ]}
      />
      <div className="vignette" />
    </Section>
  )
}

/** One side of the pair of clocks. */
function Column({
  title,
  marks,
  p,
  align = 'left',
  big = false,
}: {
  title: string
  marks: string[]
  p: ReturnType<typeof useCue>
  align?: 'left' | 'right'
  big?: boolean
}) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p className="kicker mb-5" style={big ? { fontSize: 13 } : undefined}>{title}</p>
      <div className={big ? 'space-y-4' : 'space-y-1.5'}>
        {marks.map((m, i) => (
          <Mark key={m} label={m} at={0.1 + (i / marks.length) * 0.8} p={p} align={align} big={big} />
        ))}
      </div>
    </div>
  )
}

function Mark({
  label,
  at,
  p,
  align,
  big = false,
}: {
  label: string
  at: number
  p: ReturnType<typeof useCue>
  align: 'left' | 'right'
  big?: boolean
}) {
  const on = useTransform(p, [at - 0.06, at], [0.18, 1])
  return (
    <motion.p
      className={`flex items-center gap-3 ${big ? 'text-[clamp(15px,2.2vw,26px)]' : 'text-[13px]'} ${
        align === 'right' ? 'justify-end' : ''
      }`}
      style={{ opacity: on }}
    >
      {align === 'right' && <span className="text-cream">{label}</span>}
      <motion.span className="node" style={{ opacity: on }} />
      {align === 'left' && <span className="text-cream">{label}</span>}
    </motion.p>
  )
}
