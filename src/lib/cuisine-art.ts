/**
 * A small picture for a cuisine, drawn from its name rather than fetched or
 * uploaded. The symbol comes from the words in the title; the colours come from
 * the title itself, so the same cuisine always looks the same and two different
 * cuisines rarely look alike.
 */

/** Checked in order, so put the specific words before the general ones. */
const SYMBOLS: [RegExp, string][] = [
  [/pizza/i, '🍕'],
  [/pasta|italian/i, '🍝'],
  [/sushi/i, '🍣'],
  [/japanese/i, '🍱'],
  [/ramen|noodle/i, '🍜'],
  [/burger/i, '🍔'],
  [/sandwich|sub|toast/i, '🥪'],
  [/taco|mexican/i, '🌮'],
  [/cake|pastry|patisserie/i, '🍰'],
  [/bakery|bread|bake/i, '🥐'],
  [/coffee|espresso|brew/i, '☕'],
  [/tea|chai/i, '🍵'],
  [/juice|smoothie|shake|beverage|drink/i, '🥤'],
  [/ice ?cream|gelato|dessert|sweet/i, '🍨'],
  [/breakfast|brunch|egg/i, '🍳'],
  [/salad|healthy|veg/i, '🥗'],
  [/seafood|fish/i, '🍤'],
  [/bbq|grill|kebab|tandoor/i, '🍢'],
  [/biryani|rice/i, '🍚'],
  [/south indian|dosa|idli/i, '🫓'],
  [/north indian|punjabi|mughlai|curry|indian/i, '🍛'],
  [/chinese|wok/i, '🥡'],
  [/thai/i, '🍲'],
  [/asian/i, '🥢'],
  [/street|chaat|snack/i, '🌶️'],
  [/cafe|café|bistro|diner/i, '🍩'],
  [/continental|european/i, '🧀'],
  [/pub|bar|lounge/i, '🍹'],
]

export function cuisineEmoji(name: string): string {
  for (const [pattern, emoji] of SYMBOLS) {
    if (pattern.test(name)) return emoji
  }
  return '🍽️'
}

/** Stable hue per name, so a cuisine keeps its colour between visits. */
export function cuisineHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.toLowerCase().charCodeAt(i)) % 360
  return hash
}

/** A soft two-stop wash the emoji sits on. */
export function cuisineBackground(name: string): string {
  const hue = cuisineHue(name)
  return `linear-gradient(150deg, hsl(${hue} 46% 32%), hsl(${(hue + 38) % 360} 40% 20%))`
}
