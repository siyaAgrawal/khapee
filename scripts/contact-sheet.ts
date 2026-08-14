/** Builds a numbered contact sheet of a restaurant's photo library. */
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../server/db.ts'

const [, , key, outName, fromArg, countArg] = process.argv
const restaurant = db
  .prepare('SELECT * FROM restaurants WHERE lower(name) = lower(?) OR slug = lower(?)')
  .get(key, key) as any
if (!restaurant) {
  console.error('no such restaurant'); process.exit(1)
}
const from = Number(fromArg ?? 0)
const count = Number(countArg ?? 500)
const photos = db
  .prepare('SELECT id, file FROM photo_library WHERE restaurant_id = ? ORDER BY id LIMIT ? OFFSET ?')
  .all(restaurant.id, count, from) as any[]

const cells = photos
  .map((p) => `<figure><img src="/api/uploads/${p.file}"><figcaption>${p.id}</figcaption></figure>`)
  .join('')
fs.mkdirSync('public/_sheet', { recursive: true })
fs.writeFileSync(
  path.join('public/_sheet', outName),
  `<!doctype html><meta charset=utf-8><style>
   body{margin:0;background:#fff;font:700 20px/1 system-ui}
   .g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px}
   figure{margin:0;position:relative;aspect-ratio:1;overflow:hidden;background:#eee}
   img{width:100%;height:100%;object-fit:cover;display:block}
   figcaption{position:absolute;left:6px;top:6px;background:rgba(0,0,0,.82);color:#fff;padding:2px 8px;border-radius:6px;font-size:15px}
   </style><div class=g>${cells}</div>`,
)
console.log(`${photos.length} photos → public/_sheet/${outName} (ids ${photos[0]?.id}–${photos.at(-1)?.id})`)
