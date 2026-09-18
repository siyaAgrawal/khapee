/**
 * Finding a dish by typing roughly what it is called.
 *
 * The first version matched the whole query as one run of characters, which
 * fails the moment somebody types the words in a natural order: "peri peri
 * cheese maggi" found nothing, because the dish is called "Peri-Peri Cheese"
 * and the word Maggi is the name of the section it sits in. Neither half of
 * what they typed was wrong.
 *
 * So: every word has to appear somewhere in the dish — its name, its
 * description, or the section it belongs to — and a word matches from the
 * start of another, so "choc" finds Chocolate without also dragging in every
 * dish with a c, h and o in it. Punctuation is flattened, which is what makes
 * "peri peri" find "Peri-Peri".
 */
function flatten(value: string): string {
  return ` ${String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `
}

export function searchWords(query: string): string[] {
  return flatten(query).trim().split(' ').filter(Boolean)
}

export type Searchable = { name: string; description?: string }

/** True when every word typed appears in the dish, its blurb or its section. */
export function dishMatches(item: Searchable, sectionName: string, words: string[]): boolean {
  if (!words.length) return true
  const hay = flatten(`${item.name} ${item.description ?? ''} ${sectionName}`)
  return words.every((word) => hay.includes(` ${word}`))
}
