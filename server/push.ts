/**
 * Telling a restaurant an order has arrived, when nobody is looking at the
 * dashboard.
 *
 * The board already chimes and raises a notification while it is open, which
 * is no use at all: the person who needs telling is in the kitchen with the
 * tab closed, or the phone in a pocket. Web Push reaches a device that is not
 * looking at the page.
 *
 * It is the one way of doing this that needs no account anywhere. The keys are
 * generated on this machine, the message is signed here, and it is delivered by
 * the push service the customer's own browser already uses — no provider, no
 * API key issued to us, nothing billed per message. What it does need is for
 * the keypair to stay the same between restarts, because a subscription is
 * bound to the public key that created it: set VAPID_PUBLIC and VAPID_PRIVATE
 * in the environment anywhere the disk does not survive a deploy. Locally the
 * pair is generated once into data/.vapid.json.
 *
 * On iPhone the dashboard has to be added to the Home Screen first — Safari
 * only allows push to an installed web app. Android and desktop need nothing.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import webpush from 'web-push'
import { db } from './db.ts'

const KEY_FILE = path.resolve(import.meta.dirname, '..', 'data', '.vapid.json')

/**
 * Whether this host keeps its disk between deploys.
 *
 * It does not on the free plan — the database itself is rebuilt from the
 * committed snapshot on every boot, which is what ORDRO_SEED means. A keypair
 * written to a disk like that is a new keypair every deploy, and every device
 * that had subscribed is silently unsubscribed with nothing to show for it.
 * Better to say push is not configured than to let it rot that way.
 */
const DISK_IS_TEMPORARY =
  !!process.env.VERCEL || (process.env.KHAPEE_SEED ?? process.env.ORDRO_SEED) === 'snapshot'

/** Why push is off, when it is. Empty when it is on. */
let reason = ''

/**
 * A keypair worked out from the server's own secret, rather than stored.
 *
 * The problem this solves is that a subscription is bound to the public key
 * that made it, so the pair has to be identical on every boot — and the host
 * this runs on keeps no disk. The usual answer is two more environment
 * variables somebody has to remember to set, and alerts that silently never
 * arrive until they do.
 *
 * But there is already a secret here that Render generates once and keeps
 * across every deploy, because login tokens depend on it: KHAPEE_SECRET. A
 * P-256 private key is only a number below the curve order, so one can be
 * derived from that secret and will be the same number every time. Nothing to
 * configure, nothing extra to keep safe, and no private key in the repository.
 *
 * The cost is that changing KHAPEE_SECRET unsubscribes every device — but that
 * already signs everybody out, so it is not a surprise hidden inside a working
 * system.
 */
const CURVE_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551')

function deriveKeys(secret: string): { publicKey: string; privateKey: string } | null {
  // HKDF gives 32 bytes that are almost certainly a valid scalar; the counter
  // is for the vanishing case where they are not, so this never returns an
  // invalid key rather than working out of a million.
  for (let i = 0; i < 256; i++) {
    const bytes = Buffer.from(
      crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(`khapee-vapid-v1:${i}`), 32),
    )
    const scalar = BigInt('0x' + bytes.toString('hex'))
    if (scalar <= 0n || scalar >= CURVE_ORDER) continue
    const ec = crypto.createECDH('prime256v1')
    ec.setPrivateKey(bytes)
    return { privateKey: bytes.toString('base64url'), publicKey: ec.getPublicKey().toString('base64url') }
  }
  return null
}

function loadKeys(): { publicKey: string; privateKey: string } | null {
  const fromEnv = {
    publicKey: String(process.env.VAPID_PUBLIC ?? '').trim(),
    privateKey: String(process.env.VAPID_PRIVATE ?? '').trim(),
  }
  if (fromEnv.publicKey && fromEnv.privateKey) return fromEnv

  // A host with no disk, but with the session secret that outlives its deploys.
  const secret = String(process.env.KHAPEE_SECRET ?? '').trim()
  if (DISK_IS_TEMPORARY) {
    if (secret.length >= 16) {
      const derived = deriveKeys(secret)
      if (derived) return derived
    }
    reason =
      'Set VAPID_PUBLIC and VAPID_PRIVATE in the environment — this host rebuilds its disk on every deploy, so a key kept in a file would unsubscribe every device each time.'
    return null
  }

  try {
    if (fs.existsSync(KEY_FILE)) {
      const saved = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'))
      if (saved?.publicKey && saved?.privateKey) return saved
    }
    // First run on a machine with a disk: make a pair and keep it. A server
    // with a read-only disk falls through to null and simply sends nothing,
    // rather than minting a new key on every boot and quietly breaking every
    // subscription it had.
    const made = webpush.generateVAPIDKeys()
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true })
    fs.writeFileSync(KEY_FILE, JSON.stringify(made, null, 2), { mode: 0o600 })
    return made
  } catch {
    reason = 'No push keypair, and none could be written.'
    return null
  }
}

const KEYS = loadKeys()
if (KEYS) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hello@khapee.com',
    KEYS.publicKey,
    KEYS.privateKey,
  )
}

