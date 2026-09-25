import { useEffect, useLayoutEffect, useState } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, type MotionValue } from 'framer-motion'

/**
 * The product, on a screen.
 *
 * Ten states of the real ordering flow. They are used two ways and it is the
 * same component both times: driven by the scroll clock inside a film scene,
 * and driven by taps in the demo lower down. Building it twice would have
 * meant the demo drifting away from the film within a week, and a page whose
 * two phones disagree about the product is worse than a page with one.
 */
export const STEPS = [
  'location',
  'nearby',
  'restaurant',
  'menu',
  'item',
  'cart',
  'paying',
  'paid',
  'cooking',
  'ready',
] as const
export type Step = (typeof STEPS)[number]

const W = 268
const H = 560

/**
 * How big the phone can be here.
 *
 * A fixed 560px phone is taller than a laptop's usable height once a masthead
 * and a chapter bar are on screen, and on a short window it simply ran off the
 * bottom. The film has to fit whatever it is being watched on, so the phone is
 * measured against the window rather than assumed.
 */
export function useFit(): number {
  const [s, setS] = useState(1)
  useLayoutEffect(() => {
    const measure = () =>
      setS(Math.max(0.5, Math.min(1, (window.innerHeight - 170) / H)))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return s
}

export function PhoneShell({ children, scale = 1 }: { children: React.ReactNode; scale?: number }) {
  return (
    <div className="phone-shell" style={{ width: W * scale + 14, transform: `translateZ(0)` }}>
      <div className="phone-screen" style={{ width: W * scale, height: H * scale }}>
        <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/* --- pieces of the interface ----------------------------------------- */

/**
 * The status bar.
 *
 * The time used to be hard-coded to 9:41, which is the time Apple puts on
 * every phone in every keynote — so it is the one detail that tells anybody
 * who recognises it that this is a mockup rather than a screenshot. It reads
 * the real clock now, which costs nothing and is never wrong.
 */
function useClock() {
  const [now, setNow] = useState(() => clockFace())
  useEffect(() => {
    const id = setInterval(() => setNow(clockFace()), 20_000)
    return () => clearInterval(id)
  }, [])
  return now
}

const clockFace = () =>
  new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[ap]\.?m\.?/i, '')

function Bar() {
  const now = useClock()
  return (
    <div className="flex items-center justify-between px-5 pt-3 pb-1 text-[10px] text-ash">
      <span className="font-semibold text-cream">{now}</span>
      <span className="flex gap-1 items-center">
        <span className="inline-block w-3.5 h-1.5 rounded-sm bg-cream/70" />
        <span className="inline-block w-4 h-2 rounded-[2px] border border-cream/50" />
      </span>
    </div>
  )
}

function Btn({ label, onClick, tone = 'solid' }: { label: string; onClick?: () => void; tone?: 'solid' | 'line' }) {
  return (
    <button
      onClick={onClick}
      className={`tap-target w-full rounded-xl py-3 text-[13px] font-semibold ${
        tone === 'solid' ? 'bg-gold text-ink' : 'border border-cream/20 text-cream'
      }`}
    >
      {label}
    </button>
  )
}

const Row = ({ name, note, price, on }: { name: string; note: string; price: string; on?: boolean }) => (
  <div
    className={`flex items-center gap-3 rounded-xl p-2.5 ${on ? 'bg-gold/12 ring-1 ring-gold/40' : 'bg-white/[0.035]'}`}
  >
    <div className="w-9 h-9 rounded-md bg-clay shrink-0" />
    <div className="min-w-0 flex-1">
      <p className="text-[12.5px] text-cream font-medium truncate">{name}</p>
      <p className="text-[10.5px] text-ash truncate">{note}</p>
    </div>
    <span className="text-[12px] text-cream/90">{price}</span>
  </div>
)

/* --- the screens ------------------------------------------------------ */

function ScreenBody({ step, act }: { step: Step; act: (s: Step) => void }) {
  switch (step) {
    case 'location':
      return (
        <div className="px-5 pt-8">
          <p className="kicker">Khapee</p>
          <h4 className="display text-[26px] mt-3 leading-tight">Where are you?</h4>
          <div className="mt-6 h-40 rounded-2xl bg-white/[0.04] relative overflow-hidden">
            <div className="absolute inset-0 opacity-30"
                 style={{ backgroundImage: 'linear-gradient(#ffffff14 1px,transparent 1px),linear-gradient(90deg,#ffffff14 1px,transparent 1px)', backgroundSize: '26px 26px' }} />
            <motion.div
              className="absolute left-1/2 top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-gold"
              animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 1.6, repeat: Infinity }}
            />
            <motion.div
              className="absolute left-1/2 top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border border-gold"
              animate={{ scale: [1, 4], opacity: [0.7, 0] }} transition={{ duration: 1.8, repeat: Infinity }}
            />
          </div>
          <p className="text-[12px] text-ash mt-4">Saket · Indore</p>
          <div className="mt-4"><Btn label="Find food near me" onClick={() => act('nearby')} /></div>
        </div>
      )
    case 'nearby':
      return (
        <div className="px-5 pt-6">
          <p className="kicker">Near you</p>
          <h4 className="display text-[22px] mt-2">3 places ready when you are</h4>
          <div className="mt-4 space-y-2">
            <button className="tap-target w-full text-left" onClick={() => act('restaurant')}>
              <Row name="Cafe Vijay Bhaiya" note="400 m · ready in 9 min" price="4.6★" on />
            </button>
            <Row name="Shyam Sandwich" note="1.1 km · ready in 12 min" price="4.4★" />
            <Row name="28 Paarroo" note="2.3 km · ready in 15 min" price="4.7★" />
          </div>
        </div>
      )
    case 'restaurant':
      return (
        <div>
          <div className="h-32 bg-clay relative">
            <div className="absolute inset-0 bg-ink/30" />
          </div>
          <div className="px-5 -mt-6 relative">
            <h4 className="display text-[22px]">Cafe Vijay Bhaiya</h4>
            <p className="text-[11px] text-ash mt-1">Saket · 400 m · open till 11pm</p>
            <div className="mt-4"><Btn label="Order ahead" onClick={() => act('menu')} /></div>
          </div>
        </div>
      )
    case 'menu':
      return (
        <div className="px-5 pt-6">
          <div className="flex gap-2 mb-3">
            {['All', 'Chai', 'Maggi', 'Rolls'].map((c, i) => (
              <span key={c} className={`text-[10.5px] px-2.5 py-1 rounded-full ${i === 0 ? 'bg-cream text-ink' : 'bg-white/[0.06] text-ash'}`}>{c}</span>
            ))}
          </div>
          <div className="space-y-2">
            <button className="tap-target w-full text-left" onClick={() => act('item')}>
              <Row name="Masala Maggi" note="Hot, buttery, ten minutes" price="₹110" on />
            </button>
            <Row name="Masala Chai" note="Cutting or full" price="₹30" />
            <Row name="Paneer Roll" note="Tawa-fried" price="₹140" />
          </div>
        </div>
      )
    case 'item':
      return (
        <div>
          <div className="h-36 bg-clay" />
          <div className="px-5 pt-4">
            <h4 className="display text-[22px]">Masala Maggi</h4>
            <p className="text-[11px] text-ash mt-1">Hot, buttery, ten minutes.</p>
            <div className="flex items-center justify-between mt-5">
              <span className="text-[18px] text-cream">₹110</span>
              <span className="flex items-center gap-3 text-[13px] text-cream bg-white/[0.06] rounded-full px-3 py-1.5">
                <span className="text-ash">−</span> 2 <span>+</span>
              </span>
            </div>
            <div className="mt-5"><Btn label="Add to order · ₹220" onClick={() => act('cart')} /></div>
          </div>
        </div>
      )
    case 'cart':
      return (
        <div className="px-5 pt-6">
          <p className="kicker">Your order</p>
          <div className="mt-3 space-y-2">
            <Row name="2 × Masala Maggi" note="Cafe Vijay Bhaiya" price="₹220" />
            <Row name="1 × Masala Chai" note="Cutting" price="₹30" />
          </div>
          <div className="flex justify-between mt-5 pt-4 border-t border-white/10 text-[13px]">
            <span className="text-ash">Total</span><span className="text-cream font-semibold">₹250</span>
          </div>
          <p className="text-[10.5px] text-ash mt-3">Pay now and it starts cooking before you arrive.</p>
          <div className="mt-3"><Btn label="Order & pay" onClick={() => act('paying')} /></div>
        </div>
      )
    case 'paying':
      return (
        <div className="px-5 pt-14 text-center">
          <motion.div
            className="mx-auto w-12 h-12 rounded-full border-2 border-gold border-t-transparent"
            animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-[13px] text-cream mt-6">Paying ₹250 by UPI</p>
          <p className="text-[11px] text-ash mt-1.5">Straight to the restaurant. No commission.</p>
        </div>
      )
    case 'paid':
      return (
        <div className="px-5 pt-12 text-center">
          <motion.svg viewBox="0 0 80 80" className="mx-auto w-16 h-16"
            initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 16 }}>
            <circle cx="40" cy="40" r="33" fill="none" stroke="var(--accent)" strokeWidth="3" />
            <motion.path d="M25 41 L35 52 L56 28" fill="none" stroke="var(--accent)" strokeWidth="4.5"
              strokeLinecap="round" strokeLinejoin="round"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.15 }} />
          </motion.svg>
          <p className="display text-[19px] mt-5">Payment successful</p>
          <p className="text-[12px] text-ash mt-2">We&rsquo;re getting your order ready.</p>
        </div>
      )
    case 'cooking':
      return (
        <div className="px-5 pt-7">
          <p className="kicker">Order #8F3K</p>
          <h4 className="display text-[21px] mt-2">Being made now</h4>
          <div className="mt-6 space-y-3.5">
            {[['Order received', true], ['Cooking', true], ['Packed', false], ['Ready', false]].map(([l, on], i) => (
              <div key={i} className="flex items-center gap-3">
                <span className={`node ${on ? 'on' : ''}`} />
                <span className={`text-[12px] ${on ? 'text-cream' : 'text-ash'}`}>{l as string}</span>
              </div>
            ))}
          </div>
          <div className="mt-7 rounded-xl bg-white/[0.04] p-3.5">
            <p className="text-[11px] text-ash">Ready in</p>
            <p className="display text-[26px] text-gold">6 min</p>
            <p className="text-[10.5px] text-ash mt-1">You arrive in 7.</p>
          </div>
        </div>
      )
    case 'ready':
      return (
        <div className="px-5 pt-8 text-center">
          <motion.div
            className="mx-auto w-20 h-20 rounded-full grid place-items-center"
            style={{ background: 'rgba(217,164,65,0.14)' }}
            animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 2.2, repeat: Infinity }}
          >
            <span className="text-[34px]">🥡</span>
          </motion.div>
          <p className="display text-[23px] mt-4">Your order is waiting</p>
          <p className="text-[12px] text-ash mt-2">Counter 2 · show this code</p>
          <p className="display text-[30px] tracking-[0.2em] text-gold mt-3">8F3K</p>
        </div>
      )
  }
}

