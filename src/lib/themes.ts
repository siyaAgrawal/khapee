/**
 * A restaurant can carry its own look on its page. Almost none do — an empty
 * theme is the standard layout — but a place with a strong identity of its own
 * can have the menu dressed to match it rather than looking like everywhere
 * else on the app.
 */
export type ThemeName = 'noir' | 'hut' | 'revery' | 'plain' | ''

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
  Bar: { accent: '#c9b291', kicker: 'Poured after dark', glyph: '✦' },
}

/**
 * Lotus Hut's sections. A roadside place that runs late — the voice is warm and
 * plain-spoken, the opposite of La Tavola's, because the restaurant is.
 */
const HUT_VOICES: Record<string, SectionVoice> = {
  Maggi: { accent: '#e8a33d', kicker: 'Two minutes, allegedly', glyph: '🍜' },
  Sandwiches: { accent: '#7fae5a', kicker: 'Pressed to order', glyph: '🥪' },
  'Club Sandwiches': { accent: '#6fa04f', kicker: 'The bigger ones', glyph: '🥪' },
  Burgers: { accent: '#d97a3c', kicker: 'Held in both hands', glyph: '🍔' },
  HotDog: { accent: '#d4693f', kicker: 'Long and loaded', glyph: '🌭' },
  'French Fries': { accent: '#eab040', kicker: 'Salt, always', glyph: '🍟' },
  Pizza: { accent: '#d1553f', kicker: 'Straight from the counter', glyph: '🍕' },
  'Open Toast': { accent: '#c98f43', kicker: 'Grilled, open-faced', glyph: '🍞' },
  Coffee: { accent: '#a9754a', kicker: 'Hot, cold, and very cold', glyph: '☕' },
  'Drinks (Beverages)': { accent: '#5aa6c4', kicker: 'For the heat', glyph: '🥤' },
  Pasta: { accent: '#cf8a4a', kicker: 'Creamy or red', glyph: '🍝' },
  Rolls: { accent: '#c07a45', kicker: 'Wrapped to go', glyph: '🌯' },
  'Ice Cream Soda': { accent: '#c47fb0', kicker: 'Fizz and a scoop', glyph: '🥤' },
}

/**
 * Revery's sections. A garden café under string lights, so the voice is easy
 * and unhurried — the opposite of a counter shouting its prices.
 */
const REVERY_VOICES: Record<string, SectionVoice> = {
  Wraps: { accent: '#8fc46b', kicker: 'Rolled and handed over', glyph: '🌯' },
  'Rice Bowls': { accent: '#d9a441', kicker: 'A bowl, warm', glyph: '🍚' },
  Burgers: { accent: '#e08a52', kicker: 'Both hands', glyph: '🍔' },
  Pizza: { accent: '#e0705c', kicker: 'Straight off the stone', glyph: '🍕' },
  'Garlic Bread': { accent: '#d7b25c', kicker: 'Butter, garlic, gone', glyph: '🥖' },
  'Open Toast': { accent: '#cf9a55', kicker: 'Open-faced, under the grill', glyph: '🍞' },
  Sandwiches: { accent: '#93bf6a', kicker: 'Pressed to order', glyph: '🥪' },
  'Special Buns': { accent: '#c98f5e', kicker: 'The ones worth the wait', glyph: '🥐' },
  'Quick Bites': { accent: '#dcae4e', kicker: 'While you decide', glyph: '🍿' },
  Nachos: { accent: '#e0a24c', kicker: 'For the middle of the table', glyph: '🧀' },
  Pasta: { accent: '#e07d62', kicker: 'Red or white', glyph: '🍝' },
  'Hot Coffee': { accent: '#b5814f', kicker: 'Something to sit with', glyph: '☕' },
  'Cold Coffee': { accent: '#a6835f', kicker: 'Over plenty of ice', glyph: '🧊' },
  Shakes: { accent: '#cf8bb4', kicker: 'Thick, and a spoon', glyph: '🥤' },
  'Iced Tea': { accent: '#7fc0a8', kicker: 'Long and cold', glyph: '🫖' },
  Mocktails: { accent: '#6fc08e', kicker: 'Nothing in them but the evening', glyph: '🍹' },
  'Red Bull': { accent: '#5aa6d6', kicker: 'For the late ones', glyph: '⚡' },
  Fries: { accent: '#e2b24a', kicker: 'Salted, always', glyph: '🍟' },
  Maggi: { accent: '#e8b545', kicker: 'Two minutes, allegedly', glyph: '🍜' },
}

const FALLBACK: SectionVoice = { accent: '#c9a227', kicker: 'From the kitchen', glyph: '·' }

/**
 * Tinted variants of an accent, precomputed.
 *
 * These were `color-mix()` in the stylesheet, which Safari only learned in
 * 16.2 — and an unsupported colour takes the whole declaration with it, so a
 * `border: 1px solid color-mix(…)` left buttons with no border at all on an
 * older iPhone. Plain rgba works everywhere.
 */
export function accentVars(hex: string): Record<string, string> {
  const n = parseInt(hex.slice(1), 16)
  const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
  return {
    '--na': hex,
    '--na-soft': `rgba(${rgb}, 0.5)`,
    '--na-faint': `rgba(${rgb}, 0.13)`,
  }
}

export function sectionVoice(theme: ThemeName, section: string): SectionVoice {
  if (theme === 'revery') return REVERY_VOICES[section] ?? { ...FALLBACK, accent: '#8fc46b' }
  if (theme === 'hut') return HUT_VOICES[section] ?? { ...FALLBACK, accent: '#e8a33d' }
  if (theme === 'noir') return NOIR_VOICES[section] ?? FALLBACK
  return FALLBACK
}

/**
 * Puts a restaurant's palette on the page while one of its screens is open.
 *
 * The app otherwise follows the device, and a themed restaurant's colours
 * assume their own ground — on a phone set to light, Revery's greens on cream
 * are unreadable. Cleared on the way out so the rest of the app goes back to
 * whatever the device asked for.
 */
export function applyTheme(theme: ThemeName): () => void {
  // "plain" is not a palette — it is the ordinary app with the photographs
  // left off — so it must not stamp a data-theme nobody has written colours
  // for, which would leave the page with no palette at all.
  if (!theme || theme === 'plain') return () => {}
  const root = document.documentElement
  const previous = root.dataset.theme
  root.dataset.theme = theme
  return () => {
    if (previous) root.dataset.theme = previous
    else delete root.dataset.theme
  }
}