export function pushConfigured(): boolean {
  return !!KEYS
}

/** What to tell somebody who switched alerts on and heard nothing. */
export function pushReason(): string {
  return KEYS ? '' : reason || 'Push alerts are not switched on for this server.'
}

/** The half of the pair a browser needs in order to subscribe. */
export function pushPublicKey(): string {
  return KEYS?.publicKey ?? ''
}

export type Subscription = {
  endpoint: string
  keys?: { p256dh?: string; auth?: string }
}

/**
 * Remembers a device so it can be told about orders later.
 *
 * An endpoint is the device, so re-subscribing simply moves it to whoever is
 * signed in now — a shared kitchen phone that changes hands should stop
 * ringing for the place it used to belong to.
 *
 * The restaurant recorded here is only the one that happened to be selected
 * when the switch was tapped. Who the device actually rings for is worked out
 * at send time from the account, because somebody who runs two places wants
 * both, and has no reason to guess that the picker at the top of the dashboard
 * was also choosing which orders would wake them.
 */
export function saveSubscription(
  userId: number | null,
  restaurantId: number,
  sub: Subscription,
  label = '',
  allRestaurants = false,
): { ok: boolean; error?: string } {
  const endpoint = String(sub?.endpoint ?? '').trim()
  const p256dh = String(sub?.keys?.p256dh ?? '').trim()
  const auth = String(sub?.keys?.auth ?? '').trim()
  if (!endpoint || !p256dh || !auth) return { ok: false, error: 'That subscription is incomplete.' }

  db.prepare(
    `INSERT INTO push_subscriptions (user_id, restaurant_id, endpoint, p256dh, auth, label, all_restaurants)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       restaurant_id = excluded.restaurant_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       label = excluded.label,
       all_restaurants = excluded.all_restaurants,
       -- Deliberately not reset. A device re-subscribes on every sign-in, and
       -- silently turning somebody's WhatsApp prompts back off each morning
       -- is indistinguishable from the feature being broken.
       failures = 0`,
  ).run(userId, restaurantId, endpoint, p256dh, auth, label, allRestaurants ? 1 : 0)
  return { ok: true }
}

export function dropSubscription(endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint ?? ''))
}

/**
 * Every device that should ring for this restaurant.
 *
 * Either it was subscribed while this restaurant was selected, or it belongs
 * to somebody who runs this restaurant — the second is what makes one phone
 * enough for an owner with two places.
 */
const DEVICES_FOR = `
  SELECT ps.* FROM push_subscriptions ps
   WHERE ps.all_restaurants = 1
      OR ps.restaurant_id = ?
      OR (ps.user_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM restaurant_staff rs
                       WHERE rs.user_id = ps.user_id AND rs.restaurant_id = ?))
`

export function subscriptionCount(restaurantId: number): number {
  const rows = db.prepare(DEVICES_FOR).all(restaurantId, restaurantId) as any[]
  return rows.length
}

/**
 * Every device signed up, and who signed it up.
 *
 * The account is the key here, not the device: anybody who can sign in to a
 * restaurant's dashboard can put its notifications — customer names and
 * numbers included — on a phone of their own. Nothing stops that, and nothing
 * should, since it is how the person at the counter gets alerts. But an owner
 * has to be able to see the list and take a phone off it, which needed the
 * list to exist.
 */
export function subscriptionList(restaurantId: number): any[] {
  return db
    .prepare(
      `SELECT ps.id, ps.endpoint, ps.created_at, ps.last_ok_at, ps.failures, ps.label, ps.wants_whatsapp,
              u.name AS who, u.email AS whose
         FROM (${DEVICES_FOR}) ps
         LEFT JOIN users u ON u.id = ps.user_id
        ORDER BY ps.id`,
    )
    .all(restaurantId, restaurantId) as any[]
}

/** Takes one device off, but only one belonging to this restaurant. */
/** Turn the WhatsApp thank-you prompt on or off for one device. */
export function setDeviceWhatsapp(restaurantId: number, id: number, wants: boolean): boolean {
  const mine = db
    .prepare(`SELECT id FROM (${DEVICES_FOR}) ps WHERE ps.id = ?`)
    .get(restaurantId, restaurantId, id) as any
  if (!mine) return false
  db.prepare('UPDATE push_subscriptions SET wants_whatsapp = ? WHERE id = ?').run(wants ? 1 : 0, id)
  return true
}

export function removeSubscription(restaurantId: number, id: number): boolean {
  const mine = db
    .prepare(`SELECT id FROM (${DEVICES_FOR}) ps WHERE ps.id = ?`)
    .get(restaurantId, restaurantId, id) as any
  if (!mine) return false
  db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id)
  return true
}

export type PushNote = {
  title: string
  body: string
  url?: string
  tag?: string
  /**
   * A whatsapp:// address to try before the page at `url`.
   *
   * Most browsers refuse to open a non-web address from a notification, so this
   * is an attempt and `url` is the answer; where it is allowed, it saves the
   * person a screen they had no interest in reading.
   */
  wa?: string
}

