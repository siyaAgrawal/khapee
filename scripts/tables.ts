/**
 * Sets how many tables a restaurant has.
 *
 *   npx tsx scripts/tables.ts revery 5        -> Table 1 … Table 5
 *   npx tsx scripts/tables.ts revery 5 --seats 2
 *
 * Tables that already exist keep their id and their token, so a QR already
 * printed and stuck to a table still works. Only the difference is applied:
 * going up adds, going down removes the highest-numbered ones.
 *
 * Removing is safe for anything already ordered — an order keeps its own
 * table_label, and orders(table_id) is ON DELETE SET NULL — but a table with
 * an order still open on it is left alone rather than pulled out from under
 * the people sitting at it.
 *
 * Run scripts/table-qr-sheet.ts afterwards to print the codes.
 */
import { db } from '../server/db.ts'
import { tableToken } from '../server/ids.ts'

const [slug, countArg, ...flags] = process.argv.slice(2)
const count = Number(countArg)
const seatsFlag = flags.indexOf('--seats')
const seats = seatsFlag >= 0 ? Number(flags[seatsFlag + 1]) : 4

if (!slug || !Number.isInteger(count) || count < 1 || count > 200) {
  console.error('\n  Usage: npx tsx scripts/tables.ts <slug> <how-many> [--seats N]\n')
  process.exit(1)
}

const restaurant = db.prepare('SELECT id, name FROM restaurants WHERE slug = ?').get(slug) as any
if (!restaurant) {
  console.error(`\n  No restaurant with slug "${slug}".\n`)
  process.exit(1)
}

const wanted = Array.from({ length: count }, (_, i) => `Table ${i + 1}`)
const have = db
  .prepare('SELECT id, label FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id')
  .all(restaurant.id) as any[]

const added: string[] = []
const removed: string[] = []
const busy: string[] = []

db.transaction(() => {
  for (const label of wanted) {
    if (have.some((t) => t.label === label)) continue
    db.prepare('INSERT INTO restaurant_tables (restaurant_id, label, seats, token) VALUES (?, ?, ?, ?)').run(
      restaurant.id,
      label,
      seats,
      tableToken(),
    )
    added.push(label)
  }
  for (const t of have) {
    if (wanted.includes(t.label)) continue
    const open = db
      .prepare(
        `SELECT COUNT(*) AS n FROM orders
          WHERE table_id = ? AND status NOT IN ('COMPLETED','DELIVERED','CANCELLED','DECLINED')`,
      )
      .get(t.id) as any
    if (open.n > 0) {
      busy.push(t.label)
      continue
    }
    db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(t.id)
    removed.push(t.label)
  }
})()

const now = db
  .prepare('SELECT label, seats, token FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id')
  .all(restaurant.id) as any[]

for (const l of added) console.log(`  added ${l}`)
for (const l of removed) console.log(`  removed ${l}`)
for (const l of busy) console.log(`  kept ${l} — it still has an order open on it`)

console.log(`\n  ${restaurant.name} has ${now.length} table${now.length === 1 ? '' : 's'}:`)
for (const t of now) console.log(`    ${t.label.padEnd(9)} ${t.seats} seats   /t/${t.token}`)
console.log(`\n  Print the codes:  npx tsx scripts/table-qr-sheet.ts ${slug}\n`)
