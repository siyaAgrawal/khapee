/**
 * Attaches local image files to menu items, matching dishes by name.
 *
 *   npx tsx scripts/attach-photos.ts <restaurant> <mapping.json>
 *
 * The mapping is { "Dish Name": "/path/to/photo.jpg", ... }. Names are matched
 * case-insensitively against that restaurant's menu; anything that does not
 * match exactly one dish is reported and skipped rather than guessed at.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { db, UPLOAD_DIR } from '../server/db.ts'

const [, , restaurantKey, mappingFile] = process.argv
if (!restaurantKey || !mappingFile) {
  console.error('\n  Usage: tsx scripts/attach-photos.ts <restaurant name or slug> <mapping.json>\n')
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
const mapping: Record<string, string> = JSON.parse(fs.readFileSync(path.resolve(mappingFile), 'utf8'))

let attached = 0
const problems: string[] = []

for (const [dishName, imagePath] of Object.entries(mapping)) {
  const matches = db
    .prepare('SELECT id, name, image_path FROM menu_items WHERE restaurant_id = ? AND lower(name) = lower(?)')
    .all(restaurant.id, dishName) as any[]

  if (matches.length === 0) {
    problems.push(`no dish called "${dishName}"`)
    continue
  }
  if (matches.length > 1) {
    problems.push(`"${dishName}" matches ${matches.length} dishes — skipped`)
    continue
  }

  const source = path.resolve(imagePath)
  const ext = path.extname(source).toLowerCase()
  if (!EXT.has(ext)) {
    problems.push(`"${dishName}": ${ext || 'no extension'} is not an image`)
    continue
  }
  if (!fs.existsSync(source)) {
    problems.push(`"${dishName}": file not found — ${source}`)
    continue
  }

  const file = `${crypto.randomBytes(10).toString('hex')}${ext === '.jpeg' ? '.jpg' : ext}`
  fs.copyFileSync(source, path.join(UPLOAD_DIR, file))

  const previous = matches[0].image_path
  db.prepare('UPDATE menu_items SET image_path = ? WHERE id = ?').run(file, matches[0].id)
  if (previous) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(previous)))
    } catch {
      /* already gone */
    }
  }
  console.log(`  ✓ ${matches[0].name}`)
  attached++
}

const withPhotos = db
  .prepare('SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = ? AND image_path IS NOT NULL')
  .get(restaurant.id) as any
const total = db
  .prepare('SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = ?')
  .get(restaurant.id) as any

if (problems.length) {
  console.log(`\n  ${problems.length} skipped:`)
  for (const p of problems) console.log(`    · ${p}`)
}
console.log(`\n  Attached ${attached}. ${restaurant.name}: ${withPhotos.n}/${total.n} dishes now have a photo.\n`)
