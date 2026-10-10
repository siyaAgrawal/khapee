/**
 * Mr. Beans, in the look of their own new menu.
 *
 * The pieces are theirs: the brush-script "Mr Beans" with the gentleman in the
 * top hat (the logo from mrbeans.in, white on transparent), the sage-olive
 * green and cream the menu is printed on, its lowercase serif headings, and
 * the wavy scalloped edge that finishes its pages. Since 2002, and Times Food
 * Award winners — both from their own site.
 */
export function MrBeansHero({
  name,
  isOpen,
  comingSoon,
  hours,
  prepMinutes,
}: {
  name: string
  isOpen: boolean
  comingSoon?: boolean
  hours: string
  prepMinutes: number
}) {
  // "Mr. Beans — Saket" → "Saket": the logo already says Mr. Beans.
  const branch = name.split(/\s[—–-]\s/)[1] ?? ''
  return (
    <header className="mb-hero">
      <div className="mb-band">
        <img className="mb-logo" src="/mrbeans-logo.png" alt="Mr. Beans" width={180} height={131} />
        <p className="mb-since">bistro &amp; café · since 2002</p>
      </div>
      <div className="mb-intro">
        {branch && <h1 className="mb-branch">{branch.toLowerCase()}</h1>}
        <p className="mb-line">Fresh bakes, all-day breakfast, hand-rolled pastas &amp; pizzas, and a whole lot of coffee.</p>
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
