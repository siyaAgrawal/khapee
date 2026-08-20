/**
 * Lotus Hut's mark: a lotus seen from above, drawn as a hut roof.
 *
 * The name is the whole idea, so the mark is both at once — five petals that
 * also read as a pitched roof over an open front. Drawn rather than
 * photographed so it stays crisp on a printed zone sign as well as a phone.
 */
export function HutMark({ size = 48 }: { size?: number }) {
  return (
    <svg
      className="hut-mark"
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      role="img"
      aria-label="Lotus Hut"
    >
      {/* the roof, which is also the outer petal */}
      <path
        d="M6 30 28 11l22 19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* inner petals */}
      <path
        d="M14 30c0-7 6-12.5 14-12.5S42 23 42 30"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.72"
      />
      <path d="M28 17.5V30" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
      {/* the counter, open to the road */}
      <path d="M10 30h36v12a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 37h36" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
    </svg>
  )
}

/**
 * The wordmark. LOTUS spaced wide over HUT in the serif — a small place that
 * takes itself seriously, which is exactly the brief.
 */
export function HutWordmark() {
  return (
    <span className="hut-wordmark">
      <span className="hut-wordmark-lotus">Lotus</span>
      <span className="hut-wordmark-hut">Hut</span>
      <span className="hut-wordmark-line" aria-hidden />
      <span className="hut-wordmark-since">Indore · open late</span>
    </span>
  )
}
