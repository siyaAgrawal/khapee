/**
 * Mr. Beans, in their own colours: the blush pink of their menu as a band
 * across the top, their brush-script logo with the gentleman (from mrbeans.in)
 * in espresso ink, and lowercase serif for the branch. Plain on purpose — one
 * colour, no shapes — with "takeaway only" said where it cannot be missed.
 */
export function MrBeansHero({
  name,
  isOpen,
  comingSoon,
  hours,
  prepMinutes,
  takeawayOnly,
}: {
  name: string
  isOpen: boolean
  comingSoon?: boolean
  hours: string
  prepMinutes: number
  takeawayOnly?: boolean
}) {
  // "Mr. Beans — Saket" → "Saket": the logo already says Mr. Beans.
  const branch = name.split(/\s[—–-]\s/)[1] ?? ''
  return (
    <header className="mb-hero">
      <div className="mb-band">
        <img className="mb-logo" src="/mrbeans-logo-ink.png" alt="Mr. Beans" width={180} height={131} />
        <p className="mb-since">bistro &amp; café · since 2002</p>
      </div>
      <div className="mb-intro">
        {branch && <h1 className="mb-branch">{branch.toLowerCase()}</h1>}
        {takeawayOnly && (
          <p className="mb-takeaway">
            <span aria-hidden>🥡</span> Takeaway only · collect at the counter
          </p>
        )}
        <p className="mb-meta">
          <span className={isOpen ? 'mb-open' : comingSoon ? 'mb-soon' : 'mb-shut'}>
            {isOpen ? 'Open now' : comingSoon ? 'Coming soon' : 'Closed'}
          </span>
          <span aria-hidden>·</span>
          <span>{hours}</span>
          <span aria-hidden>·</span>
          <span>~{prepMinutes} min</span>
        </p>
      </div>
    </header>
  )
}