/**
 * Signs the customer's own phone up to hear about this one order.
 *
 * Against the order, not an account: almost nobody ordering a coffee makes an
 * account, and the receipt token they are already holding is proof enough that
 * the order is theirs. It costs nothing to send, forever — which is the whole
 * reason it exists beside a WhatsApp message that costs money per order.
 */
export function saveCustomerSubscription(orderId: number, sub: Subscription): { ok: boolean; error?: string } {
  const endpoint = String(sub?.endpoint ?? '').trim()
  const p256dh = String(sub?.keys?.p256dh ?? '').trim()
  const auth = String(sub?.keys?.auth ?? '').trim()
  if (!endpoint || !p256dh || !auth) return { ok: false, error: 'That subscription is incomplete.' }
  db.prepare(
    `INSERT INTO customer_push (order_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       order_id = excluded.order_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       failures = 0`,
  ).run(orderId, endpoint, p256dh, auth)
  return { ok: true }
}

/** Tells whoever is waiting on this order, and never throws. */
export async function pushToCustomer(orderId: number, note: PushNote): Promise<number> {
  if (!KEYS) return 0
  const rows = db.prepare('SELECT * FROM customer_push WHERE order_id = ?').all(orderId) as any[]
  if (!rows.length) return 0

  const payload = JSON.stringify({
    title: note.title,
    body: note.body,
    url: note.url ?? '/orders',
    tag: note.tag ?? `khapee-order-${orderId}`,
  })

  let sent = 0
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
          { TTL: 60 * 60 },
        )
        sent++
      } catch (e: any) {
        const status = Number(e?.statusCode)
        if (status === 404 || status === 410) {
          db.prepare('DELETE FROM customer_push WHERE endpoint = ?').run(row.endpoint)
        } else {
          db.prepare('UPDATE customer_push SET failures = failures + 1 WHERE id = ?').run(row.id)
        }
      }
    }),
  )
  return sent
}

/**
 * Sends to every device signed into this restaurant, and never throws.
 *
 * A push service answers 404 or 410 for a subscription that is gone — an
 * uninstalled app, cleared site data, a phone that was reset. Those are
 * deleted rather than retried: the whole point is that nobody is watching, so
 * there is nobody to notice a queue of dead endpoints building up.
 */
/**
 * What happened, rather than only how many got through.
 *
 * This used to return a count, and a count cannot tell apart the two things
 * somebody most needs to tell apart: nobody has signed a phone up, and phones
 * are signed up but the push service is refusing us. Both came back as 0, and
 * the screen said "no device is signed up yet" to somebody looking at their
 * own device on the list above it — which sent everybody looking in the one
 * place the fault was not.
 */
export type PushResult = {
  sent: number
  /** Devices that were tried and refused. */
  failed: number
  /** Devices held for this restaurant, before anything was attempted. */
  devices: number
  /** What the push service said, in as many words as it gave. */
  why: string
}

/**
 * @param onlyWhatsappDevices  Send only to the devices that asked for the
 *   WhatsApp thank-you prompt. Order alerts go to everything; this one goes to
 *   the phone belonging to whoever actually sends those messages, because a
 *   second notification per order about a message the kitchen will never send
 *   is how a counter learns to ignore the first one.
 */
export async function pushToRestaurant(
  restaurantId: number,
  note: PushNote,
  { onlyWhatsappDevices = false }: { onlyWhatsappDevices?: boolean } = {},
): Promise<PushResult> {
  if (!KEYS) return { sent: 0, failed: 0, devices: 0, why: pushReason() }
  let rows = db.prepare(DEVICES_FOR).all(restaurantId, restaurantId) as any[]
  if (onlyWhatsappDevices) rows = rows.filter((r) => !!r.wants_whatsapp)
  if (!rows.length) return { sent: 0, failed: 0, devices: 0, why: '' }

  const payload = JSON.stringify({
    title: note.title,
    body: note.body,
    url: note.url ?? '/staff/orders',
    tag: note.tag ?? 'khapee-order',
    wa: note.wa ?? '',
  })

  let sent = 0
  let failed = 0
  const complaints: string[] = []
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
          { TTL: 60 * 30 },
        )
        sent++
        db.prepare("UPDATE push_subscriptions SET failures = 0, last_ok_at = datetime('now') WHERE id = ?").run(
          row.id,
        )
      } catch (e: any) {
        failed++
        const status = Number(e?.statusCode)
        // Kept rather than swallowed. A push service that is refusing us says
        // why — a stale key, a subject it will not accept, a payload too big —
        // and every one of those was being discarded, leaving a screen that
        // could only report silence and a person with nothing to act on.
        const said = String(e?.body || e?.message || '').trim().slice(0, 200)
        complaints.push(status ? `${status}${said ? ` · ${said}` : ''}` : said || 'no answer')
        if (status === 404 || status === 410) dropSubscription(row.endpoint)
        else db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(row.id)
      }
    }),
  )
  return { sent, failed, devices: rows.length, why: [...new Set(complaints)].join('; ') }
}
