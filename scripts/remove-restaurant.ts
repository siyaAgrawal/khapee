/**
 * Removes restaurants and everything attached to them.
 *
 *   npx tsx scripts/remove-restaurant.ts "Some Cafe" another-slug
 *   npx tsx scripts/remove-restaurant.ts --demo        # the seeded demo set
 *   npx tsx scripts/remove-restaurant.ts --dry-run "Some Cafe"
 *
 * Menus, tables, access codes, orders, group sessions and payments go with the
 * restaurant (foreign keys cascade). Staff accounts left with no restaurant and
 * uploaded photos are cleaned up here, since neither cascades on its own.
 */
import fs from 'node:fs'
import path from 'node:path'
import { db, UPLOAD_DIR } from '../server/db.ts'

/** The restaurants `npm run seed` creates. */
const DEMO_SLUGS = [
  'mornington',
  'basil-and-bay',
  'the-tandoor-room',
  'sakura-bowl',
  'malwa-chai-and-poha',
]

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const wantsDemo = args.includes('--demo')
const targets = args.filter((a) => !a.startsWith('--'))

if (!targets.length && !wantsDemo) {
  console.error('\n  Usage: tsx scripts/remove-restaurant.ts [--demo] [--dry-run] <name or slug>...\n')
  process.exit(1)
}

function findRestaurant(key: string) {
  return db
    .prepare('SELECT * FROM restaurants WHERE lower(name) = lower(?) OR slug = lower(?)')
    .get(key, key) as any
}

const found: any[] = []
for (const key of targets) {
  const row = findRestaurant(key)
  if (!row) console.warn(`  ! no restaurant matching "${key}"`)
  else if (!found.some((f) => f.id === row.id)) found.push(row)
}
if (wantsDemo) {
  for (const slug of DEMO_SLUGS) {
    const row = findRestaurant(slug)
    if (row && !found.some((f) => f.id === row.id)) found.push(row)
  }
}

if (!found.length) {
  console.log('\n  Nothing to remove.\n')
  process.exit(0)
}

let removedPhotos = 0
let removedStaff = 0

for (const restaurant of found) {
  const counts = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM menu_items WHERE restaurant_id = ?) AS items,
        (SELECT COUNT(*) FROM restaurant_tables WHERE restaurant_id = ?) AS tables,
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = ?) AS orders,
        (SELECT COUNT(*) FROM group_sessions WHERE restaurant_id = ?) AS groups`,
    )
    .get(restaurant.id, restaurant.id, restaurant.id, restaurant.id) as any

  console.log(
    `  ${dryRun ? 'would remove' : 'removing'}  ${restaurant.name} — ${counts.items} items, ` +
      `${counts.tables} tables, ${counts.orders} orders, ${counts.groups} group sessions`,
  )
  if (dryRun) continue

  const photos = [
    restaurant.image_path,
    ...(db.prepare('SELECT image_path FROM menu_items WHERE restaurant_id = ?').all(restaurant.id) as any[]).map(
      (r) => r.image_path,
    ),
  ].filter(Boolean)

  // Staff who work here and nowhere else lose their account with the restaurant.
  const staff = db
    .prepare(
      `SELECT u.id, u.email FROM users u
       JOIN restaurant_staff rs ON rs.user_id = u.id
       WHERE rs.restaurant_id = ?
         AND (SELECT COUNT(*) FROM restaurant_staff x WHERE x.user_id = u.id) = 1`,
    )
    .all(restaurant.id) as any[]

  db.transaction(() => {
    db.prepare('DELETE FROM restaurants WHERE id = ?').run(restaurant.id)
    for (const s of staff) db.prepare('DELETE FROM users WHERE id = ?').run(s.id)
  })()
  removedStaff += staff.length

  for (const file of photos) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(file)))
      removedPhotos++
    } catch {
      /* already gone */
    }
  }
}

if (dryRun) {
  console.log('\n  Dry run — nothing was changed.\n')
} else {
  const left = db.prepare('SELECT COUNT(*) AS n FROM restaurants').get() as any
  console.log(
    `\n  Removed ${found.length} restaurant${found.length === 1 ? '' : 's'}, ` +
      `${removedStaff} staff account${removedStaff === 1 ? '' : 's'} and ${removedPhotos} photo${removedPhotos === 1 ? '' : 's'}.` +
      `\n  ${left.n} restaurants remain.\n`,
  )
}
