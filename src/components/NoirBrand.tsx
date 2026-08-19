/**
 * La Tavola's mark. Drawn rather than uploaded so it stays crisp at any size
 * and costs nothing to load: a plate seen from above with a single blade across
 * it, which is about as much as a monogram can carry before it turns into a
 * logo quiz.
 */
export function NoirMark({ size = 44 }: { size?: number }) {
  return (
    <svg
      className="noir-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="La Tavola Noir"
    >
      {/* the plate */}
      <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="1.1" opacity="0.42" />
      <circle cx="24" cy="24" r="15.5" stroke="currentColor" strokeWidth="0.8" opacity="0.22" />
      {/* the blade, cutting the plate on the diagonal */}
      <path
        d="M14.5 33.5 L30 18a3.6 3.6 0 0 1 5.1 5.1L19.6 38.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx="24" cy="24" r="2.1" fill="currentColor" />
    </svg>
  )
}

/**
 * The wordmark. Set in the serif the rest of the theme uses, with NOIR spaced
 * out underneath so the two lines read as one lockup rather than a title and a
 * subtitle.
 */
export function NoirWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`noir-wordmark ${compact ? 'compact' : ''}`}>
      <span className="noir-wordmark-la">La Tavola</span>
      <span className="noir-wordmark-rule" aria-hidden />
      <span className="noir-wordmark-noir">Noir</span>
    </span>
  )
}
