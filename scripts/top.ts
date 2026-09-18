/**
 * Puts a restaurant at the top of the list customers open the app to.
 *
 *   npx tsx scripts/top.ts revery 100
 *   npx tsx scripts/top.ts revery 0        # back into the ordinary order
 *   npx tsx scripts/top.ts                 # show who is pinned now
 *
 * The list is otherwise open-first then alphabetical, and nearest-first once
 * the customer shares a position. A rank above zero beats both: "the one you
 * see first" is a decision somebody makes, not something the alphabet or a
 * distance happens to get right. Highest rank wins, so leave gaps.
 */
import { db } from '../server/db.ts'

const [slug, rankArg] = process.argv.slice(2)

if (!slug) {
  const pinned = db
    .prepare('SELECT slug, name, top_rank FROM restaurants WHERE top_rank <> 0 ORDER BY top_rank DESC')
    .all() as any[]
  if (!pinned.length) console.log('\n  Nobody is pinned — the list is open-first, then alphabetical.\n')
  else {
    console.log('')
    for (const r of pinned) console.log(`  ${String(r.top_rank).padStart(4)}  ${r.name}  (${r.slug})`)
    console.log('')
  }
  process.exit(0)
}

const restaurant = db.prepare('SELECT * FROM restaurants WHERE slug = ?').get(slug) as any
if (!restaurant) {
  console.error(`\n  No restaurant with slug "${slug}".\n`)
  process.exit(1)
}

const rank = Math.trunc(Number(rankArg ?? 100))
if (!Number.isFinite(rank)) {
  console.error(`\n  "${rankArg}" is not a number.\n`)
  process.exit(1)
}

db.prepare('UPDATE restaurants SET top_rank = ? WHERE id = ?').run(rank, restaurant.id)

console.log(`
  ${restaurant.name} (#${restaurant.id})
    was:  ${restaurant.top_rank ?? 0}
    now:  ${rank}${rank > 0 ? '  ·  shown first, before the alphabet and before nearest-first' : '  ·  back in the ordinary order'}
`)
