/**
 * Turns a plain-text menu into the JSON shape `npm run import` expects.
 *
 *   npx tsx scripts/parse-menu.ts data/menu.txt "Restaurant Name" > data/out.json
 *
 * Understands blocks of:
 *   Section Name
 *   Dish Name
 *   ₹425.00                <- optional; items without one are reported, not guessed
 *   Optional description
 *   VEGETARIAN             <- optional marker
 *
 * Many pasted menus start with a navigation list of every section. When that is
 * present it is used as the section vocabulary, which is what lets the parser
 * tell a heading apart from a dish that happens to have no price.
 */
import fs from 'node:fs'
import path from 'node:path'

const [, , file, restaurantName = 'Imported Restaurant'] = process.argv
if (!file) {
  console.error('Usage: tsx scripts/parse-menu.ts <menu.txt> [restaurant name]')
  process.exit(1)
}

const PRICE = /^₹\s*([\d,]+(?:\.\d{1,2})?)$/
const VEG_MARK = /^VEGETARIAN$/i

const EMOJI_RULES: [RegExp, string][] = [
  [/soup/i, '🍜'],
  [/salad/i, '🥗'],
  [/dim sum|dumpling|bao/i, '🥟'],
  [/sushi|maki/i, '🍣'],
  [/pizza|margherita|napoli/i, '🍕'],
  [/pasta|ravioli|noodle/i, '🍝'],
  [/burger|slider/i, '🍔'],
  [/sandwich|tartine|toast|bagel/i, '🥪'],
  [/bread|naan|roti|paratha/i, '🫓'],
  [/biryani|rice|khichdi/i, '🍚'],
  [/egg|omelette/i, '🍳'],
  [/coffee|frappe|espresso|latte|cappuccino|brew|matcha|affogato/i, '☕'],
  [/tea|chai/i, '🍵'],
  [/shake|milkshake|smoothie/i, '🥤'],
  [/dessert|cake|brownie|ice cream|tiramisu|cheesecake|madeleine|strudel/i, '🍰'],
  [/tandoor|tikka|kebab/i, '🍢'],
  [/fries|wedges|nachos|popcorn/i, '🍟'],
  [/chicken|mutton|fish|prawn|lamb|pork/i, '🍗'],
  [/paneer|tofu|cheese/i, '🧀'],
  [/main course|curry|dal/i, '🍛'],
  [/starter|appetizer|small plate|nibble/i, '🍢'],
]

function emojiFor(section: string, name: string): string {
  for (const [pattern, glyph] of EMOJI_RULES) {
    if (pattern.test(name)) return glyph
  }
  for (const [pattern, glyph] of EMOJI_RULES) {
    if (pattern.test(section)) return glyph
  }
  return '🍽️'
}

/** Names that read as meat regardless of any VEGETARIAN marker being absent. */
const NON_VEG = /chicken|mutton|lamb|fish|prawn|shrimp|bacon|pork|egg|keema|seafood|tuna|salmon|crab|meat/i

const lines = fs
  .readFileSync(path.resolve(file), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

/**
 * The leading navigation block: everything before the first dish that has a
 * price. Those lines are section names, and reappear later as real headings.
 */
const firstPricedItem = lines.findIndex((_, i) => lines[i + 1] && PRICE.test(lines[i + 1]))
const navSet = new Set(firstPricedItem > 0 ? lines.slice(0, firstPricedItem) : [])

type Item = { name: string; description?: string; price: number | null; emoji: string; veg: boolean }
const sections: { category: string; items: Item[] }[] = []
const unpriced: { section: string; name: string }[] = []
let current: { category: string; items: Item[] } | null = null

function startSection(name: string) {
  const existing = sections.find((s) => s.category === name)
  current = existing ?? { category: name, items: [] }
  if (!existing) sections.push(current)
}

function isName(i: number): boolean {
  return !!lines[i + 1] && PRICE.test(lines[i + 1])
}

/** True when lines[i] introduces a dish rather than a heading. */
function looksLikeHeading(i: number): boolean {
  if (navSet.has(lines[i])) return true
  // Heading → dish name → price
  if (lines[i + 1] && isName(i + 1)) return true
  return false
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]

  if (VEG_MARK.test(line)) {
    const last = current?.items.at(-1)
    if (last) last.veg = true
    continue
  }
  if (PRICE.test(line)) continue // consumed with its name

  // A dish with a price.
  if (isName(i)) {
    if (!current) startSection('Menu')
    const price = Number(lines[i + 1].match(PRICE)![1].replace(/,/g, ''))
    const after = lines[i + 2]
    // The line after a price is a description unless it starts the next dish
    // (a price two lines on) or is a heading before the next dish (three on).
    const isDescription =
      !!after &&
      !PRICE.test(after) &&
      !VEG_MARK.test(after) &&
      !(lines[i + 3] && PRICE.test(lines[i + 3])) &&
      !navSet.has(after)
    current!.items.push({
      name: line,
      description: isDescription ? after : undefined,
      price,
      emoji: emojiFor(current!.category, line),
      veg: !NON_VEG.test(line),
    })
    i += isDescription ? 2 : 1
    continue
  }

  if (looksLikeHeading(i)) {
    startSection(line)
    continue
  }

  // No price anywhere: either a heading we cannot confirm, or a priceless dish.
  // Treat it as a dish and let the operator supply the price.
  if (!current) {
    startSection(line)
    continue
  }
  const after = lines[i + 1]
  const isDescription = !!after && !navSet.has(after) && !VEG_MARK.test(after) && !PRICE.test(after) && !isName(i + 1)
  current.items.push({
    name: line,
    description: isDescription ? after : undefined,
    price: null,
    emoji: emojiFor(current.category, line),
    veg: !NON_VEG.test(line),
  })
  unpriced.push({ section: current.category, name: line })
  if (isDescription) i += 1
}

const priced = sections
  .map((s) => ({ category: s.category, items: s.items.filter((i) => i.price != null) }))
  .filter((s) => s.items.length > 0)

const total = priced.reduce((n, s) => n + s.items.length, 0)
const slug = restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const out = [
  {
    name: restaurantName,
    address: 'Indore',
    emoji: '🍽️',
    hue: 210,
    isOpen: true,
    tables: 10,
    staff: { name: restaurantName, email: `${slug}@tablo.local`, password: 'password123', title: 'Owner' },
    menu: priced.map((s) => ({
      category: s.category,
      items: s.items.map((i) => ({
        name: i.name,
        ...(i.description ? { description: i.description } : {}),
        price: i.price as number,
        emoji: i.emoji,
        veg: i.veg,
      })),
    })),
  },
]

console.error(`  ${priced.length} sections, ${total} items with prices`)
if (unpriced.length) {
  console.error(`\n  ${unpriced.length} items have NO price and were left out:`)
  let last = ''
  for (const u of unpriced) {
    if (u.section !== last) {
      console.error(`    ${u.section}`)
      last = u.section
    }
    console.error(`      · ${u.name}`)
  }
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n')
