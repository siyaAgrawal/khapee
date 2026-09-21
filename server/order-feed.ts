/**
 * Handing an order to whatever the restaurant already bills on.
 *
 * There is no standard for this, and pretending otherwise is how these
 * features rot. A kitchen in Indore might run Petpooja or POSist, a Windows
 * billing program nobody has updated since 2011, a spreadsheet, or a
 * notebook. Writing an integration per product is a list that is never
 * finished and is wrong the week somebody switches.
 *
 * So Khapee publishes the order and lets the till meet it, three ways that
 * between them reach anything:
 *
 *   - a webhook, POSTed as each order happens, for a system that can listen;
 *   - a key, for one that can only poll — which most on-premises tills can;
 *   - a CSV, for the spreadsheet and for the notebook.
 *
 * Khapee depends on none of them. Nothing here is billed, nothing is
 * registered with anybody, and a restaurant that uses none of it is unaffected.
 */
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import { db } from './db.ts'
import { getOrder } from './orders-service.ts'

export type BillingEvent = 'order.placed' | 'order.status' | 'order.paid' | 'test'

/** Rupees as a string, from paise, because 0.1 + 0.2 is not 0.3. */
function rupees(paise: number): string {
  const n = Math.round(Number(paise) || 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Whether an address belongs to somebody else's machine on the internet.
 *
 * This is the whole security question in this file. The URL is typed by a
 * restaurant, and the server is what fetches it — so without this, "billing
 * webhook" is a box that makes Khapee's own server issue requests to anywhere
 * its network can reach: another tenant, a metadata endpoint holding cloud
 * credentials, something on localhost that trusts local callers. That is
 * server-side request forgery, and the box would be a polite way to ask for it.
 */
function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number)
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false
    if (p[0] === 169 && p[1] === 254) return false // link-local, and cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false
    if (p[0] === 192 && p[1] === 168) return false
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return false
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false // carrier NAT
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return false // benchmarking
    if (p[0] >= 224) return false // multicast and reserved
    return true
  }
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase()
    if (a === '::1' || a === '::') return false

    /**
     * An IPv4 address wearing an IPv6 coat reaches exactly the same machine.
     *
     * Both spellings, because they are the same address and only one of them
     * looks like one. `::ffff:127.0.0.1` is what a person types and
     * `::ffff:7f00:1` is what the URL parser hands back having normalised it —
     * so a check written against the readable form passes the other straight
     * through to localhost. That is not a hypothetical: it is what this did
     * until a test typed the readable form and read back the hex.
     */
    const mapped = a.match(/^::ffff:(.+)$/)
    if (mapped) {
      const rest = mapped[1]
      if (net.isIPv4(rest)) return isPublicAddress(rest)
      const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
      if (hex) {
        const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)
        return isPublicAddress([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'))
      }
      // An ::ffff: form this does not recognise is not one to take a chance on.
      return false
    }

    if (/^f[cd]/.test(a)) return false // unique local
    if (/^fe[89ab]/.test(a)) return false // link local
    return true
  }
  return false
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; why: string }

/**
 * Checks a webhook URL before anything is sent to it.
 *
 * The hostname is resolved here rather than trusted, because "localhost" is
 * the obvious case and a public name that resolves to 127.0.0.1 is the one
 * that gets past a check written only against the obvious case.
 *
 * Honest about what it does not cover: a name can resolve to something public
 * now and something internal a moment later, and the request would follow the
 * second answer. Closing that needs the connection itself pinned to the
 * address checked here, which Node's fetch does not expose. Redirects are
 * refused outright for the same family of reason — a redirect is a second
 * destination that nothing checked.
 */
export async function checkWebhookUrl(raw: string): Promise<UrlCheck> {
  let url: URL
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    return { ok: false, why: 'That is not a web address. It should start with https://' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, why: 'Only http:// and https:// addresses can be used.' }
  }
  if (url.username || url.password) {
    return { ok: false, why: 'Put the password in the secret below, not in the address.' }
  }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: string[]
  if (net.isIP(host)) {
    addresses = [host]
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address)
    } catch {
      return { ok: false, why: `Nothing on the internet answers to "${host}".` }
    }
  }
  if (!addresses.length) return { ok: false, why: `Nothing on the internet answers to "${host}".` }
  if (!addresses.every(isPublicAddress)) {
    return {
      ok: false,
      why: 'That address is on a private network, so Khapee cannot reach it from the internet. Use a public address for your billing system.',
    }
  }
  return { ok: true, url }
}

