/**
 * A restaurant can carry its own look on its page. Almost none do — an empty
 * theme is the standard layout — but a place with a strong identity of its own
 * can have the menu dressed to match it rather than looking like everywhere
 * else on the app.
 */
export type ThemeName = 'noir' | 'hut' | 'revery' | 'paarroo' | 'beans' | 'grams' | 'plain' | ''

/**
 * A restaurant's own mark, for the places that would otherwise show a category
 * emoji — the card in the list, the switcher. Only for a theme we hold an
 * actual logo file for; inventing one would be putting a mark on a shopfront
 * that the shop never chose.
 */
export function crestFor(theme: ThemeName | string | undefined): string | null {
  return theme === 'beans' ? '/beans-gentleman.png' : null
}

/**
 * A cover for the card in the list, for a place whose look is a pattern rather
 * than a photograph: 187 Grams is its butter-and-cream stripes, so that is
 * what its card shows instead of a cookie emoji.
 */
export function coverFor(theme: ThemeName | string | undefined): string | null {
  return theme === 'grams' ? '/187grams-cover.svg' : null
}

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

/**
 * 28 Paarroo's sections.
 *
 * The one light theme here, and deliberately: the others are evening places
 * and this is a breakfast one — idli at eight in the morning under a dark
 * page reads as the wrong meal. So the ground stays white and the South
 * Indian character lives in the accents, which are taken from the room rather
 * than invented: banana leaf, filter coffee, turmeric, temple vermilion.
 *
 * The kickers are plain. A café that serves steamed idli and pulls espresso
 * does not need to be told it is characterful.
 */
const PAARROO_VOICES: Record<string, SectionVoice> = {
  'South Indian': { accent: '#2f7d55', kicker: 'Off the griddle, all day', glyph: 'இ' },
  Meals: { accent: '#3c7f52', kicker: 'A plate, and enough of it', glyph: '◍' },
  'Main Course': { accent: '#b8432c', kicker: 'The long-simmered ones', glyph: '◆' },
  Rice: { accent: '#c99a2e', kicker: 'One pot, many ways', glyph: '◌' },
  Biryani: { accent: '#a8572a', kicker: 'Worth the wait', glyph: '◈' },
  Thali: { accent: '#2f7d55', kicker: 'Everything, at once', glyph: '❁' },
  "Chef's Specials": { accent: '#b8432c', kicker: 'What the kitchen would order', glyph: '✦' },
  Breads: { accent: '#c08a3e', kicker: 'Hot, and folded', glyph: '◗' },
  Coffee: { accent: '#6f4423', kicker: 'Pulled to order', glyph: '☕' },
  'Cold Coffee': { accent: '#8a6039', kicker: 'Over plenty of ice', glyph: '🧊' },
  Frappes: { accent: '#7a5230', kicker: 'Blended, and topped', glyph: '🥤' },
  Shakes: { accent: '#c06d8e', kicker: 'Thick, and a spoon', glyph: '🥛' },
  'Hot Chocolate': { accent: '#6b3f2a', kicker: 'For the cooler end of the day', glyph: '🍫' },
  'Iced Tea': { accent: '#3f8f79', kicker: 'Long and cold', glyph: '🫖' },
  'Lemonade & Coolers': { accent: '#5aa03c', kicker: 'For the heat outside', glyph: '🍋' },
  'Milk & Water': { accent: '#5c8aa8', kicker: 'Plain, and cold', glyph: '💧' },
}

/**
 * Mr. Beans' sections.
 *
 * The one theme set on paper rather than on a ground: the shop's own look is
 * black ink on cream — an engraver's capitals, ruled plates, the gentleman in
 * his oval — and the café inherits it. So the glyphs are printer's ornaments
 * instead of emoji, and the accents are inks rather than colours: oxblood,
 * olive, sepia, bottle green, the four an old press would actually have had.
 *
 * The kickers are dry. A kitchen that names a section "Not Pasta" has a voice
 * already and does not need ours on top of it.
 */
const BEANS_VOICES: Record<string, SectionVoice> = {
  'Freshly Baked From The Gourmet Store Bakery': {
    accent: '#7a5230',
    kicker: 'Out of the oven this morning',
    glyph: '❦',
  },
  'Eggs, Eggs & More Eggs': { accent: '#a8782c', kicker: 'However you take them', glyph: '◍' },
  'Tartine, Toasty & Flat Breads': { accent: '#8a5a2b', kicker: 'Open-faced, under the grill', glyph: '❧' },
  'Salads & Healthy Bowls': { accent: '#4a6b3a', kicker: 'Green, and plenty of it', glyph: '✿' },
  Sandwiches: { accent: '#6b5a33', kicker: 'Pressed to order', glyph: '❖' },
  Entree: { accent: '#7d3f2c', kicker: 'To begin with', glyph: '✦' },
  Pizzas: { accent: '#9c4529', kicker: 'Straight off the stone', glyph: '◆' },
  'Pasta & Noodles': { accent: '#8a6b2e', kicker: 'Red, white, or neither', glyph: '❈' },
  'Not Pasta': { accent: '#6f6436', kicker: 'The exceptions', glyph: '✧' },
  'Meat Feasts': { accent: '#7a3326', kicker: 'For the hungry end of the table', glyph: '❂' },
  'Asian Selection': { accent: '#45604a', kicker: 'From the other kitchen', glyph: '❃' },
  'Asian Curry': { accent: '#8a5a22', kicker: 'Slow, and spiced', glyph: '❉' },
  Desserts: { accent: '#6e3f55', kicker: 'The reason you stayed', glyph: '❀' },
  'Not Coffee': { accent: '#4a5f6b', kicker: 'Everything else to drink', glyph: '⁂' },
  'Cold Coffee': { accent: '#5d4632', kicker: 'Over plenty of ice', glyph: '☙' },
  Coffee: { accent: '#5d4632', kicker: 'Pulled to order', glyph: '☙' },
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
  if (theme === 'beans') return BEANS_VOICES[section] ?? { ...FALLBACK, accent: '#6b5a33', glyph: '✦' }
  if (theme === 'paarroo') return PAARROO_VOICES[section] ?? { ...FALLBACK, accent: '#2f7d55' }
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
