/**
 * Loads a folder of photos into a restaurant's photo library, ready to be
 * assigned to dishes in the dashboard.
 *
 *   npx tsx scripts/import-photos.ts "Yazu at the Dome" /path/to/folder
 *
 * Also unpacks Apple Pages documents, which store their images in Data/.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { db, UPLOAD_DIR } from '../server/db.ts'

const [, , restaurantKey, source] = process.argv
if (!restaurantKey || !source) {
  console.error('\n  Usage: tsx scripts/import-photos.ts <restaurant> <folder or .pages file>\n')
  process.exit(1)
}

const restaurant = db
  .prepare('SELECT * FROM restaurants WHERE lower(name) = lower(?) OR slug = lower(?)')
  .get(restaurantKey, restaurantKey) as any
if (!restaurant) {
  console.error(`  No restaurant matching "${restaurantKey}"`)
  process.exit(1)
}

const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
let folder = path.resolve(source)

// A .pages document is a zip; its pictures live in Data/.
if (folder.endsWith('.pages') && fs.statSync(folder).isFile()) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'))
  execFileSync('unzip', ['-qq', '-o', folder, '-d', tmp])
  folder = path.join(tmp, 'Data')
  console.log(`  unpacked ${path.basename(source)}`)
}

const files = fs
  .readdirSync(folder)
  .filter((f) => EXT.has(path.extname(f).toLowerCase()))
  // Skip Pages' own template assets and the half-size duplicates it stores.
  .filter((f) => !/^(PresetImageFill|bullet_)/.test(f) && !/-small-/.test(f))
  .sort((a, b) => {
    const na = Number(a.match(/(\d+)/)?.[1] ?? 0)
    const nb = Number(b.match(/(\d+)/)?.[1] ?? 0)
    return na - nb || a.localeCompare(b)
  })

let added = 0
const insert = db.prepare(
  'INSERT INTO photo_library (restaurant_id, file, source) VALUES (?, ?, ?)',
)
for (const f of files) {
  const ext = path.extname(f).toLowerCase()
  const stored = `${crypto.randomBytes(10).toString('hex')}${ext === '.jpeg' ? '.jpg' : ext}`
  fs.copyFileSync(path.join(folder, f), path.join(UPLOAD_DIR, stored))
  insert.run(restaurant.id, stored, path.basename(source))
  added++
}

const total = db
  .prepare('SELECT COUNT(*) AS n FROM photo_library WHERE restaurant_id = ?')
  .get(restaurant.id) as any
console.log(`\n  Added ${added} photos to ${restaurant.name}. Library now holds ${total.n}.`)
console.log(`  Assign them under Dashboard → Photos.\n`)
