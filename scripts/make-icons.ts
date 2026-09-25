/**
 * Draws the home-screen icons.
 *
 *   npx tsx scripts/make-icons.ts
 *
 * iOS insists on PNG for `apple-touch-icon`, and this machine has no image
 * tooling, so the pixels are written directly: a rounded dark tile with the
 * Khapee mark on it, encoded as a PNG by hand. Deterministic, and no dependency
 * to install for a file that changes about once a year.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const OUT = path.resolve(import.meta.dirname, '..', 'public')
fs.mkdirSync(OUT, { recursive: true })

const BG: [number, number, number] = [0x0e, 0x0e, 0x0d] // app background
const FG: [number, number, number] = [0xf5, 0xf1, 0xe8] // the cream used for text

/** One PNG chunk: length, type, payload, CRC. */
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) | 0
}

function writePng(file: string, size: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  // Raw scanlines, each prefixed with filter byte 0.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  fs.writeFileSync(
    path.join(OUT, file),
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

/** Coverage of a disc, sampled 3x3 per pixel so edges are not jagged. */
function discCoverage(x: number, y: number, cx: number, cy: number, r: number): number {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3
      const py = y + (sy + 0.5) / 3
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) hits++
    }
  }
  return hits / 9
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/**
 * The mark: a filled disc with a bite taken out of its left side, which is the
 * same ◗ shape the header uses. Drawn as one disc minus another, offset.
 */
function markCoverage(x: number, y: number, size: number): number {
  // The bite pushes the shape's visual weight right, so the disc is set left of
  // centre to compensate — otherwise the mark looks off in the home-screen tile.
  const cx = size * 0.45
  const cy = size * 0.5
  const r = size * 0.28
  const solid = discCoverage(x, y, cx, cy, r)
  if (solid === 0) return 0
  const bite = discCoverage(x, y, cx - r * 0.62, cy, r * 0.78)
  return Math.max(0, solid - bite)
}

// Maskable icons must keep their content inside the safe zone, since Android
// crops them to whatever shape the launcher wants.
function tile(size: number, radius: number) {
  return (x: number, y: number): [number, number, number, number] => {
    const inCorner =
      (x < radius && y < radius && (x - radius) ** 2 + (y - radius) ** 2 > radius ** 2) ||
      (x >= size - radius && y < radius && (x - (size - radius)) ** 2 + (y - radius) ** 2 > radius ** 2) ||
      (x < radius && y >= size - radius && (x - radius) ** 2 + (y - (size - radius)) ** 2 > radius ** 2) ||
      (x >= size - radius &&
        y >= size - radius &&
        (x - (size - radius)) ** 2 + (y - (size - radius)) ** 2 > radius ** 2)
    if (inCorner) return [0, 0, 0, 0]
    const t = markCoverage(x, y, size)
    const [r, g, b] = mix(BG, FG, t)
    return [r, g, b, 255]
  }
}

const targets = [
  { file: 'icon-192.png', size: 192, radius: 0 },
  { file: 'icon-512.png', size: 512, radius: 0 },
  // iOS draws its own rounded corners over apple-touch-icon, so this one is a
  // full square — rounding it ourselves would show dark corners behind theirs.
  { file: 'apple-touch-icon.png', size: 180, radius: 0 },
  { file: 'favicon-32.png', size: 32, radius: 0 },
]

for (const t of targets) {
  writePng(t.file, t.size, tile(t.size, t.radius))
  const bytes = fs.statSync(path.join(OUT, t.file)).size
  console.log(`  ${t.file.padEnd(22)} ${t.size}x${t.size}  ${(bytes / 1024).toFixed(1)} kB`)
}