/** The film's phone: a step is handed to it, and it cuts cleanly. */
export function PhoneFilm({ step, scale = 1 }: { step: Step; scale?: number }) {
  const fit = useFit()
  return (
    <PhoneShell scale={scale * fit}>
      <Bar />
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: [0.3, 0, 0.2, 1] }}
        >
          <ScreenBody step={step} act={() => {}} />
        </motion.div>
      </AnimatePresence>
    </PhoneShell>
  )
}

/**
 * Turns the scene clock into a screen.
 *
 * State rather than a motion value on purpose: a screen is a discrete thing,
 * and a phone cannot be 40% of the way between the cart and the payment sheet.
 * The subscription is to the clock, so nothing re-renders between steps.
 */
export function usePhoneStep(t: MotionValue<number>, marks: [number, Step][]) {
  const [step, setStep] = useState<Step>(marks[0][1])
  useMotionValueEvent(t, 'change', (v) => {
    let next = marks[0][1]
    for (const [at, s] of marks) if (v >= at) next = s
    setStep(next)
  })
  return step
}

/**
 * The demo: the same screens, driven by fingers.
 *
 * It advances itself where the real product would — a payment that is being
 * processed, a kitchen that is cooking — because a button labelled "simulate
 * the kitchen" is an admission that this is a mockup.
 */
