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
const DISK_IS_TEMPORARY = !!process.env.VERCEL || process.env.ORDRO_SEED === 'snapshot'

/** Why push is off, when it is. Empty when it is on. */
let reason = ''

function loadKeys(): { publicKey: string; privateKey: string } | null {
  const fromEnv = {
    publicKey: String(process.env.VAPID_PUBLIC ?? '').trim(),
    privateKey: String(process.env.VAPID_PRIVATE ?? '').trim(),
  }
  if (fromEnv.publicKey && fromEnv.privateKey) return fromEnv

  if (DISK_IS_TEMPORARY) {
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
 * signed in now — a shared kitchen phone that changes hands should alert the
 * restaurant it is currently signed into, and only that one.
 */
export function saveSubscription(
  userId: number,
  restaurantId: number,
  sub: Subscription,
): { ok: boolean; error?: string } {
  const endpoint = String(sub?.endpoint ?? '').trim()
  const p256dh = String(sub?.keys?.p256dh ?? '').trim()
  const auth = String(sub?.keys?.auth ?? '').trim()
  if (!endpoint || !p256dh || !auth) return { ok: false, error: 'That subscription is incomplete.' }

  db.prepare(
    `INSERT INTO push_subscriptions (user_id, restaurant_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       restaurant_id = excluded.restaurant_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       failures = 0`,
  ).run(userId, restaurantId, endpoint, p256dh, auth)
  return { ok: true }
}

export function dropSubscription(endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint ?? ''))
}

export function subscriptionCount(restaurantId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE restaurant_id = ?')
    .get(restaurantId) as any
  return row?.n ?? 0
}

export type PushNote = { title: string; body: string; url?: string; tag?: string }

/**
 * Sends to every device signed into this restaurant, and never throws.
 *
 * A push service answers 404 or 410 for a subscription that is gone — an
 * uninstalled app, cleared site data, a phone that was reset. Those are
 * deleted rather than retried: the whole point is that nobody is watching, so
 * there is nobody to notice a queue of dead endpoints building up.
 */
export async function pushToRestaurant(restaurantId: number, note: PushNote): Promise<number> {
  if (!KEYS) return 0
  const rows = db
    .prepare('SELECT * FROM push_subscriptions WHERE restaurant_id = ?')
    .all(restaurantId) as any[]
  if (!rows.length) return 0

  const payload = JSON.stringify({
    title: note.title,
    body: note.body,
    url: note.url ?? '/staff/orders',
    tag: note.tag ?? 'khapee-order',
  })

  let sent = 0
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
        const status = Number(e?.statusCode)
        if (status === 404 || status === 410) dropSubscription(row.endpoint)
        else db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(row.id)
      }
    }),
  )
  return sent
}
