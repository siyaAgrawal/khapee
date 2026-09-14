/**
 * Gives an email address the keys to a restaurant.
 *
 *   KHAPEE_PASSWORD='…' npx tsx scripts/operator.ts revery someone@example.com
 *   KHAPEE_PASSWORD='…' npx tsx scripts/operator.ts revery someone@example.com --sole
 *
 * The password comes from the environment rather than an argument, so it does
 * not sit in shell history or in the process list.
 *
 * Access follows restaurant membership rather than the account's original role
 * (see requireStaff), so an address already used for ordering can run a
 * restaurant without losing anything it had as a customer.
 *
 * By default this adds an operator alongside whoever is already there. --sole
 * removes the others, which is the real handover: use it when the restaurant is
 * taking the account over for good.
 *
 * Safe to run twice.
 */
import { db } from '../server/db.ts'
import { hashPassword } from '../server/auth.ts'

const [slug, email, ...flags] = process.argv.slice(2)
const sole = flags.includes('--sole')
const password = process.env.KHAPEE_PASSWORD ?? ''

if (!slug || !email) {
  console.error('\n  Usage: KHAPEE_PASSWORD=… npx tsx scripts/operator.ts <slug> <email> [--sole]\n')
  process.exit(1)
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(`\n  "${email}" does not look like an email address.\n`)
  process.exit(1)
}

const restaurant = db.prepare('SELECT id, name FROM restaurants WHERE slug = ?').get(slug) as any
if (!restaurant) {
  console.error(`\n  No restaurant with slug "${slug}".\n`)
  process.exit(1)
}

const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as any
if (!existing && !password) {
  console.error(`\n  ${email} has no account yet, so KHAPEE_PASSWORD is needed to make one.\n`)
  process.exit(1)
}
if (password && password.length < 8) {
  console.error('\n  Use at least 8 characters, the same as the app asks for.\n')
  process.exit(1)
}

const removed: string[] = []

db.transaction(() => {
  let id: number
  if (existing) {
    id = existing.id
    // Only touched when a new password was actually supplied: an address that
    // already belongs to someone keeps the password they chose otherwise.
    if (password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    }
  } else {
    id = Number(
      db
        .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(restaurant.name, email.toLowerCase(), hashPassword(password), 'staff').lastInsertRowid,
    )
  }

  db.prepare(
    'INSERT OR IGNORE INTO restaurant_staff (user_id, restaurant_id, job_title) VALUES (?, ?, ?)',
  ).run(id, restaurant.id, 'Owner')

  if (sole) {
    const others = db
      .prepare(
        `SELECT u.id, u.email FROM users u
           JOIN restaurant_staff rs ON rs.user_id = u.id
          WHERE rs.restaurant_id = ? AND u.id <> ?`,
      )
      .all(restaurant.id, id) as any[]
    for (const o of others) {
      // Only their key to this restaurant is taken. The account itself stays —
      // it may run other restaurants, and it certainly has its own orders.
      db.prepare('DELETE FROM restaurant_staff WHERE user_id = ? AND restaurant_id = ?').run(o.id, restaurant.id)
      removed.push(o.email)
    }
  }
})()

const now = db
  .prepare(
    `SELECT u.email, rs.job_title FROM users u
       JOIN restaurant_staff rs ON rs.user_id = u.id
      WHERE rs.restaurant_id = ? ORDER BY u.id`,
  )
  .all(restaurant.id) as any[]

for (const e of removed) console.log(`  ${e} no longer operates ${restaurant.name}`)
console.log(`\n  ${restaurant.name} (#${restaurant.id}) is run by:`)
for (const s of now) console.log(`    ${s.email}  ·  ${s.job_title}`)
console.log(
  password
    ? `\n  Password set. Change it from Your restaurant → Sign in.\n`
    : `\n  Existing account — its own password is unchanged.\n`,
)
