/**
 * A restaurant can carry its own look on its page. Almost none do — an empty
 * theme is the standard layout — but a place with a strong identity of its own
 * can have the menu dressed to match it rather than looking like everywhere
 * else on the app.
 */
export type ThemeName = 'noir' | ''

/** How one section of a themed menu presents itself. */
export type SectionVoice = {
  /** Drives the accent colour of the whole section while it is open. */
  accent: string
  /** Sits under the section name — the section's own line, not a description. */
  kicker: string
  /** A mark for the tab. Deliberately not an emoji; these are set in the serif. */
  glyph: string
}

/**
 * La Tavola's sections. The kickers are written to be read once and enjoyed,
 * not to explain what the food is — the dishes do that themselves.
 */
const NOIR_VOICES: Record<string, SectionVoice> = {
  Japanese: { accent: '#d2483f', kicker: 'Quiet knife work', glyph: '八' },
  Korean: { accent: '#e07a3c', kicker: 'Heat, and plenty of it', glyph: '한' },
  Asian: { accent: '#c9a227', kicker: 'Small plates, long evenings', glyph: '亞' },
  Mexican: { accent: '#dd5f43', kicker: 'Smoke, lime, fire', glyph: 'M' },
  Italian: { accent: '#8aa95c', kicker: 'Slow hands, old rules', glyph: 'IT' },
  Desserts: { accent: '#b07cc6', kicker: 'The reason you stayed', glyph: 'D' },
  Beverages: { accent: '#5aa6c4', kicker: 'Cold glass, low light', glyph: 'B' },
}

const FALLBACK: SectionVoice = { accent: '#c9a227', kicker: 'From the kitchen', glyph: '·' }

export function sectionVoice(theme: ThemeName, section: string): SectionVoice {
  if (theme !== 'noir') return FALLBACK
  return NOIR_VOICES[section] ?? FALLBACK
}
