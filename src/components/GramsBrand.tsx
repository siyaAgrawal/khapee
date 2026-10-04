/**
 * One Eighty Seven Grams' page header, in their own look: the butter-yellow
 * and cream stripes of their packaging as an awning across the top, then the
 * name set quietly in cobalt underneath. No badge, no boxes — the stripes are
 * the brand, and everything below them is set like a printed menu.
 */
export function GramsHero({
  isOpen,
  hours,
  prepMinutes,
  line,
}: {
  isOpen: boolean
  hours: string
  prepMinutes: number
  line?: string
}) {
  return (
    <header className="grams-hero">
      <div className="grams-awning" aria-hidden />
      <div className="grams-lockup">
        <p className="grams-eyebrow">Bakehouse · Indore</p>
        <h1 className="grams-word">
          <span className="grams-187">187</span> grams
        </h1>
        {line && <p className="grams-line">{line}</p>}
        <p className="grams-meta">
          <span className={isOpen ? 'grams-open' : 'grams-shut'}>{isOpen ? 'Taking orders' : 'Closed for orders'}</span>
          <span aria-hidden>·</span>
          <span>{hours}</span>
          <span aria-hidden>·</span>
          <span>Ready in ~{prepMinutes} min</span>
        </p>
      </div>
    </header>
  )
}
