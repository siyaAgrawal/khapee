/**
 * One Eighty Seven Grams' mark and page header, built for them in their own
 * look: the round badge of butter-yellow and cream stripes with "187grams" in
 * cobalt blue, the soft serif, and the hand-written asides their posts use.
 * Drawn in code rather than an image, so it is sharp at every size.
 */
export function GramsMark({ size = 64 }: { size?: number }) {
  return (
    <span className="grams-mark" style={{ width: size, height: size }} aria-hidden>
      <span className="grams-mark-word" style={{ fontSize: Math.round(size * 0.2) }}>
        <span className="grams-187">187</span>grams
      </span>
    </span>
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
      <div className="grams-stripes" aria-hidden />
      <div className="grams-hero-body">
        <GramsMark size={92} />
        <h1 className="grams-name">
          One Eighty Seven <em>Grams</em>
        </h1>
        <p className="grams-line">Small-batch bakes, by a Le Cordon Bleu–trained baker.</p>
        <p className="grams-hand" aria-hidden>
          baked to order, mmm… <span className="grams-arrow">↓</span>
        </p>
        <div className="grams-meta">
          <span className={isOpen ? 'grams-open' : 'grams-shut'}>{isOpen ? 'Taking orders' : 'Closed for orders'}</span>
          <span>{hours}</span>
          <span>~{prepMinutes} min</span>
          <span>Collect · Indore</span>
        </div>
      </div>
    </header>
  )
}
