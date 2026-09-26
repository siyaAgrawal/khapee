// Downloads Litestream (the database backup tool) into bin/, checked against
// the checksum published with the release. Runs after `npm run build` on
// Render, and from scripts/start.sh if the binary is somehow missing.
// Does nothing on any other machine unless asked.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VERSION = '0.5.17'
const force = process.argv.includes('--force')
if (!process.env.RENDER && !process.env.BACKUP_BUCKET && !force) process.exit(0)

const os = process.platform === 'darwin' ? 'darwin' : 'linux'
const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
const name = `litestream-${VERSION}-${os}-${arch}.tar.gz`
const base = `https://github.com/benbjohnson/litestream/releases/download/v${VERSION}`
const bin = path.resolve(import.meta.dirname, '..', 'bin')
const target = path.join(bin, 'litestream')
if (fs.existsSync(target) && !force) process.exit(0)

async function get(url) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

const [tarball, sums] = await Promise.all([get(`${base}/${name}`), get(`${base}/checksums.txt`)])
const want = sums
  .toString()
  .split('\n')
  .find((l) => l.trim().endsWith(name))
  ?.split(/\s+/)[0]
const have = crypto.createHash('sha256').update(tarball).digest('hex')
if (!want || want !== have) throw new Error(`litestream checksum mismatch for ${name}`)

fs.mkdirSync(bin, { recursive: true })
const tmp = path.join(bin, name)
fs.writeFileSync(tmp, tarball)
execFileSync('tar', ['xzf', tmp, '-C', bin, 'litestream'])
fs.rmSync(tmp)
fs.chmodSync(target, 0o755)
console.log(`[backup] litestream ${VERSION} ready (${os}-${arch}, checksum ok)`)
