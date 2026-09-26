/**
 * Proves Khapee's server really sends a push, without a phone.
 *
 * A push service is just an HTTPS endpoint the browser vendor hands out. So
 * this stands one up locally, registers a device whose endpoint points at it
 * with a genuine ECDH keypair, places a real order, and reports whether an
 * encrypted, VAPID-signed request actually arrived.
 *
 * It separates the two failures that look identical from behind a counter:
 * our server not sending, and the phone never having registered.
 */
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

/** A throwaway certificate, so the probe needs nothing prepared beforehand. */
function selfSigned(): { key: string; cert: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khapee-probe-'))
  const key = path.join(dir, 'key.pem')
  const crt = path.join(dir, 'cert.pem')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', crt,
    '-days', '1', '-nodes', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' })
  const pair = { key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(crt, 'utf8') }
  fs.rmSync(dir, { recursive: true, force: true })
  return pair
}


const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'khapee-push-')), 'probe.db')
process.env.KHAPEE_DB = DB
process.env.KHAPEE_SECRET = 'probe-secret-stable-across-this-run'
// The push protocol is HTTPS only, so the local service speaks TLS too.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const arrived: { url: string; auth: string; encoding: string; bytes: number }[] = []
const service = https.createServer(
  selfSigned(),
  (req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    arrived.push({
      url: req.url ?? '',
      auth: String(req.headers.authorization ?? '').slice(0, 24) + '…',
      encoding: String(req.headers['content-encoding'] ?? ''),
      bytes: Buffer.concat(chunks).length,
    })
    res.writeHead(201).end()
  })
  },
)
await new Promise<void>((r) => service.listen(4466, '127.0.0.1', r))

const { db } = await import('../server/db.ts')
const { pushConfigured, pushPublicKey, saveSubscription, pushToRestaurant } = await import(
  '../server/push.ts'
)

console.log('push configured:', pushConfigured())
console.log('public key     :', pushPublicKey().slice(0, 20) + '…')

// A restaurant and a staff account to own the device.
db.prepare("INSERT OR IGNORE INTO restaurants (id, slug, name) VALUES (1, 'probe', 'Probe Cafe')").run()
db.prepare(
  "INSERT OR IGNORE INTO users (id, name, email, password_hash, role) VALUES (1, 'Owner', 'probe@khapee.local', 'x', 'staff')",
).run()
db.prepare('INSERT OR IGNORE INTO restaurant_staff (user_id, restaurant_id) VALUES (1, 1)').run()

// A real subscription: the keys must be genuine or encryption fails.
const ecdh = crypto.createECDH('prime256v1')
ecdh.generateKeys()
const sub = {
  endpoint: 'https://localhost:4466/push/device-one',
  keys: {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: crypto.randomBytes(16).toString('base64url'),
  },
}
console.log('saved device   :', saveSubscription(1, 1, sub, 'Probe phone', false))

const result = await pushToRestaurant(1, {
  title: '#D473 needs your yes',
  body: 'Table 4 · Dev Patel · ₹460 · unpaid',
  url: '/staff/orders',
  tag: 'order-D473',
})

console.log('\nsend result   :', result)
console.log('requests that reached the push service:', arrived.length)
for (const a of arrived) console.log(' ', a)

service.close()
process.exit(0)
