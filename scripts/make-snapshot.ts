/**
 * Builds the seed a serverless deploy boots from.
 *
 *   npx tsx scripts/make-snapshot.ts
 *
 * Vercel gives the app a read-only disk and a /tmp that does not survive a cold
 * start, so it runs on a copy of `data/snapshot.db` with photos copied beside
 * it. This script makes that pair from the working database:
 *
 *  - checkpoints the write-ahead log, so recent work is actually in the file;
 *  - drops `sessions` — those are live login tokens and must not ship;
 *  - drops `photo_library`, the local pool of not-yet-assigned photos, whose
 *    files stay on this machine;
 *  - copies only the photos a restaurant or dish actually points at.
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const dataDir = path.resolve(import.meta.dirname, '..', 'data')
const source = process.env.TABLO_DB ? path.resolve(process.env.TABLO_DB) : path.join(dataDir, 'tablo.db')
const snapshot = path.join(dataDir, 'snapshot.db')
const uploads = path.join(dataDir, 'uploads')
const snapshotUploads = path.join(dataDir, 'snapshot-uploads')

if (!fs.existsSync(source)) {
  console.error(`\n  No working database at ${source}\n`)
  process.exit(1)
}

const live = new Database(source)
live.pragma('wal_checkpoint(TRUNCATE)')

fs.rmSync(snapshot, { force: true })
// VACUUM INTO writes a clean, fully-checkpointed copy — no -wal alongside it.
live.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`)
live.close()

const copy = new Database(snapshot)
const sessions = copy.prepare('DELETE FROM sessions').run().changes
const library = copy.prepare('DELETE FROM photo_library').run().changes

const referenced = new Set<string>()
for (const table of ['restaurants', 'menu_items']) {
  for (const row of copy
    .prepare(`SELECT image_path AS p FROM ${table} WHERE image_path IS NOT NULL AND image_path <> ''`)
    .all() as any[]) {
    referenced.add(path.basename(row.p))
  }
}
copy.close()

fs.rmSync(snapshotUploads, { recursive: true, force: true })
fs.mkdirSync(snapshotUploads, { recursive: true })

let copied = 0
let missing = 0
let bytes = 0
for (const file of referenced) {
  const from = path.join(uploads, file)
  if (!fs.existsSync(from)) {
    missing++
    continue
  }
  fs.copyFileSync(from, path.join(snapshotUploads, file))
  bytes += fs.statSync(from).size
  copied++
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB'
const counts = new Database(snapshot)
const count = (t: string) => (counts.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n
console.log(`
  Snapshot written to data/snapshot.db (${mb(fs.statSync(snapshot).size)})
    ${count('restaurants')} restaurants, ${count('menu_items')} dishes, ${count('users')} accounts, ${count('orders')} orders
    dropped ${sessions} login session${sessions === 1 ? '' : 's'} and ${library} unassigned photo rows

  Photos in data/snapshot-uploads (${mb(bytes)})
    ${copied} copied${missing ? `, ${missing} referenced but not on disk` : ''}
`)
counts.close()
