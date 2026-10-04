/**
 * One Eighty Seven Grams, set from their own pieces.
 *
 * Everything here is lifted from the bakery's Instagram rather than invented:
 * the wide butter-and-cream stripes behind "187grams" are their profile
 * picture; the condensed serif capitals with a bold arrow, the tight black
 * sans beside a cobalt italic, the outlined pill and the empty ○ bullet are
 * their "We are hiring!" post; the line icons on cream circles are their story
 * highlights; the little smile with its tongue out is drawn on their box.
 */

const Arrow = () => (
  <svg className="grams-arrow" viewBox="0 0 22 14" aria-hidden>
    <path d="M1 7h15M11 1.8 17.6 7 11 12.2" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/* The three story-highlight icons, in the same thin cobalt line. */
const Sparkle = () => (
  <svg viewBox="0 0 40 32" aria-hidden>
    <path d="M18 3c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9Z" />
    <path d="M32 9c.4 2.4 1.2 3.2 3.6 3.6-2.4.4-3.2 1.2-3.6 3.6-.4-2.4-1.2-3.2-3.6-3.6 2.4-.4 3.2-1.2 3.6-3.6Z" />
    <path d="M7 20c.4 2.2 1 2.8 3.2 3.2-2.2.4-2.8 1-3.2 3.2-.4-2.2-1-2.8-3.2-3.2 2.2-.4 2.8-1 3.2-3.2Z" />
  </svg>
)
const Bell = () => (
  <svg viewBox="0 0 40 32" aria-hidden>
    <path d="M20 4v2.5M13 22V15a7 7 0 0 1 14 0v7M10 22h20M17.5 25.5a2.6 2.6 0 0 0 5 0" />
    <path d="M7 12c-1.4 2.6-1.4 5.4 0 8M33 12c1.4 2.6 1.4 5.4 0 8" />
  </svg>
)
const Gift = () => (
  <svg viewBox="0 0 40 32" aria-hidden>
    <path d="M10 13h20v4H10zM12 17h16v11H12zM20 13v15" />
    <path d="M20 13c-2-5-8-6-8-2.6 0 2 3 2.6 8 2.6ZM20 13c2-5 8-6 8-2.6 0 2-3 2.6-8 2.6Z" />
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

        <ul className="grams-highlights">
          <li>
            <span className="grams-bubble">
              <Sparkle />
              <span>Baked fresh</span>
            </span>
          </li>
          <li className={isOpen ? '' : 'is-shut'}>
            <span className="grams-bubble">
              <Bell />
              <span>{isOpen ? 'Open now' : 'Closed'}</span>
            </span>
          </li>
          <li>
            <span className="grams-bubble">
              <Gift />
              <span>Gifting</span>
            </span>
          </li>
        </ul>

        <p className="grams-field">
          <span className="grams-pill">Collect</span>
          <span className="grams-field-line">
            {hours} · ready in ~{prepMinutes} min
          </span>
        </p>
      </div>
    </header>
  )
}