export type BillingHook = {
  restaurantId: number
  url: string
  secret: string
  apiKey: string
  active: boolean
}

export function billingHook(restaurantId: number): BillingHook {
  const row = db.prepare('SELECT * FROM pos_hooks WHERE restaurant_id = ?').get(restaurantId) as any
  return {
    restaurantId,
    url: row?.url ?? '',
    secret: row?.secret ?? '',
    apiKey: row?.api_key ?? '',
    active: row ? !!row.active : true,
  }
}

/** Creates the row on first use, so callers never have to check. */
function hookRow(restaurantId: number): any {
  db.prepare('INSERT OR IGNORE INTO pos_hooks (restaurant_id) VALUES (?)').run(restaurantId)
  return db.prepare('SELECT * FROM pos_hooks WHERE restaurant_id = ?').get(restaurantId)
}

export function setBillingUrl(restaurantId: number, url: string, active = true): void {
  hookRow(restaurantId)
  db.prepare('UPDATE pos_hooks SET url = ?, active = ? WHERE restaurant_id = ?').run(
    String(url ?? '').trim(),
    active ? 1 : 0,
    restaurantId,
  )
}

/** A new secret or key, returned once. Both are replaced, never revealed twice. */
export function rotateSecret(restaurantId: number): string {
  hookRow(restaurantId)
  const secret = crypto.randomBytes(24).toString('base64url')
  db.prepare('UPDATE pos_hooks SET secret = ? WHERE restaurant_id = ?').run(secret, restaurantId)
  return secret
}

export function rotateApiKey(restaurantId: number): string {
  hookRow(restaurantId)
  const key = `khp_${crypto.randomBytes(24).toString('base64url')}`
  db.prepare('UPDATE pos_hooks SET api_key = ? WHERE restaurant_id = ?').run(key, restaurantId)
  return key
}

/** The restaurant a polling key belongs to, or null. Constant work per call. */
export function restaurantForKey(key: string): number | null {
  const clean = String(key ?? '').trim()
  if (!clean) return null
  const row = db
    .prepare("SELECT restaurant_id FROM pos_hooks WHERE api_key = ? AND api_key <> ''")
    .get(clean) as any
  return row ? Number(row.restaurant_id) : null
}

/**
 * One order, in the shape a billing system expects rather than the shape the
 * app stores.
 *
 * Money appears twice on purpose. Paise is what Khapee counts in and is exact;
 * rupees is what a till wants and is written as a string, because a price that
 * arrives as 790.0000000001 is a support call nobody can explain. Whoever
 * wires this up uses whichever their system takes.
 */
export function billingPayload(orderId: number, event: BillingEvent) {
  const order = getOrder(orderId) as any
  if (!order) return null
  const restaurant = db
    .prepare('SELECT id, name, gstin, legal_name FROM restaurants WHERE id = ?')
    .get(order.restaurantId) as any

  return {
    event,
    sentAt: new Date().toISOString(),
    restaurant: {
      id: restaurant?.id ?? order.restaurantId,
      name: restaurant?.name ?? order.restaurantName,
      legalName: restaurant?.legal_name || undefined,
      gstin: restaurant?.gstin || undefined,
    },
    order: {
      id: order.id,
      number: order.orderNumber,
      status: order.status,
      placedAt: order.createdAt,
      service: order.serviceType ?? order.type,
      table: order.tableLabel ?? null,
      deliveryAddress: order.deliveryAddress || null,
      customer: {
        name: order.customerName ?? '',
        phone: order.customerPhone ?? '',
      },
      note: order.note ?? '',
      items: (order.items ?? []).map((i: any) => ({
        name: i.name,
        quantity: i.quantity,
        unitPricePaise: i.unitPriceCents,
        unitPrice: rupees(i.unitPriceCents),
        linePaise: i.unitPriceCents * i.quantity,
        line: rupees(i.unitPriceCents * i.quantity),
      })),
      currency: 'INR',
      subtotalPaise: order.subtotalCents,
      subtotal: rupees(order.subtotalCents),
      deliveryFeePaise: order.deliveryFeeCents ?? 0,
      deliveryFee: rupees(order.deliveryFeeCents ?? 0),
      totalPaise: order.totalCents,
      total: rupees(order.totalCents),
      payment: {
        status: order.paymentStatus,
        method: order.paymentMethod ?? '',
        state: order.paymentState,
        paidPaise: order.confirmedCents ?? 0,
        paid: rupees(order.confirmedCents ?? 0),
        upiReference: order.upiRef || null,
      },
    },
  }
}

