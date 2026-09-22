/**
 * 28 Paarroo's mark and wordmark.
 *
 * Set in type rather than drawn. The other themed restaurants have a shape of
 * their own because they gave us one; inventing a logo here would be putting
 * a different restaurant's identity on this page and calling it theirs. The
 * number is the name, so the number is the mark.
 */
export function PaarrooMark({ size = 52 }: { size?: number }) {
  return (
    <span
      className="paarroo-mark"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      28
    </span>
  )
}

export function PaarrooWordmark() {
  return (
    <span className="paarroo-wordmark">
      <span className="paarroo-wordmark-name">28 Paarroo</span>
      <span className="paarroo-wordmark-rule" aria-hidden />
      <span className="paarroo-wordmark-line">South Indian &amp; Coffee</span>
    </span>
  )
}
