/**
 * One Eighty Seven Grams, set from their own pieces.
 *
 * Everything here is lifted from the bakery's Instagram rather than invented:
 * the wide butter-and-cream stripes behind "187grams" are their profile
 * picture; the condensed serif capitals with a bold arrow, the tight black
 * sans beside a cobalt italic, the outlined pill and the empty ○ bullet are
 * their "We are hiring!" post; the little smile with its tongue out is drawn
 * on their box.
 */

const Arrow = () => (
  <svg className="grams-arrow" viewBox="0 0 22 14" aria-hidden>
    <path d="M1 7h15M11 1.8 17.6 7 11 12.2" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** The smile with its tongue out, from the side of their box. */
export function GramsYum({ className = '' }: { className?: string }) {
  return (
    <svg className={`grams-yum ${className}`} viewBox="0 0 60 20" aria-hidden>
      <path d="M3 5c8 9 30 10 52 1" />
      <path d="M33 10.6c-.4 4.4 1.4 6.9 4.2 6.9s4-2.8 3.4-7.7" />
    </svg>
  )
}

export function GramsHero({
  isOpen,
  hours,
  prepMinutes,
}: {
  isOpen: boolean
  hours: string
  prepMinutes: number
}) {
  return (
    <header className="grams-hero">
      <div className="grams-banner">
        <h1 className="grams-logo" aria-label="187 grams">
          187grams
        </h1>
      </div>

      <div className="grams-intro">
        <p className="grams-kicker">
          <Arrow /> One Eighty Seven Grams · Indore
        </p>
        <p className="grams-title">
          <span className="grams-title-plain">Small-batch bakes,</span>
          <em className="grams-title-em">made to order!</em>
        </p>
        <p className="grams-by">From a Le Cordon Bleu–trained kitchen.</p>

        <p className="grams-field">
          <span className="grams-pill">Collect</span>
          <span className="grams-field-line">
            <span className={isOpen ? 'grams-open' : 'grams-shut'}>{isOpen ? 'Open now' : 'Closed'}</span> · {hours} · ~
            {prepMinutes} min
          </span>
        </p>
      </div>
    </header>
  )
}
