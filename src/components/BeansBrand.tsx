/**
 * Mr. Beans' mark, wordmark and the ornaments set around them.
 *
 * All of it is theirs rather than ours. The gentleman in the top hat is the
 * chalk mural from the wall of the shop, cut out of a photograph and turned
 * into white on transparent; the plate is the shop sign, which is lettering
 * inside a ruled box; the oval and the flourished rules are the ornaments an
 * engraver would have set around a portrait in 1890. Nothing is invented here
 * except the arrangement.
 *
 * Everything is drawn in currentColor, so each piece prints as black ink on
 * the paper ground or reversed out of an ink band, whichever it is sitting on.
 */

/** A rule with a scroll and a diamond at its centre. Between headings. */
export function BeansFlourish({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`beans-flourish ${className}`}
      viewBox="0 0 240 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6 12H84M156 12H234" strokeWidth="1.2" />
      <circle cx="4" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="236" cy="12" r="2" fill="currentColor" stroke="none" />
      <g strokeWidth="1.3">
        {/* Scrolls unfurling outward from the diamond. */}
        <path d="M113 12c-7 0-9-7-15-7s-6.5 7-1.6 7c2.8 0 2.8-3.4 0-3.4" />
        <path d="M113 12c-7 0-9 7-15 7s-6.5-7-1.6-7c2.8 0 2.8 3.4 0 3.4" />
        <path d="M84 12h6" />
        <g transform="translate(240 0) scale(-1 1)">
          <path d="M113 12c-7 0-9-7-15-7s-6.5 7-1.6 7c2.8 0 2.8-3.4 0-3.4" />
          <path d="M113 12c-7 0-9 7-15 7s-6.5-7-1.6-7c2.8 0 2.8 3.4 0 3.4" />
          <path d="M84 12h6" />
        </g>
      </g>
      <path d="M120 5l5 7-5 7-5-7Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** One scrolled crest, for the top and the bottom of the oval. */
function Crest({ y = 0, flip = false }: { y?: number; flip?: boolean }) {
  const half = (
    <>
      <path d="M60 22C60 12 50 6 42 9c-6 2-5 10 1 9.5 4-.4 3.6-5.4.2-4.6" />
      <path d="M42 9c-7-5-18-3-22 3-2 3.4 1.6 6.6 4.4 4.4" />
      <path d="M20 22H0" />
    </>
  )
  return (
    <g
      transform={flip ? `translate(0 ${y}) scale(1 -1)` : `translate(0 ${y})`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      {half}
      <g transform="translate(120 0) scale(-1 1)">{half}</g>
      <path d="M60 1c4 5 4 11 0 15-4-4-4-10 0-15Z" fill="currentColor" stroke="none" />
      <circle cx="60" cy="21" r="1.8" fill="currentColor" stroke="none" />
    </g>
  )
}

/**
 * The oval frame from an old engraving: a heavy rule, a string of beads, a
 * fine inner rule, and a scrolled crest top and bottom.
 */
function Cartouche() {
  return (
    <svg className="beans-cartouche" viewBox="0 0 240 320" fill="none" stroke="currentColor" aria-hidden>
      <ellipse cx="120" cy="160" rx="100" ry="134" strokeWidth="3" />
      <ellipse cx="120" cy="160" rx="93" ry="127" strokeWidth="1" strokeDasharray="0.1 5.5" strokeLinecap="round" />
      <ellipse cx="120" cy="160" rx="87" ry="121" strokeWidth="1" />
      <svg x="60" y="0" width="120" height="30" viewBox="0 0 120 30" overflow="visible">
        <Crest />
      </svg>
      <svg x="60" y="290" width="120" height="30" viewBox="0 0 120 30" overflow="visible">
        <Crest y={30} flip />
      </svg>
      {/* Small scrolls at the waist of the oval. */}
      <path d="M20 160c-8 0-12-6-8-10s9 0 6 3" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M220 160c8 0 12-6 8-10s-9 0-6 3" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The gentleman, framed.
 *
 * `size` is the width of the oval; the portrait is taller than it is wide, as
 * an engraved portrait is, so the block is sized from that one number.
 */
export function BeansMark({ size = 168 }: { size?: number }) {
  return (
    <span className="beans-portrait" style={{ width: size }}>
      <Cartouche />
      <img className="beans-gentleman" src="/beans-gentleman.png" alt="" draggable={false} />
    </span>
  )
}

/**
 * The sign over the door: the name in engraved capitals inside a ruled plate,
 * with the branch under a rule beneath it.
 *
 * Khapee stores both shops as "Mr. Beans — Vijay Nagar", which is how a list
 * of restaurants needs to read and not how a sign does. Split at the dash, so
 * the plate carries the name and the branch sits under it where a sign would
 * put the street.
 */
export function BeansWordmark({ name }: { name: string }) {
  const [house, branch] = splitName(name)
  return (
    <span className="beans-wordmark">
      <span className="beans-plate">
        <span className="beans-plate-name">{house}</span>
        {branch && <span className="beans-plate-branch">{branch}</span>}
      </span>
    </span>
  )
}

/** "Mr. Beans — Vijay Nagar" → ["Mr. Beans", "Vijay Nagar"]. */
function splitName(name: string): [string, string] {
  const at = name.search(/\s[—–-]\s/)
  if (at === -1) return [name, '']
  return [name.slice(0, at).trim(), name.slice(at + 3).trim()]
}
