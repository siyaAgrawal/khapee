/**
 * Sets up a precinct — a stretch of a city whose restaurants will carry an
 * order out to whoever is standing in it.
 *
 *   npx tsx scripts/precinct.ts 140 "140" --join revery,cafe-vijay-bhaiya-saket-wale
 *   npx tsx scripts/precinct.ts 140 --spots "Main road parking,The corner bench"
 *   npx tsx scripts/precinct.ts 140 --leave siya-cafe
 *
 * A spot is a landmark, not an address: nobody standing outside a café in 140
 * has one. "Outside <restaurant>" is the commonest of all, because the thing
 * people already do is stand outside one place and ring another, so a spot is
 * made for each restaurant that joins.
 *
 * Safe to run twice.
 */
import { db } from '../server/db.ts'

const [slug, ...rest] = process.argv.slice(2)
if (!slug) {
  console.error('\n  Usage: npx tsx scripts/precinct.ts <slug> [name] [--join a,b] [--leave c] [--spots "X,Y"]\n')
  process.exit(1)
}

const flag = (name: string): string | null => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? (rest[i + 1] ?? '') : null
}
const name = rest[0] && !rest[0].startsWith('--') ? rest[0] : slug
const join = (flag('join') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const leave = (flag('leave') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const extraSpots = (flag('spots') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

let precinct = db.prepare('SELECT * FROM precincts WHERE slug = ?').get(slug.toLowerCase()) as any
if (!precinct) {
  db.prepare('INSERT INTO precincts (slug, name, city, note) VALUES (?, ?, ?, ?)').run(
    slug.toLowerCase(),
    name,
    'Indore',
    'Order from any kitchen here and they bring it to you.',
  )
  precinct = db.prepare('SELECT * FROM precincts WHERE slug = ?').get(slug.toLowerCase()) as any
  console.log(`  created ${precinct.name}`)
}

const addSpot = (label: string, note = '') => {
  const existing = db
    .prepare('SELECT id, is_active FROM precinct_spots WHERE precinct_id = ? AND label = ?')
    .get(precinct.id, label) as any
  if (existing) {
    if (!existing.is_active) {
      db.prepare('UPDATE precinct_spots SET is_active = 1 WHERE id = ?').run(existing.id)
      console.log(`  restored spot ${label}`)
    }
    return
  }
  const next = (db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM precinct_spots WHERE precinct_id = ?')
    .get(precinct.id) as any).n
  db.prepare('INSERT INTO precinct_spots (precinct_id, label, note, sort_order) VALUES (?, ?, ?, ?)').run(
    precinct.id,
    label,
    note,
    next + 1,
  )
  console.log(`  added spot ${label}`)
}

db.transaction(() => {
  for (const s of join) {
    const r = db.prepare('SELECT id, name FROM restaurants WHERE slug = ?').get(s) as any
    if (!r) {
      console.warn(`  ! no restaurant with slug "${s}"`)
      continue
    }
    db.prepare('INSERT OR IGNORE INTO restaurant_precincts (restaurant_id, precinct_id) VALUES (?, ?)').run(
      r.id,
      precinct.id,
    )
    console.log(`  ${r.name} joined ${precinct.name}`)
    // Standing outside one place and ordering from another is the whole idea,
    // so every restaurant in the precinct is also somewhere to stand.
    addSpot(`Outside ${r.name}`, 'The shopfront')
  }

  for (const s of leave) {
    const r = db.prepare('SELECT id, name FROM restaurants WHERE slug = ?').get(s) as any
    if (!r) continue
    db.prepare('DELETE FROM restaurant_precincts WHERE restaurant_id = ? AND precinct_id = ?').run(r.id, precinct.id)
    console.log(`  ${r.name} left ${precinct.name}`)
  }

  for (const label of extraSpots) addSpot(label)
})()

const members = db
  .prepare(
    `SELECT r.name FROM restaurant_precincts rp JOIN restaurants r ON r.id = rp.restaurant_id
      WHERE rp.precinct_id = ? ORDER BY r.name`,
  )
  .all(precinct.id) as any[]
const spots = db
  .prepare('SELECT label FROM precinct_spots WHERE precinct_id = ? AND is_active = 1 ORDER BY sort_order, id')
  .all(precinct.id) as any[]

console.log(`\n  ${precinct.name} — /p/${precinct.slug}`)
console.log(`    serving it:  ${members.map((m) => m.name).join(', ') || '(nobody yet)'}`)
console.log(`    places to stand: ${spots.map((s) => s.label).join(' · ') || '(none yet)'}\n`)
