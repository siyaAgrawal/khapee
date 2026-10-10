/**
 * Mr. Beans, in the look of their own printed menu.
 *
 * The pieces are theirs: the brush-script "Mr Beans" with the gentleman in the
 * top hat (the logo from mrbeans.in, redrawn in their espresso ink), the
 * blush-pink arch their desserts page sits in, the line sketches from the
 * menu (the cake, the sandwich), its lowercase serif headings, and the wavy
 * "~~~" rules that set off its little captions. Since 2002 — from their site.
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
      <div className="mb-arch">
        <img className="mb-logo" src="/mrbeans-logo-ink.png" alt="Mr. Beans" width={180} height={131} />
        <p className="mb-since">
          <span className="mb-wave" aria-hidden />
          bistro &amp; café · since 2002
          <span className="mb-wave" aria-hidden />
        </p>
        <img className="mb-cake" src="/mrbeans-cake.png" alt="" aria-hidden width={132} height={112} />
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

/** The sandwich from their sandwiches page, between the header and the menu. */
export function MrBeansSketch() {
  return <img className="mb-sketch" src="/mrbeans-sandwich.png" alt="" aria-hidden width={222} height={135} />
}
