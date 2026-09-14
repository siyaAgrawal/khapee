/**
 * Sets where a restaurant's in-app payments go.
 *
 *   npx tsx scripts/upi.ts revery vibhanshi@ybl "VIBHANSHI JAIN"
 *   npx tsx scripts/upi.ts revery --clear
 *
 * Khapee takes no payment itself: it builds a upi://pay link with the amount
 * and a reference already in it, the customer pays from their own UPI app
 * straight into this address, and staff confirm it under Payments. Nothing is
 * routed through a provider, so this one string decides who receives the money.
 *
 * --clear removes it, which turns the in-app option off and leaves paying at
 * the counter. That is the right state whenever the address is not known to be
 * correct: an unpayable link is better than a payable one aimed at a stranger.
 */
import { db } from '../server/db.ts'

const [slug, vpaArg, nameArg] = process.argv.slice(2)
const clear = vpaArg === '--clear'

if (!slug || !vpaArg) {
  console.error('\n  Usage: npx tsx scripts/upi.ts <slug> <upi-id|--clear> [payee name]\n')
  process.exit(1)
}

const restaurant = db.prepare('SELECT * FROM restaurants WHERE slug = ?').get(slug) as any
if (!restaurant) {
  console.error(`\n  No restaurant with slug "${slug}".\n`)
  process.exit(1)
}

let vpa = ''
if (!clear) {
  vpa = vpaArg.trim()
  // The same shape the app enforces when a restaurant types it in itself.
  if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(vpa)) {
    console.error(`\n  "${vpa}" does not look like a UPI ID (e.g. name@ybl).\n`)
    process.exit(1)
  }
  // A placeholder passes that pattern and reaches nobody, which is worse than
  // having none: the app would offer to take payment and then fail, or pay out
  // to whoever happens to own it.
  if (/^(placeholder|example|test|changeme)@/i.test(vpa)) {
    console.error(`\n  "${vpa}" is a placeholder, not a real address.\n`)
    process.exit(1)
  }
}

const name = clear ? '' : (nameArg ?? restaurant.upi_name ?? restaurant.name).trim().slice(0, 80)

const before = { vpa: restaurant.upi_vpa ?? '', name: restaurant.upi_name ?? '' }
db.prepare('UPDATE restaurants SET upi_vpa = ?, upi_name = ? WHERE id = ?').run(vpa, name, restaurant.id)

console.log(`\n  ${restaurant.name} (#${restaurant.id})`)
console.log(`    was:  ${before.vpa || '(none)'}${before.name ? `  ·  ${before.name}` : ''}`)
console.log(`    now:  ${vpa || '(none — paying at the counter only)'}${name ? `  ·  ${name}` : ''}`)
if (vpa) {
  console.log(`\n  A ₹450 order would send the customer to:`)
  console.log(`    upi://pay?pa=${vpa}&pn=${encodeURIComponent(name)}&am=450.00&cu=INR&tn=…&tr=…`)
  console.log(`\n  Check that name is who should receive the money before going live.`)
}
console.log()
