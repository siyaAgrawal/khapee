/** Assigns library photos to dishes: { "<photoId>": "Dish Name", ... } */
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../server/db.ts'

const [, , key, mapFile] = process.argv
const restaurant = db
  .prepare('SELECT * FROM restaurants WHERE lower(name) = lower(?) OR slug = lower(?)')
  .get(key, key) as any
if (!restaurant) { console.error('no such restaurant'); process.exit(1) }

const map: Record<string, string> = JSON.parse(fs.readFileSync(path.resolve(mapFile), 'utf8'))
let ok = 0
const skipped: string[] = []

for (const [photoId, dish] of Object.entries(map)) {
  const photo = db.prepare('SELECT * FROM photo_library WHERE id = ? AND restaurant_id = ?')
    .get(Number(photoId), restaurant.id) as any
  if (!photo) { skipped.push(`photo ${photoId} not in this library`); continue }
  const items = db.prepare('SELECT id, name FROM menu_items WHERE restaurant_id = ? AND lower(name) = lower(?)')
    .all(restaurant.id, dish) as any[]
  if (items.length !== 1) { skipped.push(`"${dish}" matched ${items.length} dishes`); continue }

  db.transaction(() => {
    db.prepare('UPDATE photo_library SET assigned_item = NULL WHERE assigned_item = ?').run(items[0].id)
    db.prepare('UPDATE photo_library SET assigned_item = ? WHERE id = ?').run(items[0].id, photo.id)
    db.prepare('UPDATE menu_items SET image_path = ? WHERE id = ?').run(photo.file, items[0].id)
  })()
  ok++
}
const done = db.prepare('SELECT COUNT(*) n FROM menu_items WHERE restaurant_id = ? AND image_path IS NOT NULL')
  .get(restaurant.id) as any
const all = db.prepare('SELECT COUNT(*) n FROM menu_items WHERE restaurant_id = ?').get(restaurant.id) as any
if (skipped.length) { console.log('  skipped:'); skipped.forEach(s => console.log('   ·', s)) }
console.log(`\n  Assigned ${ok}. ${restaurant.name}: ${done.n}/${all.n} dishes have a photo.\n`)
