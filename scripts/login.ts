/**
 * Issues a dashboard login for a restaurant.
 *
 *   npx tsx scripts/login.ts shyam-sandwich
 *   npx tsx scripts/login.ts shyam-sandwich ice-balls jain-shree
 *   npx tsx scripts/login.ts shyam-sandwich --email owner@theirdomain.com
 *   npx tsx scripts/login.ts cafe-vijay-bhaiya-saket-wale --password 'theirs123'
 *
 * A restaurant imported from its menu gets a placeholder login on a shared
 * demo password — an address that reaches nobody, and a password anybody who
 * has seen another import already knows. That is not a login, it is a door
 * left open, and it stays open until somebody notices it.
 *
 * This replaces it with one account per restaurant on a password generated
 * here and printed once. The password is never stored in readable form and
 * cannot be recovered afterwards: hand it over, and whoever runs the place
 * changes it from Settings.
 *
 * Safe to run twice. An address that already exists keeps its own password —
 * this script has no business rewriting somebody's password to give them
 * access they may already have — and is simply added to the restaurant.
 */
import crypto from 'node:crypto'
import { db } from '../server/db.ts'
import { hashPassword } from '../server/auth.ts'

/** No 0/O or 1/I/L, because these get read aloud and copied off a screen. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Three groups of four, hyphenated.
 *
 * Sixty bits, which is far past guessing, and still something somebody can
 * read off a screen and type on a phone without getting it wrong twice. A
 * password nobody can type accurately gets written on a sticky note stuck to
 * the till, which is worse than a shorter one.
 */
function makePassword(): string {
  const bytes = crypto.randomBytes(12)
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length])
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-')
}

/** The placeholder logins an import leaves behind, which reach nobody. */
const PLACEHOLDER = /@(tablo|ordro|khapee)\.local$/

const args = process.argv.slice(2)
const emailFlag = args.indexOf('--email')
const forcedEmail = emailFlag >= 0 ? args[emailFlag + 1] : ''
/**
 * A password chosen rather than generated.
 *
 * Normally this makes one, because a password somebody picks for a shop is
 * usually the shop's name and a number. But the owner is allowed to choose:
 * it is their business, and a password they can remember and actually use
 * beats a strong one taped to the monitor. It resets an existing account too,
 * which is the case this exists for — an account nobody can get into.
 */
const passFlag = args.indexOf('--password')
const chosenPassword = passFlag >= 0 ? String(args[passFlag + 1] ?? '') : ''
if (passFlag >= 0 && chosenPassword.length < 8) {
  console.error('\n  A password needs at least 8 characters.\n')
  process.exit(1)
}
// Guard the "+ 1" behind the flag actually being there: indexOf returns -1
// when it is not, and -1 + 1 is 0, which silently swallowed the first slug.
const emailValueAt = emailFlag >= 0 ? emailFlag + 1 : -1
const passValueAt = passFlag >= 0 ? passFlag + 1 : -1
const slugs = args.filter((a, i) => !a.startsWith('--') && i !== emailValueAt && i !== passValueAt)

if (!slugs.length) {
  console.error('\n  Usage: npx tsx scripts/login.ts <slug> [more slugs] [--email you@example.com]\n')
  process.exit(1)
}
if (forcedEmail && slugs.length > 1) {
  console.error('\n  One --email cannot serve several restaurants. Run them one at a time.\n')
  process.exit(1)
}

/** shyam-sandwich → shyam.sandwich@khapee.com */
function addressFor(slug: string): string {
  return `${slug.replace(/-/g, '.')}@khapee.com`
}

const issued: { restaurant: string; email: string; password: string }[] = []

for (const slug of slugs) {
  const restaurant = db.prepare('SELECT id, name FROM restaurants WHERE slug = ?').get(slug) as any
  if (!restaurant) {
    console.error(`  ! no restaurant with slug "${slug}" — skipped`)
    continue
  }

  const email = (forcedEmail || addressFor(slug)).trim().toLowerCase()
  const existing = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email) as any
  let password = ''

  db.transaction(() => {
    let userId: number
    if (existing) {
      userId = existing.id
      // An existing account's password is theirs and is left alone — unless
      // one was named, which is the whole point of --password: getting back
      // into an account nobody can sign in to.
      if (chosenPassword) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(chosenPassword), userId)
        password = chosenPassword
      }
    } else {
      password = chosenPassword || makePassword()
      userId = Number(
        db
          .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
          .run(restaurant.name, email, hashPassword(password), 'staff').lastInsertRowid,
      )
    }

    db.prepare(
      'INSERT OR IGNORE INTO restaurant_staff (user_id, restaurant_id, job_title) VALUES (?, ?, ?)',
    ).run(userId, restaurant.id, 'Owner')

    // Every other way in that nobody can receive mail at. Left in place, a
    // placeholder on a shared demo password is a second door into somebody's
    // orders and customer numbers, and nothing on screen ever mentions it.
    const others = db
      .prepare(
        `SELECT u.id, u.email FROM users u
           JOIN restaurant_staff rs ON rs.user_id = u.id
          WHERE rs.restaurant_id = ? AND u.id <> ?`,
      )
      .all(restaurant.id, userId) as any[]
    for (const other of others) {
      if (!PLACEHOLDER.test(other.email)) continue
      db.prepare('DELETE FROM users WHERE id = ?').run(other.id)
      console.log(`  removed placeholder login ${other.email}`)
    }
  })()

  issued.push({
    restaurant: restaurant.name,
    email,
    password: password || '(unchanged - this address already had an account)',
  })
}

console.log('')
for (const row of issued) {
  console.log(`  ${row.restaurant}`)
  console.log(`    email     ${row.email}`)
  console.log(`    password  ${row.password}`)
  console.log('')
}
console.log(
  chosenPassword
    ? '  Set as asked. Nothing readable is stored - only the hash.\n'
    : '  Printed once and not stored. Hand them over, then change them from Settings.\n',
)

/**
 * Changing a password invalidates every signed-in session on that account.
 *
 * Session tokens are signed over the password hash, so they all stop working
 * the moment it changes — which is correct, and is also a surprise if nobody
 * says so. Whoever was signed in on a phone or a till has to sign in again.
 */
if (chosenPassword) {
  console.log('  Anyone signed in on this account is signed out and must sign in again.\n')
}