export function PhoneDemo() {
  const [step, setStep] = useState<Step>('location')

  useEffect(() => {
    if (step === 'paying') {
      const id = setTimeout(() => setStep('paid'), 1500)
      return () => clearTimeout(id)
    }
    if (step === 'paid') {
      const id = setTimeout(() => setStep('cooking'), 1900)
      return () => clearTimeout(id)
    }
    if (step === 'cooking') {
      const id = setTimeout(() => setStep('ready'), 3200)
      return () => clearTimeout(id)
    }
  }, [step])

  return (
    <div className="flex flex-col items-center gap-5">
      <PhoneShell>
        <Bar />
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -14 }}
            transition={{ duration: 0.26, ease: [0.3, 0, 0.2, 1] }}
          >
            <ScreenBody step={step} act={setStep} />
          </motion.div>
        </AnimatePresence>
      </PhoneShell>

      <div className="flex items-center gap-2">
        {STEPS.map((s) => (
          <button
            key={s}
            aria-label={s}
            onClick={() => setStep(s)}
            className="tap-target h-1.5 rounded-full transition-all"
            style={{
              width: s === step ? 22 : 7,
              background: s === step ? 'var(--accent)' : 'rgba(243,239,230,0.22)',
            }}
          />
        ))}
      </div>
      <p className="text-[11.5px] text-ash">
        {step === 'ready' ? (
          <button className="underline underline-offset-4" onClick={() => setStep('location')}>Run it again</button>
        ) : (
          'Tap the screen to move through it'
        )}
      </p>
    </div>
  )
}