/** The signature a receiver checks, so a guessed URL cannot post orders. */
export function sign(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function record(
  restaurantId: number,
  orderId: number | null,
  orderNumber: string,
  event: string,
  url: string,
  ok: boolean,
  code: number | null,
  error: string,
  attempts: number,
): void {
  db.prepare(
    `INSERT INTO pos_deliveries
       (restaurant_id, order_id, order_number, event, url, ok, code, error, attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(restaurantId, orderId, orderNumber, event, url, ok ? 1 : 0, code, error.slice(0, 300), attempts)

  // Enough to see what happened this week, not a second copy of the orders
  // table. Trimmed here rather than on a timer, because nothing else runs.
  db.prepare(
    `DELETE FROM pos_deliveries
      WHERE restaurant_id = ?
        AND id NOT IN (SELECT id FROM pos_deliveries WHERE restaurant_id = ? ORDER BY id DESC LIMIT 200)`,
  ).run(restaurantId, restaurantId)
}

export type Delivery = { ok: boolean; code?: number; error?: string; attempts: number }

/**
 * Sends one order, and never throws.
 *
 * Three attempts, spaced, because the common failure is a till that was
 * briefly asleep rather than a URL that is wrong — and an order that reached
 * the kitchen but not the bill is the expensive kind of missing. Anything the
 * receiver refuses outright (4xx) is not retried: it will be refused again,
 * and hammering somebody's endpoint with an order they have rejected is worse
 * than recording it once and showing the reason.
 */
export async function sendToBilling(
  restaurantId: number,
  orderId: number | null,
  event: BillingEvent,
  payloadOverride?: unknown,
): Promise<Delivery> {
  const hook = billingHook(restaurantId)
  if (!hook.url || !hook.active) return { ok: false, error: 'No billing address set.', attempts: 0 }

  const payload = payloadOverride ?? (orderId ? billingPayload(orderId, event) : null)
  if (!payload) return { ok: false, error: 'That order no longer exists.', attempts: 0 }
  const orderNumber = (payload as any)?.order?.number ?? ''

  const checked = await checkWebhookUrl(hook.url)
  if (!checked.ok) {
    record(restaurantId, orderId, orderNumber, event, hook.url, false, null, checked.why, 0)
    return { ok: false, error: checked.why, attempts: 0 }
  }

  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Khapee/1.0 (+https://khapee.com)',
    'x-khapee-event': event,
  }
  if (hook.secret) headers['x-khapee-signature'] = `sha256=${sign(hook.secret, body)}`

  let code: number | null = null
  let error = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(checked.url.href, {
        method: 'POST',
        headers,
        body,
        // A redirect is a second destination that nothing checked, so it is
        // refused rather than followed.
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      })
      code = response.status
      if (response.ok) {
        record(restaurantId, orderId, orderNumber, event, hook.url, true, code, '', attempt)
        return { ok: true, code, attempts: attempt }
      }
      error = `The billing system answered ${response.status}.`
      // Refused on purpose. Trying again changes nothing.
      if (code >= 400 && code < 500) break
    } catch (e: any) {
      error = e?.name === 'TimeoutError' ? 'The billing system did not answer in time.' : String(e?.message ?? e)
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000))
  }

  record(restaurantId, orderId, orderNumber, event, hook.url, false, code, error, 3)
  return { ok: false, code: code ?? undefined, error, attempts: 3 }
}

/**
 * Fired when something happens to an order, and deliberately not awaited.
 *
 * Whether a till answered has nothing to do with whether the order exists, and
 * a customer should not wait at a checkout for somebody else's server. What
 * went wrong is on the deliveries list either way.
 */
export function tellBilling(restaurantId: number, orderId: number, event: BillingEvent): void {
  const hook = billingHook(restaurantId)
  if (!hook.url || !hook.active) return
  void sendToBilling(restaurantId, orderId, event).catch(() => {})
}

export function recentDeliveries(restaurantId: number, limit = 20) {
  return db
    .prepare(
      `SELECT id, order_number, event, ok, code, error, attempts, created_at
         FROM pos_deliveries WHERE restaurant_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(restaurantId, Math.min(Math.max(limit, 1), 200)) as any[]
}
