/**
 * Puts Revery's operator side under a real email.
 *
 *   npx tsx scripts/revery-account.ts
 *
 * Revery was imported from its menu PDF and got the same placeholder login as
 * every other imported restaurant: revery@tablo.local, on the shared demo
 * password. That address reaches nobody, and anyone who knows the demo password
 * could sign in and run the restaurant — so once the real account is attached,
 * the placeholder is removed rather than left as a second way in.
 *
 * Access follows restaurant membership rather than the account's original role
 * (see requireStaff), so an address already used for ordering can run a
 * restaurant too, and its password is left exactly as its owner set it.
 *
 * Safe to run twice.
 */
import { db } from '../server/db.ts'
import { hashPassword } from '../server/auth.ts'
import { randomToken } from '../server/ids.ts'

const SLUG = 'revery'
const EMAIL = 'siyaagrawal292@gmail.com'
const PLACEHOLDER = /@(tablo|ordro|khapee)\.local$/

const restaurant = db.prepare('SELECT id, name FROM restaurants WHERE slug = ?').get(SLUG) as any
if (!restaurant) {
  console.error(`\n  No restaurant with slug "${SLUG}".\n`)
  process.exit(1)
}

const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(EMAIL) as any
let issued = ''

const ownerId = db.transaction(() => {
  let id: number
  if (existing) {
    // Their account already. Nothing about it is rewritten — least of all the
    // password, which is theirs and which this script has no business knowing.
    id = existing.id
  } else {
    issued = randomToken(6)
    id = Number(
      db
        .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(restaurant.name, EMAIL, hashPassword(issued), 'staff').lastInsertRowid,
    )
  }

  db.prepare(
    'INSERT OR IGNORE INTO restaurant_staff (user_id, restaurant_id, job_title) VALUES (?, ?, ?)',
  ).run(id, restaurant.id, 'Owner')

  // Every other way into this restaurant that nobody can receive mail at.
  const stale = db
    .prepare(
      `SELECT u.id, u.email FROM users u
         JOIN restaurant_staff rs ON rs.user_id = u.id
        WHERE rs.restaurant_id = ? AND u.id <> ?`,
    )
    .all(restaurant.id, id) as any[]
  for (const s of stale) {
    if (!PLACEHOLDER.test(s.email)) continue
    db.prepare('DELETE FROM users WHERE id = ?').run(s.id)
    console.log(`  removed placeholder login ${s.email}`)
  }
  return id
})()

const now = db
  .prepare(
    `SELECT u.email, rs.job_title FROM users u
       JOIN restaurant_staff rs ON rs.user_id = u.id
      WHERE rs.restaurant_id = ? ORDER BY u.id`,
  )
  .all(restaurant.id) as any[]

console.log(`\n  ${restaurant.name} (#${restaurant.id}) is run by:`)
for (const s of now) console.log(`    ${s.email}  ·  ${s.job_title}`)
console.log(
  issued
    ? `\n  New account — password: ${issued}\n  Change it from Your restaurant → Sign in.\n`
    : `\n  Existing account #${ownerId} — its own password is unchanged.\n`,
)
