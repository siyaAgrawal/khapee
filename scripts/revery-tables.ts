/**
 * Revery has three tables, not eight.
 *
 *   npx tsx scripts/revery-tables.ts
 *
 * The cafe was imported with the default eight, so a customer eating in was
 * shown five tables that do not exist. Removing them is safe: an order keeps
 * its own table_label, and orders(table_id) is ON DELETE SET NULL, so nothing
 * already placed is lost.
 *
 * Tables 1 to 3 keep their tokens, so any QR already printed for them still
 * works. Run it again after adding a table and it will leave things alone.
 */
import { db } from '../server/db.ts'

const SLUG = 'revery'
const KEEP = ['Table 1', 'Table 2', 'Table 3']

const restaurant = db.prepare('SELECT id, name FROM restaurants WHERE slug = ?').get(SLUG) as any
if (!restaurant) {
  console.error(`\n  No restaurant with slug "${SLUG}".\n`)
  process.exit(1)
}

const tables = db
  .prepare('SELECT id, label FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id')
  .all(restaurant.id) as any[]

const extra = tables.filter((t) => !KEEP.includes(t.label))
const missing = KEEP.filter((label) => !tables.some((t) => t.label === label))

db.transaction(() => {
  for (const t of extra) {
    db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(t.id)
    console.log(`  removed ${t.label}`)
  }
  for (const label of missing) {
    db.prepare('INSERT INTO restaurant_tables (restaurant_id, label, seats, token) VALUES (?, ?, ?, ?)').run(
      restaurant.id,
      label,
      4,
      // Same shape the app generates: 16 hex characters.
      Array.from({ length: 16 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
    )
    console.log(`  added ${label}`)
  }
})()

const now = db
  .prepare('SELECT label, seats, token FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id')
  .all(restaurant.id) as any[]

console.log(`\n  ${restaurant.name} has ${now.length} table${now.length === 1 ? '' : 's'}:`)
for (const t of now) console.log(`    ${t.label}  ·  ${t.seats} seats  ·  /t/${t.token}`)
console.log()
