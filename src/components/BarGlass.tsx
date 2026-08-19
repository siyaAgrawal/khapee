/**
 * One drawn glass per kind of drink.
 *
 * The bar list gets an illustration per group rather than a photograph per
 * bottle: thirty photographs of similar bottles is a worse menu than eight
 * clean marks, and these stay on the restaurant's own line-and-brass look
 * instead of importing someone else's photography.
 */
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const GLASSES: Record<string, JSX.Element> = {
  // Rocks glass, straight sides, a measure of spirit and one large cube.
  Whisky: (
    <>
      <path d="M15 16h26l-2.5 26a3 3 0 0 1-3 2.7H20.5a3 3 0 0 1-3-2.7Z" {...STROKE} />
      <path d="M16.4 30h23.2" {...STROKE} opacity="0.55" />
      <rect x="23" y="33" width="9" height="8" rx="1.4" {...STROKE} opacity="0.5" />
    </>
  ),
  // Coupe, for a gin served up.
  Gin: (
    <>
      <path d="M14 15h28c0 9.5-6.3 16-14 16S14 24.5 14 15Z" {...STROKE} />
      <path d="M28 31v12" {...STROKE} />
      <path d="M20 45h16" {...STROKE} />
      <circle cx="34.5" cy="19.5" r="2.6" {...STROKE} opacity="0.6" />
    </>
  ),
  // Martini glass.
  Vodka: (
    <>
      <path d="M13 14h30L28 31Z" {...STROKE} />
      <path d="M28 31v12" {...STROKE} />
      <path d="M20 45h16" {...STROKE} />
      <path d="M17.5 18h21" {...STROKE} opacity="0.5" />
    </>
  ),
  // Tiki-ish tumbler with a straw.
  Rum: (
    <>
      <path d="M18 14h20l-2 30a2.6 2.6 0 0 1-2.6 2.4h-10.8A2.6 2.6 0 0 1 20 44Z" {...STROKE} />
      <path d="M32 11 26 30" {...STROKE} opacity="0.65" />
      <path d="M19.1 27h17.8" {...STROKE} opacity="0.5" />
    </>
  ),
  // Shot glass with a wedge of lime.
  Tequila: (
    <>
      <path d="M19 20h18l-2 22a2.6 2.6 0 0 1-2.6 2.3h-8.8A2.6 2.6 0 0 1 21 42Z" {...STROKE} />
      <path d="M20.1 31h15.8" {...STROKE} opacity="0.5" />
      <path d="M37 16.5a5 5 0 0 1 0 7 5 5 0 0 1 0-7Z" {...STROKE} opacity="0.7" />
    </>
  ),
  // Pint.
  Beer: (
    <>
      <path d="M18 18h18v26a3 3 0 0 1-3 3h-12a3 3 0 0 1-3-3Z" {...STROKE} />
      <path d="M36 23h4.5a3.5 3.5 0 0 1 0 9H36" {...STROKE} opacity="0.7" />
      <path d="M18 18c1.6-3.2 4.4-4.6 6-3 1.8-2.6 5.6-2.8 7.2-.6 1.9-1 4.2.4 4.8 3.6" {...STROKE} opacity="0.8" />
    </>
  ),
  // Wine glass, bowl and stem.
  Wine: (
    <>
      <path d="M17 12h22c0 10.4-4.9 17.5-11 17.5S17 22.4 17 12Z" {...STROKE} />
      <path d="M28 29.5V44" {...STROKE} />
      <path d="M20 46h16" {...STROKE} />
      <path d="M18.4 20h19.2" {...STROKE} opacity="0.5" />
    </>
  ),
  // Highball with a twist.
  Cocktails: (
    <>
      <path d="M19 13h18l-1.6 31a2.8 2.8 0 0 1-2.8 2.6h-9.2a2.8 2.8 0 0 1-2.8-2.6Z" {...STROKE} />
      <path d="M20 26h16" {...STROKE} opacity="0.5" />
      <path d="M30 17c3.4 0 5 2 5 4.2S33.2 25 31 24.2" {...STROKE} opacity="0.7" />
    </>
  ),
}

const FALLBACK = GLASSES.Cocktails

export default function BarGlass({ group, size = 54 }: { group: string; size?: number }) {
  return (
    <svg
      className="bar-glass"
      width={size}
      height={size}
      viewBox="0 0 56 56"
      role="img"
      aria-label={group}
    >
      {GLASSES[group] ?? FALLBACK}
    </svg>
  )
}
