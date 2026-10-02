/**
 * Restaurants that joined after the database stopped being shipped.
 *
 * Khapee used to deploy its data: a snapshot committed beside the code, laid
 * down on each cold start. A new restaurant was a change to that file. Since
 * the live database became durable, the snapshot only seeds a fresh install —
 * so a restaurant added that way is visible on a laptop and nowhere else.
 *
 * This is the gap closed. Each file named here is imported once, on the first
 * boot that has not already done it, and the fact is recorded in `data_fixes`
 * so it never runs twice. The import itself is keyed on the restaurant's name
 * and skips one that already exists, which makes this safe twice over.
 *
 * It is not a migration system and should not grow into one. A restaurant that
 * is already live is edited from its own dashboard; this is only for getting it
 * there the first time.
 */
import fs from 'node:fs'
import path from 'node:path'
import { db } from './db.ts'
import { importFile } from './import.ts'

/** Each entry runs once, under the name given. Never reuse a name. */
const ARRIVALS: { fix: string; file: string }[] = [
  { fix: '2026-10-02-komals-cake-shop', file: 'data/komals-cake-shop.json' },
]

export function importNewArrivals(): void {
  for (const { fix, file } of ARRIVALS) {
    if (db.prepare('SELECT 1 FROM data_fixes WHERE name = ?').get(fix)) continue
    const absolute = path.resolve(file)
    if (!fs.existsSync(absolute)) {
      console.warn(`[arrivals] ${file} is missing — skipping ${fix}`)
      continue
    }
    try {
      importFile(absolute)
      db.prepare('INSERT INTO data_fixes (name) VALUES (?)').run(fix)
      console.log(`[arrivals] applied ${fix}`)
    } catch (err) {
      // A bad file must not stop the server coming up: a restaurant that did
      // not arrive is a smaller problem than an app that will not start.
      console.error(`[arrivals] ${fix} failed:`, (err as Error).message)
    }
  }
}
