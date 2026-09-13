/**
 * Revery's mark: a sprig under a string of lights.
 *
 * Both halves of the place in one figure — the plants it is full of, and the
 * lights strung over them that are the reason the photographs look the way they
 * do. Drawn rather than cropped from a photo so it stays clean at any size.
 */
export function ReveryMark({ size = 50 }: { size?: number }) {
  return (
    <svg
      className="revery-mark"
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      role="img"
      aria-label="Revery"
    >
      {/* the strung wire, and four bulbs hanging off it */}
      <path d="M4 13c8 7 16 7 24 0s16-7 24 0" stroke="currentColor" strokeWidth="1.1" opacity="0.55" strokeLinecap="round" />
      {[12, 22, 34, 44].map((x, i) => {
        const y = [17, 20, 20, 17][i]
        return (
          <g key={x}>
            <path d={`M${x} ${y - 4}v3`} stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
            <circle cx={x} cy={y + 1} r="2.1" fill="currentColor" opacity={i % 2 ? 0.55 : 0.9} />
          </g>
        )
      })}
      {/* the sprig */}
      <path d="M28 50V28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M28 34c-5 0-8-2.6-8.5-7 4.6-.6 8 1.8 8.5 7Zm0 0c5 0 8-2.6 8.5-7-4.6-.6-8 1.8-8.5 7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M28 43c-4 0-6.4-2-6.8-5.6 3.7-.5 6.4 1.4 6.8 5.6Zm0 0c4 0 6.4-2 6.8-5.6-3.7-.5-6.4 1.4-6.8 5.6Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        opacity="0.75"
      />
    </svg>
  )
}

/** The wordmark: the name in the serif, over the line the café runs on. */
export function ReveryWordmark() {
  return (
    <span className="revery-wordmark">
      <span className="revery-wordmark-name">Revery</span>
      <span className="revery-wordmark-line" aria-hidden />
      <span className="revery-wordmark-sub">Garden café · Indore</span>
    </span>
  )
}
