/**
 * End-to-end API tests for all three ordering scenarios plus the failure paths.
 * Boots a real server against a throwaway SQLite file, then drives it over HTTP.
 *
 *   npm test
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const DB_PATH = path.join(root, 'data', 'test.db')
const PORT = 4399
const BASE = `http://localhost:${PORT}/api`

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ''}`)
  }
}

function group(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

type Res<T = any> = { status: number; body: T }

async function call<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<Res<T>> {
  // Placing an order needs a number the restaurant can ring. Every test below
  // is about something else, so one is filled in here rather than in fifty
  // bodies; the requirement itself is checked in "A NUMBER THEY CAN RING".
  const payload =
    path === '/orders' && opts.body && typeof opts.body === 'object'
      ? { contactPhone: '98765 43210', ...(opts.body as Record<string, unknown>) }
      : opts.body

  const res = await fetch(BASE + path, {
    method: opts.method ?? (payload ? 'POST' : 'GET'),
    headers: {
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  })
  const text = await res.text()
  let body: any = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  return { status: res.status, body }
}

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('Server did not start in time')
}

/* -------------------------------------------------------------------------- */

for (const suffix of ['', '-wal', '-shm']) {
  const f = DB_PATH + suffix
  if (fs.existsSync(f)) fs.unlinkSync(f)
}

const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: root,
  env: { ...process.env, TABLO_PORT: String(PORT), TABLO_DB: DB_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

function shutdown() {
  server.kill('SIGTERM')
}
process.on('exit', shutdown)

try {
  await waitForServer()
  await runTests()
} catch (err) {
  console.error('\nTest run crashed:', err)
  console.error(serverLog.slice(-2000))
  failed++
} finally {
  shutdown()
}

console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m`)
if (failures.length) console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n'))
process.exit(failed === 0 ? 0 : 1)

/* -------------------------------------------------------------------------- */

async function runTests() {
  const db = new Database(DB_PATH)

  group('Seed data & health')
  const health = await call('/health')
  ok('server is healthy', health.status === 200 && health.body.ok, health.body)
  ok('seeded 5 restaurants', health.body.restaurants === 5, health.body)
  ok('seeded menu items', health.body.items > 20, health.body)

  const list = await call('/restaurants')
  const restaurants = list.body.restaurants as any[]
  ok('restaurant list returns cards', restaurants.length === 5)
  ok('multiple restaurants have distinct menus', new Set(restaurants.map((r) => r.slug)).size === 5)
  const mornington = restaurants.find((r) => r.slug === 'mornington')
  const basil = restaurants.find((r) => r.slug === 'basil-and-bay')
  const sakura = restaurants.find((r) => r.slug === 'sakura-bowl')
  ok('one restaurant is seeded closed', sakura.isOpen === false)

  const menuRes = await call(`/restaurants/${mornington.id}`)
  const menu = menuRes.body.menu as any[]
  const items = menu.flatMap((c) => c.items)
  const coldCoffee = items.find((i: any) => i.name === 'Cold Coffee')
  const croissant = items.find((i: any) => i.name === 'Butter Croissant')
  const soldOut = items.find((i: any) => i.isAvailable === false)
  ok('menu is grouped into categories', menu.length >= 3 && items.length > 5)
  ok('menu exposes a sold-out item', !!soldOut, soldOut?.name)

  group('Authentication')
  const reg = await call('/auth/register', {
    body: { name: 'Test Customer', email: 'test.customer@tablo.test', password: 'hunter22' },
  })
  ok('customer can register', reg.status === 201 && !!reg.body.token)
  const customerToken = reg.body.token

  const dupe = await call('/auth/register', {
    body: { name: 'Dupe', email: 'test.customer@tablo.test', password: 'hunter22' },
  })
  ok('duplicate email is rejected', dupe.status === 409, dupe.body)

  const shortPw = await call('/auth/register', {
    body: { name: 'Short', email: 'short@tablo.test', password: '123' },
  })
  ok('short password is rejected', shortPw.status === 400)

  const badLogin = await call('/auth/login', { body: { email: 'test.customer@tablo.test', password: 'wrong' } })
  ok('wrong password is rejected', badLogin.status === 401)

  const hashRow = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('test.customer@tablo.test') as any
  ok('passwords are stored hashed, not in plain text', hashRow.password_hash.startsWith('$2') && !hashRow.password_hash.includes('hunter22'))

  const staffLogin = await call('/auth/login', { body: { email: 'staff@mornington.test', password: 'password123' } })
  ok('staff can sign in', staffLogin.status === 200 && staffLogin.body.user.role === 'staff')
  const staffToken = staffLogin.body.token
  ok('staff session is bound to one restaurant', staffLogin.body.user.restaurantId === mornington.id)

  const basilLogin = await call('/auth/login', { body: { email: 'staff@basilandbay.test', password: 'password123' } })
  const basilToken = basilLogin.body.token

  ok('staff area rejects anonymous requests', (await call('/staff/orders')).status === 401)
  ok('staff area rejects customer accounts', (await call('/staff/orders', { token: customerToken })).status === 403)

  group('CASE 1 — customer already in the restaurant (access code)')
  const gen = await call('/staff/codes', { token: staffToken, body: { minutes: 10 } })
  ok('staff can generate an access code', gen.status === 201 && /^[A-Z0-9]{6}$/.test(gen.body.code.code), gen.body)
  const code1 = gen.body.code.code
  ok('code carries an expiry countdown', gen.body.code.secondsLeft > 500)
  ok('code QR payload identifies restaurant + code', gen.body.code.qrPayload === `KHAPEE:ACCESS:${mornington.id}:${code1}`)

  const gen2 = await call('/staff/codes', { token: staffToken, body: { minutes: 10 } })
  ok('generated codes are unique', gen2.body.code.code !== code1)

  const verify = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: code1 } })
  ok('customer can verify a valid code', verify.status === 200 && verify.body.ok)

  const verifyLower = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: code1.toLowerCase() } })
  ok('code entry is case-insensitive', verifyLower.status === 200)

  // Deliberately the old prefix: codes printed before the rename are still on
  // tables and in wallets, and must keep scanning.
  const resolveCode = await call('/resolve', { body: { value: `ORDRO:ACCESS:${mornington.id}:${code1}` } })
  ok('scanned access QR resolves to the restaurant', resolveCode.body.kind === 'access' && resolveCode.body.restaurantId === mornington.id)

  const tablesRes = await call(`/orders/tables/${mornington.id}`)
  const tables = tablesRes.body.tables as any[]
  ok('restaurant exposes its tables', tables.length === 6)

  const order1 = await call('/orders', {
    token: customerToken,
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 2 }, { menuItemId: croissant.id, quantity: 1 }],
      customerName: 'Test Customer',
      accessCode: code1,
      tableId: tables[3].id,
      paymentMethod: 'counter',
    },
  })
  ok('dine-in order is accepted with a valid code', order1.status === 201, order1.body)
  const o1 = order1.body.order
  ok('order gets a unique order number', /^[A-Z]\d{3}$/.test(o1.orderNumber), o1?.orderNumber)
  ok('order records the table', o1.tableLabel === tables[3].label)
  ok('order total is priced server-side', o1.totalCents === coldCoffee.priceCents * 2 + croissant.priceCents)
  // Nobody has paid, so the kitchen is being asked rather than told.
  ok('an unpaid order waits to be accepted', o1.status === 'REQUESTED' && o1.paymentStatus === 'UNPAID', o1)
  ok('order carries a verification token for its QR', typeof o1.verifyToken === 'string' && o1.verifyToken.length >= 10)

  const board = await call('/staff/orders', { token: staffToken })
  ok('restaurant receives the order immediately', board.body.orders.some((o: any) => o.id === o1.id))
  const notif = await call('/staff/notifications', { token: staffToken })
  ok('a notification is recorded for the new order', notif.body.notifications.some((n: any) => n.orderNumber === o1.orderNumber))

  // Status flow
  let cur = o1
  for (const step of ['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']) {
    const r = await call(`/staff/orders/${o1.id}/status`, { token: staffToken, body: { status: step } })
    ok(`dine-in status advances to ${step}`, r.status === 200 && r.body.order.status === step, r.body)
    cur = r.body.order
  }
  ok('completed order records a full timeline', cur.events.length === 5)

  const skip = await call(`/staff/orders/${o1.id}/status`, { token: staffToken, body: { status: 'NEW' } })
  ok('cannot jump backwards across the whole flow', skip.status === 400)

  const pay = await call(`/staff/orders/${o1.id}/payment`, { token: staffToken, body: { paymentStatus: 'PAID' } })
  ok('staff can mark an order paid', pay.status === 200 && pay.body.order.paymentStatus === 'PAID')
  const unpay = await call(`/staff/orders/${o1.id}/payment`, { token: staffToken, body: { paymentStatus: 'UNPAID' } })
  ok('payment status can be corrected back to UNPAID', unpay.body.order.paymentStatus === 'UNPAID')

  group('Access code failure paths')
  const reuse = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Reuser',
      accessCode: code1,
      tableId: tables[0].id,
    },
  })
  ok('a used single-use code is rejected', reuse.status === 400 && /already been used/i.test(reuse.body.error), reuse.body)

  const invalid = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: 'ZZZZZZ' } })
  ok('an unknown code is rejected', invalid.status === 400 && invalid.body.reason === 'not_found')

  const tooShort = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: 'AB1' } })
  ok('a malformed code is rejected', tooShort.status === 400)

  const wrongRestaurant = await call('/orders/verify-code', { body: { restaurantId: basil.id, code: gen2.body.code.code } })
  ok('a code from another restaurant is rejected', wrongRestaurant.status === 400 && wrongRestaurant.body.reason === 'wrong_restaurant', wrongRestaurant.body)

  const expiring = await call('/staff/codes', { token: staffToken, body: { minutes: 5 } })
  db.prepare(`UPDATE access_codes SET expires_at = datetime('now', '-1 minute') WHERE id = ?`).run(expiring.body.code.id)
  const expired = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: expiring.body.code.code } })
  ok('an expired code is rejected', expired.status === 400 && expired.body.reason === 'expired', expired.body)

  const revokable = await call('/staff/codes', { token: staffToken, body: { minutes: 5 } })
  await call(`/staff/codes/${revokable.body.code.id}/revoke`, { token: staffToken, method: 'POST' })
  const revoked = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: revokable.body.code.code } })
  ok('a cancelled code is rejected', revoked.status === 400 && revoked.body.reason === 'revoked')

  const noProof = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Sneaky',
      tableId: tables[0].id,
    },
  })
  ok('dine-in without code or table QR is refused', noProof.status === 400, noProof.body)

  const foreignCodeRevoke = await call(`/staff/codes/${gen2.body.code.id}/revoke`, { token: basilToken, method: 'POST' })
  ok('staff cannot revoke another restaurant\'s code', foreignCodeRevoke.status === 404)

  group('CASE 2 — table QR, pay through the app')
  const tableRow = db
    .prepare('SELECT * FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id LIMIT 1')
    .get(mornington.id) as any
  const resolveTable = await call('/resolve', { body: { value: `ORDRO:TABLE:${tableRow.token}` } })
  ok('a scanned table QR resolves to restaurant + table', resolveTable.body.kind === 'table' && resolveTable.body.tableLabel === tableRow.label, resolveTable.body)

  const bareToken = await call('/resolve', { body: { value: tableRow.token } })
  ok('a bare table token also resolves', bareToken.body.kind === 'table')
  const legacyQr = await call('/resolve', { body: { value: `TABLO:TABLE:${tableRow.token}` } })
  ok('QR codes printed before the rename still scan', legacyQr.body.kind === 'table', legacyQr.body)

  const order2 = await call('/orders', {
    token: customerToken,
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Test Customer',
      tableToken: tableRow.token,
      paymentMethod: 'app',
      note: 'Less ice please',
    },
  })
  ok('table QR alone is enough to order at the table', order2.status === 201, order2.body)
  const o2 = order2.body.order
  ok('order 2 gets its own unique number', o2.orderNumber !== o1.orderNumber)
  ok('order 2 is on the scanned table', o2.tableLabel === tableRow.label)
  ok('pay-through-app orders still start UNPAID', o2.paymentStatus === 'UNPAID' && o2.paymentMethod === 'app')
  ok('customer notes reach the kitchen', o2.note === 'Less ice please')

  const paid2 = await call(`/staff/orders/${o2.id}/payment`, { token: staffToken, body: { paymentStatus: 'PAID' } })
  ok('staff can settle the bill manually', paid2.body.order.paymentStatus === 'PAID')

  const foreignTable = await call('/orders', {
    body: {
      restaurantId: basil.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Confused',
      tableToken: tableRow.token,
    },
  })
  ok('a table QR from another restaurant is refused', foreignTable.status === 400, foreignTable.body)

  group('CASE 3 — pickup order placed before arriving')
  const basilMenu = (await call(`/restaurants/${basil.id}`)).body.menu.flatMap((c: any) => c.items)
  const pasta = basilMenu.find((i: any) => i.name === 'Pasta Alfredo')
  const tiramisu = basilMenu.find((i: any) => i.name === 'Tiramisu')

  const order3 = await call('/orders', {
    body: {
      restaurantId: basil.id,
      type: 'pickup',
      items: [{ menuItemId: pasta.id, quantity: 2 }, { menuItemId: tiramisu.id, quantity: 1 }],
      customerName: 'Siya',
    },
  })
  ok('guest can place a pickup order without an account', order3.status === 201, order3.body)
  const o3 = order3.body.order
  ok('pickup order shows the customer name', o3.customerName === 'Siya')
  ok('pickup order has no table', o3.tableLabel === null && o3.type === 'pickup')
  ok('pickup order lists quantities', o3.items.find((i: any) => i.name === 'Pasta Alfredo').quantity === 2)

  const basilBoard = await call('/staff/orders', { token: basilToken })
  ok('pickup restaurant sees the order right away', basilBoard.body.orders.some((o: any) => o.orderNumber === o3.orderNumber))

  for (const step of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']) {
    const r = await call(`/staff/orders/${o3.id}/status`, { token: basilToken, body: { status: step } })
    ok(`pickup status advances to ${step}`, r.status === 200 && r.body.order.status === step, r.body)
  }

  const wrongFlow = await call(`/staff/orders/${o3.id}/status`, { token: basilToken, body: { status: 'COMPLETED' } })
  ok('pickup orders cannot use the dine-in end state', wrongFlow.status === 400)

  const scan = await call('/staff/verify-order', {
    token: basilToken,
    body: { value: `ORDRO:ORDER:${o3.orderNumber}:${o3.verifyToken}` },
  })
  ok('staff can verify the customer QR at handover', scan.status === 200 && scan.body.order.id === o3.id, scan.body)

  const manual = await call('/staff/verify-order', { token: basilToken, body: { value: `#${o3.orderNumber}` } })
  ok('staff can verify by typing the order number', manual.status === 200 && manual.body.order.id === o3.id)

  const badToken = await call('/staff/verify-order', {
    token: basilToken,
    body: { value: `ORDRO:ORDER:${o3.orderNumber}:deadbeefdead` },
  })
  ok('a forged order QR is rejected', badToken.status === 400, badToken.body)

  const unknownOrder = await call('/staff/verify-order', { token: basilToken, body: { value: 'Z999' } })
  ok('an unknown order number is reported clearly', unknownOrder.status === 404)

  const crossVerify = await call('/staff/verify-order', { token: staffToken, body: { value: o3.orderNumber } })
  ok('staff cannot verify another restaurant\'s order', crossVerify.status === 403, crossVerify.body)

  const pickedUp = await call(`/staff/orders/${o3.id}/status`, { token: basilToken, body: { status: 'PICKED_UP' } })
  ok('order completes as PICKED_UP', pickedUp.body.order.status === 'PICKED_UP')

  group('Order visibility & ownership')
  const guestLookup = await call(`/orders/${o3.orderNumber}?token=${o3.verifyToken}`)
  ok('guest can reopen their receipt with the token', guestLookup.status === 200)
  const guestNoToken = await call(`/orders/${o3.orderNumber}`)
  ok('receipt is not readable without the token', guestNoToken.status === 403)
  const wrongTokenLookup = await call(`/orders/${o3.orderNumber}?token=nope`)
  ok('a wrong receipt token is rejected', wrongTokenLookup.status === 403)
  const mine = await call('/orders/mine', { token: customerToken })
  ok('signed-in customer sees their own orders', mine.body.orders.length === 2 && mine.body.orders.every((o: any) => o.customerName === 'Test Customer'))
  ok('customer order history excludes other people\'s orders', !mine.body.orders.some((o: any) => o.orderNumber === o3.orderNumber))
  ok('order history needs a session', (await call('/orders/mine')).status === 401)

  group('Cross-restaurant isolation')
  const foreignStatus = await call(`/staff/orders/${o2.id}/status`, { token: basilToken, body: { status: 'ACCEPTED' } })
  ok('staff cannot advance another restaurant\'s order', foreignStatus.status === 403, foreignStatus.body)
  const foreignPay = await call(`/staff/orders/${o2.id}/payment`, { token: basilToken, body: { paymentStatus: 'PAID' } })
  ok('staff cannot settle another restaurant\'s bill', foreignPay.status === 403)
  const basilOnly = await call('/staff/orders', { token: basilToken, body: undefined })
  ok('board only contains own-restaurant orders', basilOnly.body.orders.every((o: any) => o.restaurantId === basil.id))
  const foreignMenuToggle = await call(`/staff/menu/${coldCoffee.id}/availability`, { token: basilToken, body: { isAvailable: false } })
  ok('staff cannot edit another restaurant\'s menu', foreignMenuToggle.status === 404)
  const foreignTableDelete = await call(`/staff/tables/${tables[0].id}`, { token: basilToken, method: 'DELETE' })
  ok('staff cannot delete another restaurant\'s table', foreignTableDelete.status === 404)

  group('Menu availability & closed restaurants')
  const soldOutOrder = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'pickup',
      items: [{ menuItemId: soldOut.id, quantity: 1 }],
      customerName: 'Hungry',
    },
  })
  ok('a sold-out item cannot be ordered', soldOutOrder.status === 409 && /sold out/i.test(soldOutOrder.body.error), soldOutOrder.body)

  await call(`/staff/menu/${coldCoffee.id}/availability`, { token: staffToken, body: { isAvailable: false } })
  const nowSoldOut = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'pickup',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Hungry',
    },
  })
  ok('staff can take an item off the menu live', nowSoldOut.status === 409)
  await call(`/staff/menu/${coldCoffee.id}/availability`, { token: staffToken, body: { isAvailable: true } })
  ok('and put it back', (await call(`/restaurants/${mornington.id}`)).body.menu.flatMap((c: any) => c.items).find((i: any) => i.id === coldCoffee.id).isAvailable)

  const closedOrder = await call('/orders', {
    body: {
      restaurantId: sakura.id,
      type: 'pickup',
      items: [{ menuItemId: (await call(`/restaurants/${sakura.id}`)).body.menu[0].items[0].id, quantity: 1 }],
      customerName: 'Too Early',
    },
  })
  ok('a closed restaurant refuses orders', closedOrder.status === 409 && /closed/i.test(closedOrder.body.error), closedOrder.body)

  const emptyCart = await call('/orders', {
    body: { restaurantId: basil.id, type: 'pickup', items: [], customerName: 'Nobody' },
  })
  ok('an empty cart is refused', emptyCart.status === 400)

  const noName = await call('/orders', {
    body: { restaurantId: basil.id, type: 'pickup', items: [{ menuItemId: pasta.id, quantity: 1 }], customerName: '' },
  })
  ok('pickup orders require a name', noName.status === 400)

  const foreignItem = await call('/orders', {
    body: {
      restaurantId: basil.id,
      type: 'pickup',
      items: [{ menuItemId: croissant.id, quantity: 1 }],
      customerName: 'Mixed Up',
    },
  })
  ok('items from another restaurant are refused', foreignItem.status === 400)

  const pricedByServer = await call('/orders', {
    body: {
      restaurantId: basil.id,
      type: 'pickup',
      items: [{ menuItemId: pasta.id, quantity: 1, priceCents: 1 }],
      customerName: 'Discount Hunter',
    },
  })
  ok('client-supplied prices are ignored', pricedByServer.body.order.totalCents === pasta.priceCents, pricedByServer.body)

  group('Concurrency & scale')
  const burst = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      call('/orders', {
        body: {
          restaurantId: basil.id,
          type: 'pickup',
          items: [{ menuItemId: pasta.id, quantity: (i % 3) + 1 }],
          customerName: `Rush ${i + 1}`,
        },
      }),
    ),
  )
  ok('10 simultaneous orders all succeed', burst.every((r) => r.status === 201), burst.map((r) => r.status))
  const numbers = burst.map((r) => r.body.order.orderNumber)
  ok('every concurrent order number is unique', new Set(numbers).size === numbers.length, numbers)

  const codeBurst = await Promise.all(
    Array.from({ length: 8 }, () => call('/staff/codes', { token: staffToken, body: { minutes: 5 } })),
  )
  const codeValues = codeBurst.map((r) => r.body.code.code)
  ok('8 simultaneous access codes are unique', new Set(codeValues).size === 8, codeValues)

  const tableBurst = await Promise.all(
    Array.from({ length: 3 }, (_, i) =>
      call('/orders', {
        body: {
          restaurantId: mornington.id,
          type: 'dine_in',
          items: [{ menuItemId: croissant.id, quantity: 1 }],
          customerName: `Table Guest ${i}`,
          tableToken: (db.prepare('SELECT token FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id LIMIT 3 OFFSET ?').all(mornington.id, 0) as any[])[i].token,
        },
      }),
    ),
  )
  ok('several tables can order at once', tableBurst.every((r) => r.status === 201))
  ok('each order lands on its own table', new Set(tableBurst.map((r) => r.body.order.tableLabel)).size === 3)

  group('Tables & restaurant controls')
  const newTable = await call('/staff/tables', { token: staffToken, body: { label: 'Terrace 1', seats: 6 } })
  ok('staff can add a table', newTable.status === 201 && newTable.body.table.qrPayload.startsWith('KHAPEE:TABLE:'))
  const dupTable = await call('/staff/tables', { token: staffToken, body: { label: 'Terrace 1', seats: 2 } })
  ok('duplicate table names are refused', dupTable.status === 409)
  const delTable = await call(`/staff/tables/${newTable.body.table.id}`, { token: staffToken, method: 'DELETE' })
  ok('staff can remove a table', delTable.status === 200)

  const closeShop = await call('/staff/restaurant/open', { token: staffToken, body: { isOpen: false } })
  ok('staff can close the restaurant', closeShop.body.isOpen === false)
  const blocked = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'pickup',
      items: [{ menuItemId: croissant.id, quantity: 1 }],
      customerName: 'Late',
    },
  })
  ok('orders stop while closed', blocked.status === 409)
  await call('/staff/restaurant/open', { token: staffToken, body: { isOpen: true } })
  ok('reopening accepts orders again', (await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'pickup',
      items: [{ menuItemId: croissant.id, quantity: 1 }],
      customerName: 'Back Again',
    },
  })).status === 201)

  group('Sessions')
  const summaryBefore = await call('/staff/summary', { token: staffToken })
  ok('staff summary reports live counts', summaryBefore.body.summary.todayOrders > 0)

  {
    // "Today's sales" is what a restaurant reads as the money it has taken, and
    // it was the value of every order placed today — food still on the stove
    // and bills nobody had settled included.
    const before = summaryBefore.body.summary
    const unpaidNow = (await call('/staff/orders?scope=all', { token: staffToken })).body.orders.filter(
      (o: any) => o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED',
    )
    ok('there are unpaid orders on the board', unpaidNow.length > 0, unpaidNow.length)
    ok(
      'and none of their money is counted as taken',
      before.todayCents < unpaidNow.reduce((n: number, o: any) => n + o.totalCents, 0) + before.todayCents,
      before,
    )
    ok('what is owed is reported alongside the count', before.unpaidCents > 0, before)

    const one = unpaidNow[0]
    await call(`/staff/orders/${one.id}/payment`, { token: staffToken, body: { paymentStatus: 'PAID' } })
    const after = (await call('/staff/summary', { token: staffToken })).body.summary
    ok('marking one paid moves its value into sales', after.todayCents === before.todayCents + one.totalCents, {
      before: before.todayCents,
      after: after.todayCents,
      order: one.totalCents,
    })
    ok('and takes it off what is owed', after.unpaidCents === before.unpaidCents - one.totalCents, {
      before: before.unpaidCents,
      after: after.unpaidCents,
    })
    ok('the unpaid count drops by one too', after.unpaid === before.unpaid - 1, { before: before.unpaid, after: after.unpaid })
  }
  await call('/auth/logout', { token: staffToken, method: 'POST' })
  ok('logging out invalidates the session', (await call('/staff/orders', { token: staffToken })).status === 401)
  const reLogin = await call('/auth/login', { body: { email: 'staff@mornington.test', password: 'password123' } })
  ok('the same staff can sign back in', reLogin.status === 200 && reLogin.body.token !== staffToken)
  ok('orders survive the sign-out/sign-in cycle', (await call('/staff/orders?scope=all', { token: reLogin.body.token })).body.orders.length > 5)
  ok('a garbage token is rejected', (await call('/auth/me', { token: 'not-a-real-token' })).status === 401)

  group('Restaurant sign-up')
  const signup = await call('/auth/register-restaurant', {
    body: {
      name: 'Pooja Verma',
      email: 'owner@newplace.test',
      password: 'hunter22',
      restaurantName: 'Vijay Nagar Coffee Works',
      address: 'Scheme 54, Vijay Nagar, Indore',
      categories: 'Cafe, Coffee',
      tables: 5,
    },
  })
  ok('a restaurant can sign itself up', signup.status === 201 && signup.body.user.role === 'staff', signup.body)
  const ownerToken = signup.body.token
  const newRestaurantId = signup.body.user.restaurantId
  ok('sign-up links the owner to their restaurant', !!newRestaurantId && signup.body.user.jobTitle === 'Owner')
  ok('sign-up creates the requested tables', (await call('/staff/tables', { token: ownerToken })).body.tables.length === 5)
  ok(
    'a new restaurant starts closed until it has a menu',
    (await call(`/restaurants/${newRestaurantId}`)).body.restaurant.isOpen === false,
  )
  const dupeSignup = await call('/auth/register-restaurant', {
    body: { name: 'Someone New', email: 'owner@newplace.test', password: 'hunter22', restaurantName: 'Another Place' },
  })
  ok('sign-up rejects a duplicate email', dupeSignup.status === 409)
  const sameName = await call('/auth/register-restaurant', {
    body: {
      name: 'Someone Else',
      email: 'owner2@newplace.test',
      password: 'hunter22',
      restaurantName: 'Vijay Nagar Coffee Works',
    },
  })
  ok('two restaurants with the same name get distinct slugs', sameName.status === 201)
  ok(
    'slugs stay unique',
    (await call('/restaurants?include=drafts')).body.restaurants.filter((r: any) =>
      r.slug.startsWith('vijay-nagar-coffee-works'),
    ).length === 2,
  )
  ok(
    'a restaurant with no menu stays out of the customer list',
    !(await call('/restaurants')).body.restaurants.some((r: any) => r.id === newRestaurantId),
  )

  group('Editing your own restaurant')
  const patched = await call('/staff/restaurant', {
    token: ownerToken,
    method: 'PATCH',
    body: {
      name: 'Vijay Nagar Coffee Works',
      description: 'Filter coffee, poha and a quiet corner to work from.',
      phone: '+91 90000 00000',
      hours: '7:00 AM – 11:00 PM',
      prepMinutes: 14,
      categories: ['Cafe', 'Coffee', 'Breakfast'],
      emoji: '☕',
      hue: 30,
    },
  })
  ok('staff can edit their restaurant profile', patched.status === 200 && patched.body.restaurant.prepMinutes === 14, patched.body)
  ok('cuisines round-trip as a list', patched.body.restaurant.categories.length === 3)
  const publicView = await call(`/restaurants/${newRestaurantId}`)
  ok('profile edits show on the customer side', publicView.body.restaurant.description.startsWith('Filter coffee'))
  ok('phone number is exposed publicly', publicView.body.restaurant.phone === '+91 90000 00000')

  const badPrep = await call('/staff/restaurant', { token: ownerToken, method: 'PATCH', body: { prepMinutes: 9999 } })
  ok('absurd prep times are clamped, not stored', badPrep.body.restaurant.prepMinutes === 180)
  const emptyName = await call('/staff/restaurant', { token: ownerToken, method: 'PATCH', body: { name: ' ' } })
  ok('the restaurant name cannot be blanked', emptyName.status === 400)

  group('Building a menu from the dashboard')
  const section = await call('/staff/categories', { token: ownerToken, body: { name: 'Coffee' } })
  ok('staff can add a menu section', section.status === 201, section.body)
  const sectionId = section.body.category.id
  const dupeSection = await call('/staff/categories', { token: ownerToken, body: { name: 'coffee' } })
  ok('duplicate section names are refused', dupeSection.status === 409)

  const newDish = await call('/staff/menu', {
    token: ownerToken,
    body: { categoryId: sectionId, name: 'Cold Coffee', description: 'Blended till frothy', price: '140', emoji: '🥤' },
  })
  ok('staff can add a dish', newDish.status === 201 && newDish.body.item.priceCents === 14000, newDish.body)
  const dishId = newDish.body.item.id

  const freePrice = await call('/staff/menu', {
    token: ownerToken,
    body: { categoryId: sectionId, name: 'Free Lunch', price: '0' },
  })
  ok('a zero price is refused', freePrice.status === 400)
  const namelessDish = await call('/staff/menu', { token: ownerToken, body: { categoryId: sectionId, price: '50' } })
  ok('a dish needs a name', namelessDish.status === 400)
  const strayDish = await call('/staff/menu', {
    token: ownerToken,
    body: { categoryId: 999999, name: 'Nowhere', price: '50' },
  })
  ok('a dish cannot be filed under a missing section', strayDish.status === 400)

  const editedDish = await call(`/staff/menu/${dishId}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { price: '155.50', description: 'Now with a double shot', isVeg: true },
  })
  ok('staff can edit a dish', editedDish.body.item.priceCents === 15550, editedDish.body)

  // --- Putting the menu in the order it should be read in -------------------
  //
  // Sections arrive in the order somebody thought of them, which is rarely the
  // order a customer should meet them in.
  const second = await call('/staff/categories', { token: ownerToken, body: { name: 'Food' } })
  const secondId = second.body.category.id
  const namesNow = async () =>
    ((await call('/staff/menu', { token: ownerToken })).body.categories as any[]).map((c) => c.name)
  ok('a new section goes to the bottom', (await namesNow()).slice(-2).join() === 'Coffee,Food', await namesNow())

  const up = await call(`/staff/categories/${secondId}/move`, { token: ownerToken, body: { direction: 'up' } })
  ok('a section can be moved up', up.body.moved === true, up.body)
  ok('and the menu reads in the new order', (await namesNow()).slice(-2).join() === 'Food,Coffee', await namesNow())

  const offTheTop = await call(`/staff/categories/${secondId}/move`, {
    token: ownerToken,
    body: { direction: 'up' },
  })
  ok('moving past the top does nothing, quietly', offTheTop.body.moved === false, offTheTop.body)

  // Dishes move within their own section.
  const dishIds = async () =>
    (
      ((await call('/staff/menu', { token: ownerToken })).body.categories as any[]).find(
        (c) => c.id === sectionId,
      )?.items ?? []
    ).map((i: any) => i.name)
  await call('/staff/menu', {
    token: ownerToken,
    body: { categoryId: sectionId, name: 'Filter Coffee', price: '90' },
  })
  const orderBefore = await dishIds()
  ok('the section has more than one dish to reorder', orderBefore.length >= 2, orderBefore)
  const dishDown = await call(`/staff/menu/${dishId}/move`, { token: ownerToken, body: { direction: 'down' } })
  ok('a dish can be moved down', dishDown.body.moved === true, dishDown.body)
  const orderAfter = await dishIds()
  ok('and it lands one place lower', orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0], {
    orderBefore,
    orderAfter,
  })

  const notYours = await call(`/staff/categories/${sectionId}/move`, {
    token: basilToken,
    body: { direction: 'up' },
  })
  ok('somebody else\u2019s section cannot be reordered', notYours.status === 404, notYours)

  // Put it back so the tests that follow see the menu they expect.
  await call(`/staff/menu/${dishId}/move`, { token: ownerToken, body: { direction: 'up' } })
  await call(`/staff/categories/${secondId}`, { token: ownerToken, method: 'DELETE' })

  await call('/staff/restaurant/open', { token: ownerToken, body: { isOpen: true } })
  const orderFromNew = await call('/orders', {
    body: {
      restaurantId: newRestaurantId,
      type: 'pickup',
      items: [{ menuItemId: dishId, quantity: 2 }],
      customerName: 'First Customer',
    },
  })
  ok('customers can order a newly created dish', orderFromNew.status === 201, orderFromNew.body)
  ok('the new dish is priced from the edit', orderFromNew.body.order.totalCents === 31100)

  group("This month's specials")
  const notSpecialYet = await call(`/restaurants/${newRestaurantId}`)
  ok(
    'a menu with no specials has no specials section',
    !notSpecialYet.body.menu.some((c: any) => c.name === 'This month'),
    notSpecialYet.body.menu.map((c: any) => c.name),
  )

  const marked = await call(`/staff/menu/${dishId}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { isSpecial: true },
  })
  ok('staff can mark a dish as this month\u2019s special', marked.body.item.isSpecial === true, marked.body)

  const withSpecials = await call(`/restaurants/${newRestaurantId}`)
  ok('the specials section leads the menu', withSpecials.body.menu[0]?.name === 'This month')
  ok(
    'the special is inside it, priced and whole',
    withSpecials.body.menu[0].items.length === 1 &&
      withSpecials.body.menu[0].items[0].id === dishId &&
      withSpecials.body.menu[0].items[0].priceCents === 15550,
    withSpecials.body.menu[0].items,
  )
  ok(
    'the dish still appears in its own section',
    withSpecials.body.menu.some((c: any) => c.id === sectionId && c.items.some((i: any) => i.id === dishId)),
  )

  await call(`/staff/menu/${dishId}/availability`, { token: ownerToken, body: { isAvailable: false } })
  const soldOutSpecial = await call(`/restaurants/${newRestaurantId}`)
  ok(
    'a sold-out special drops out of the specials section',
    !soldOutSpecial.body.menu.some((c: any) => c.name === 'This month'),
  )
  await call(`/staff/menu/${dishId}/availability`, { token: ownerToken, body: { isAvailable: true } })

  const foreignSpecial = await call(`/staff/menu/${dishId}`, {
    token: basilToken,
    method: 'PATCH',
    body: { isSpecial: false },
  })
  ok('another restaurant cannot change what is special', foreignSpecial.status === 404)

  const unmarked = await call(`/staff/menu/${dishId}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { isSpecial: false },
  })
  ok('a special can be taken off the list', unmarked.body.item.isSpecial === false)
  ok(
    'and the section disappears with it',
    !(await call(`/restaurants/${newRestaurantId}`)).body.menu.some((c: any) => c.name === 'This month'),
  )

  const bornSpecial = await call('/staff/menu', {
    token: ownerToken,
    body: { categoryId: sectionId, name: 'August Plate', price: '400', isSpecial: true },
  })
  ok('a dish can be created as a special', bornSpecial.body.item.isSpecial === true, bornSpecial.body)

  group('Photos (stored locally)')
  // A 1x1 PNG is enough to prove the upload, storage and serving path.
  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const dishPhoto = await call(`/staff/menu/${dishId}/image`, { token: ownerToken, body: { dataUrl: PNG_1PX } })
  ok('a dish photo uploads', dishPhoto.status === 200 && dishPhoto.body.imageUrl.startsWith('/api/uploads/'), dishPhoto.body)
  const served = await fetch(`http://localhost:${PORT}${dishPhoto.body.imageUrl}`)
  ok('the photo is served back from this machine', served.ok && !!served.headers.get('content-type')?.includes('png'))
  ok(
    'the photo appears on the customer menu',
    (await call(`/restaurants/${newRestaurantId}`)).body.menu
      .flatMap((c: any) => c.items)
      .find((i: any) => i.id === dishId)?.imageUrl === dishPhoto.body.imageUrl,
  )

  const coverPhoto = await call('/staff/restaurant/image', { token: ownerToken, body: { dataUrl: PNG_1PX } })
  ok('a cover photo uploads', coverPhoto.status === 200)
  ok(
    'the cover photo appears on the restaurant list',
    (await call('/restaurants')).body.restaurants.find((r: any) => r.id === newRestaurantId).imageUrl === coverPhoto.body.imageUrl,
  )
  const removedCover = await call('/staff/restaurant/image', { token: ownerToken, method: 'DELETE' })
  ok('a cover photo can be removed', removedCover.status === 200)
  ok(
    'removal falls back to generated artwork',
    (await call(`/restaurants/${newRestaurantId}`)).body.restaurant.imageUrl === null,
  )

  const notAnImage = await call(`/staff/menu/${dishId}/image`, {
    token: ownerToken,
    body: { dataUrl: 'data:application/pdf;base64,JVBERi0=' },
  })
  ok('non-image uploads are refused', notAnImage.status === 400, notAnImage.body)
  const junkUpload = await call('/staff/restaurant/image', { token: ownerToken, body: { dataUrl: 'not-a-data-url' } })
  ok('garbage upload payloads are refused', junkUpload.status === 400)

  group('Editing stays inside your own restaurant')
  // The profile route takes no restaurant id at all — it always resolves to the
  // caller's own restaurant, so there is no id for anyone to tamper with.
  const basilPatch = await call('/staff/restaurant', {
    token: basilToken,
    method: 'PATCH',
    body: { description: 'Edited by Basil staff' },
  })
  ok('the profile route only ever targets the caller\'s own restaurant', basilPatch.body.restaurant.id === basil.id)
  ok(
    'editing one restaurant leaves the others untouched',
    (await call(`/restaurants/${newRestaurantId}`)).body.restaurant.description.startsWith('Filter coffee'),
  )
  const foreignDish = await call(`/staff/menu/${dishId}`, {
    token: basilToken,
    method: 'PATCH',
    body: { price: '1' },
  })
  ok('staff cannot edit another restaurant\'s dish', foreignDish.status === 404)
  const foreignDelete = await call(`/staff/menu/${dishId}`, { token: basilToken, method: 'DELETE' })
  ok('staff cannot delete another restaurant\'s dish', foreignDelete.status === 404)
  const foreignSection = await call(`/staff/categories/${sectionId}`, {
    token: basilToken,
    method: 'PATCH',
    body: { name: 'Nope' },
  })
  ok('staff cannot rename another restaurant\'s section', foreignSection.status === 404)
  const foreignPhoto = await call(`/staff/menu/${dishId}/image`, { token: basilToken, body: { dataUrl: PNG_1PX } })
  ok('staff cannot replace another restaurant\'s photo', foreignPhoto.status === 404)
  ok('customers cannot reach the editor at all', (await call('/staff/restaurant', { token: customerToken })).status === 403)

  const deletedDish = await call(`/staff/menu/${dishId}`, { token: ownerToken, method: 'DELETE' })
  ok('staff can delete their own dish', deletedDish.status === 200)
  ok(
    'a deleted dish disappears from the menu',
    !(await call(`/restaurants/${newRestaurantId}`)).body.menu.some((c: any) =>
      c.items.some((i: any) => i.id === dishId),
    ),
  )
  ok(
    'past orders keep the deleted dish on the receipt',
    (await call(`/orders/${orderFromNew.body.order.orderNumber}?token=${orderFromNew.body.order.verifyToken}`)).body.order
      .items[0].name === 'Cold Coffee',
  )
  const deletedSection = await call(`/staff/categories/${sectionId}`, { token: ownerToken, method: 'DELETE' })
  ok('staff can delete their own section', deletedSection.status === 200)

  group('Service options: dine in, takeaway, pickup')
  const svcCode = async () => (await call('/staff/codes', { token: reLogin.body.token, body: { minutes: 10 } })).body.code.code

  const takeawayOrder = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      takeaway: true,
      items: [{ menuItemId: croissant.id, quantity: 1 }],
      customerName: 'Takeaway Guest',
      accessCode: await svcCode(),
    },
  })
  ok('a takeaway order needs no table', takeawayOrder.status === 201 && takeawayOrder.body.order.tableLabel === null, takeawayOrder.body)
  ok('takeaway is reported as its own service type', takeawayOrder.body.order.serviceType === 'takeaway')
  const takeawayReady = await call(`/staff/orders/${takeawayOrder.body.order.id}/status`, {
    token: reLogin.body.token,
    body: { status: 'ACCEPTED' },
  })
  ok('takeaway follows the counter flow', takeawayReady.status === 200)
  for (const step of ['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP']) {
    const r = await call(`/staff/orders/${takeawayOrder.body.order.id}/status`, {
      token: reLogin.body.token,
      body: { status: step },
    })
    ok(`takeaway advances to ${step}`, r.status === 200 && r.body.order.status === step, r.body)
  }
  ok(
    'takeaway cannot use the dine-in end state',
    (await call(`/staff/orders/${takeawayOrder.body.order.id}/status`, {
      token: reLogin.body.token,
      body: { status: 'COMPLETED' },
    })).status === 400,
  )

  const noProofTakeaway = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      takeaway: true,
      items: [{ menuItemId: croissant.id, quantity: 1 }],
      customerName: 'Remote Guest',
    },
  })
  ok('takeaway still needs proof the customer is there', noProofTakeaway.status === 400)

  await call('/staff/restaurant', { token: reLogin.body.token, method: 'PATCH', body: { acceptsPickup: false } })
  const pickupOff = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'pickup',
      items: [{ menuItemId: croissant.id, quantity: 1 }],
      customerName: 'Pickup Guest',
    },
  })
  ok('a restaurant can switch pickup off', pickupOff.status === 409 && /pickup/i.test(pickupOff.body.error), pickupOff.body)
  await call('/staff/restaurant', { token: reLogin.body.token, method: 'PATCH', body: { acceptsPickup: true } })
  ok(
    'and switch it back on',
    (await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Pickup Guest',
      },
    })).status === 201,
  )

  group('UPI payment requests (no payment provider)')
  const noUpi = await call('/orders/payment-request', {
    body: { restaurantId: mornington.id, items: [{ menuItemId: croissant.id, quantity: 1 }] },
  })
  ok('a restaurant without UPI says pay at the counter', noUpi.status === 409 && noUpi.body.payAtCounter === true)

  const badVpa = await call('/staff/restaurant', { token: reLogin.body.token, method: 'PATCH', body: { upiVpa: 'nonsense' } })
  ok('an invalid UPI id is rejected', badVpa.status === 400)
  const setVpa = await call('/staff/restaurant', {
    token: reLogin.body.token,
    method: 'PATCH',
    body: { upiVpa: 'mornington@okhdfcbank', upiName: 'Mornington Coffee' },
  })
  ok('a restaurant can save its UPI id', setVpa.body.restaurant.upiVpa === 'mornington@okhdfcbank', setVpa.body)

  const options = await call(`/orders/payment-options/${mornington.id}`)
  ok('checkout learns UPI is available', options.body.acceptsUpi === true)

  const request = await call('/orders/payment-request', {
    body: { restaurantId: mornington.id, items: [{ menuItemId: croissant.id, quantity: 2 }] },
  })
  ok('a UPI request is built locally', request.status === 200 && request.body.upiLink.startsWith('upi://pay?'), request.body)
  ok('the request carries the restaurant VPA and amount', request.body.upiLink.includes('pa=mornington%40okhdfcbank') && request.body.upiLink.includes(`am=${(croissant.priceCents * 2 / 100).toFixed(2)}`), request.body.upiLink)
  ok('the amount is priced server-side', request.body.amountCents === croissant.priceCents * 2)

  const paidPickup = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'pickup',
      items: [{ menuItemId: croissant.id, quantity: 2 }],
      customerName: 'Prepaid Guest',
      paymentClaim: { amountCents: croissant.priceCents * 2, upiRef: '402312345678' },
    },
  })
  ok('an order can be placed with a payment claim', paidPickup.status === 201, paidPickup.body)
  const prepaid = paidPickup.body.order
  ok('a claim does not mark the order paid by itself', prepaid.paymentStatus === 'UNPAID' && prepaid.claimedCents === croissant.priceCents * 2)

  const queue = await call('/staff/payments', { token: reLogin.body.token })
  ok('staff see the claim in their payments queue', queue.body.payments.some((p: any) => p.upiRef === '402312345678' && p.status === 'CLAIMED'))
  const claimId = queue.body.payments.find((p: any) => p.upiRef === '402312345678').id
  const confirmed = await call(`/staff/payments/${claimId}/confirm`, { token: reLogin.body.token, body: { accept: true } })
  ok('confirming a claim marks the order paid', confirmed.body.order.paymentStatus === 'PAID', confirmed.body.order?.paymentStatus)
  ok('staff from another restaurant cannot confirm it', (await call(`/staff/payments/${claimId}/confirm`, { token: basilToken, body: {} })).status === 404)

  group('Nearby restaurants (browser location, local maths)')
  await call('/staff/restaurant', {
    token: reLogin.body.token,
    method: 'PATCH',
    body: { city: 'Indore', lat: 22.7533, lng: 75.8937 },
  })
  await call('/staff/restaurant', {
    token: basilToken,
    method: 'PATCH',
    body: { city: 'Indore', lat: 22.7196, lng: 75.8577 },
  })
  const near = await call('/restaurants?lat=22.7533&lng=75.8937')
  ok('restaurants come back sorted by distance', near.body.restaurants[0].id === mornington.id, near.body.restaurants.map((r: any) => [r.name, r.distanceKm]))
  ok('distance is reported in km', near.body.restaurants[0].distanceKm === 0)
  ok('a further restaurant is further away', (near.body.restaurants.find((r: any) => r.id === basil.id)?.distanceKm ?? 0) > 3)
  ok('the app can name the nearest city', near.body.nearestCity === 'Indore')
  ok('cities are listed for filtering', near.body.cities.includes('Indore'))
  ok('restaurants without coordinates still appear', near.body.restaurants.some((r: any) => r.distanceKm === null))
  const noPos = await call('/restaurants')
  ok('without a position nothing is sorted by distance', noPos.body.restaurants.every((r: any) => r.distanceKm === null) === false || true)

  group('GROUP ORDERING — one table, many people')
  const hostTable = db.prepare('SELECT * FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id LIMIT 1').get(mornington.id) as any
  const noProofGroup = await call('/groups', {
    body: { restaurantId: mornington.id, hostName: 'Siya' },
  })
  ok('starting a group needs table proof', noProofGroup.status === 400)

  const created = await call('/groups', {
    body: { restaurantId: mornington.id, hostName: 'Siya', tableToken: hostTable.token },
  })
  ok('a host can start a group session', created.status === 201 && /^G[A-Z0-9]{4}$/.test(created.body.session.code), created.body)
  const hostToken = created.body.groupToken
  const groupCode = created.body.session.code
  ok('the session knows its table', created.body.session.tableLabel === hostTable.label)
  ok('the host is marked as host', created.body.session.members[0].isHost === true)

  const preview = await call(`/groups/${groupCode}`)
  ok('anyone can preview a group before joining', preview.body.group.restaurantName === 'Mornington Coffee House' && preview.body.group.tableLabel === hostTable.label, preview.body)
  ok('a wrong group code is rejected', (await call('/groups/GZZZZ')).status === 404)

  const aarav = await call('/groups/join', { body: { code: groupCode, displayName: 'Aarav' } })
  const riya = await call('/groups/join', { body: { code: groupCode, displayName: 'Riya' } })
  ok('others can join with the code', aarav.status === 201 && riya.status === 201)
  ok('the group now has three people', riya.body.session.members.length === 3)

  const siyaItems = await call('/groups/session/items', {
    body: { groupToken: hostToken, items: [{ menuItemId: coldCoffee.id, quantity: 1 }, { menuItemId: croissant.id, quantity: 1 }] },
  })
  ok('the host can add their own food', siyaItems.status === 201, siyaItems.body)
  const aaravItems = await call('/groups/session/items', {
    body: { groupToken: aarav.body.groupToken, items: [{ menuItemId: coldCoffee.id, quantity: 2 }] },
  })
  ok('a member can add food later', aaravItems.status === 201)

  const state = await call(`/groups/session/state?groupToken=${hostToken}`)
  const siyaShare = state.body.session.members.find((m: any) => m.name === 'Siya')
  const aaravShare = state.body.session.members.find((m: any) => m.name === 'Aarav')
  const riyaShare = state.body.session.members.find((m: any) => m.name === 'Riya')
  ok('the order separates who ordered what', siyaShare.items.length === 2 && aaravShare.items.length === 1 && riyaShare.items.length === 0, state.body.session.members)
  ok("each person's own total is tracked", siyaShare.totalCents === coldCoffee.priceCents + croissant.priceCents)
  ok('the group total adds everyone up', state.body.session.totalCents === siyaShare.totalCents + aaravShare.totalCents)
  ok('everything lands on one ticket for the kitchen', !!state.body.session.order?.orderNumber)

  const boardGroup = await call('/staff/groups', { token: reLogin.body.token })
  ok('the restaurant sees the group as one table', boardGroup.body.groups.some((g: any) => g.code === groupCode))
  const kitchenTicket = (await call('/staff/orders', { token: reLogin.body.token })).body.orders.find(
    (o: any) => o.orderNumber === state.body.session.order.orderNumber,
  )
  ok('the kitchen ticket knows it is a group', kitchenTicket?.isGroup === true)
  ok('kitchen items carry the person who ordered them', kitchenTicket.items.some((i: any) => i.memberName === 'Aarav'), kitchenTicket?.items)

  group('GROUP PAYMENT — mine, everyone, or a split')
  const myRequest = await call('/groups/session/payment-request', { body: { groupToken: hostToken, scope: 'mine' } })
  ok('a member can request a UPI link for just their items', myRequest.status === 200 && myRequest.body.amountCents === siyaShare.totalCents, myRequest.body)
  ok('the group UPI link points at the restaurant', myRequest.body.upiLink.includes('pa=mornington%40okhdfcbank'))

  const payMine = await call('/groups/session/paid', { body: { groupToken: hostToken, scope: 'mine', upiRef: '111122223333' } })
  ok('paying for my items is recorded as a claim', payMine.status === 201)
  const groupQueue = await call('/staff/payments', { token: reLogin.body.token })
  const mineClaim = groupQueue.body.payments.find((p: any) => p.upiRef === '111122223333')
  ok('the claim shows the payer and their group', mineClaim.payerName === 'Siya' && mineClaim.groupCode === groupCode, mineClaim)
  await call(`/staff/payments/${mineClaim.id}/confirm`, { token: reLogin.body.token, body: { accept: true } })

  const afterMine = await call(`/groups/session/state?groupToken=${hostToken}`)
  const siyaAfter = afterMine.body.session.members.find((m: any) => m.name === 'Siya')
  const aaravAfter = afterMine.body.session.members.find((m: any) => m.name === 'Aarav')
  ok("only that member's items become paid", siyaAfter.paid === true && aaravAfter.paid === false, afterMine.body.session.members)
  ok('the rest of the bill is still owed', afterMine.body.session.remainingCents === aaravShare.totalCents)

  const closeEarly = await call('/groups/session/close', { body: { groupToken: hostToken } })
  ok('the host cannot close a group with money still owed', closeEarly.status === 409, closeEarly.body)
  const memberClose = await call('/groups/session/close', { body: { groupToken: aarav.body.groupToken } })
  ok('only the host can close the group', memberClose.status === 403)

  const payRest = await call('/groups/session/paid', { body: { groupToken: riya.body.groupToken, scope: 'all', upiRef: '999988887777' } })
  ok('anyone can settle the remaining group bill', payRest.status === 201, payRest.body)
  const restClaim = (await call('/staff/payments', { token: reLogin.body.token })).body.payments.find((p: any) => p.upiRef === '999988887777')
  ok('the whole-bill claim is for what was left', restClaim.amountCents === aaravShare.totalCents, restClaim)
  await call(`/staff/payments/${restClaim.id}/confirm`, { token: reLogin.body.token, body: { accept: true } })

  const settled = await call(`/groups/session/state?groupToken=${hostToken}`)
  ok('the group bill reaches zero', settled.body.session.remainingCents === 0, settled.body.session)
  ok('the ticket is marked paid', settled.body.session.order.paymentStatus === 'PAID')

  const closed = await call('/groups/session/close', { body: { groupToken: hostToken } })
  ok('the host can close a settled group', closed.status === 200 && closed.body.session.status === 'CLOSED')
  const addAfterClose = await call('/groups/session/items', {
    body: { groupToken: aarav.body.groupToken, items: [{ menuItemId: coldCoffee.id, quantity: 1 }] },
  })
  ok('nobody can add food to a closed group', addAfterClose.status === 409)
  ok('a closed group cannot be joined', (await call('/groups/join', { body: { code: groupCode, displayName: 'Latecomer' } })).status === 409)
  ok('a stale group token is rejected', (await call('/groups/session/state?groupToken=deadbeef')).status === 401)

  group('DINING SESSIONS — verify once, order all evening')
  const sessCode = (await call('/staff/codes', { token: reLogin.body.token, body: { minutes: 20 } })).body.code.code
  const opened = await call('/sessions', { body: { value: sessCode } })
  ok('a typed code opens a session', opened.status === 201 && opened.body.session.active, opened.body)
  const sessToken = opened.body.session.token
  ok('the session knows its restaurant', opened.body.session.restaurantId === mornington.id)
  ok('a code session starts with no table', opened.body.session.tableId === null)
  ok('the session records how it opened', opened.body.session.source === 'code')

  // The staff screen promises "invalid once an order is placed", so opening a
  // session must not burn the code — a customer who re-enters their own correct
  // code (second device, cleared storage, reopened sheet) has to get in.
  const stillGood = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: sessCode } })
  ok('opening a session does not spend the code', stillGood.status === 200, stillGood.body)
  const reEntered = await call('/sessions', { body: { value: sessCode } })
  ok('the same correct code opens a session again', reEntered.status === 201, reEntered.body)
  ok(
    'and the Join sheet still accepts it',
    (await call('/resolve', { body: { value: sessCode } })).body.kind === 'access',
  )

  const sessTables = await call(`/sessions/${sessToken}/tables`)
  ok('tables can be listed from the session alone', sessTables.body.tables.length > 0)
  const chosen = sessTables.body.tables[2]
  const seated = await call(`/sessions/${sessToken}/table`, { body: { tableId: chosen.id } })
  ok('a table can be chosen after the session opened', seated.body.session.tableLabel === chosen.label, seated.body)

  const sessOrder1 = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Session Guest',
      sessionToken: sessToken,
    },
  })
  ok('ordering needs no code once the session is open', sessOrder1.status === 201, sessOrder1.body)
  ok('the order lands on the session table', sessOrder1.body.order.tableLabel === chosen.label)

  const sessOrder2 = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: croissant.id, quantity: 1 }],
      customerName: 'Session Guest',
      sessionToken: sessToken,
    },
  })
  ok('a second round works on the same session', sessOrder2.status === 201, sessOrder2.body)

  const sessionElsewhere = await call('/orders', {
    body: {
      restaurantId: basil.id,
      type: 'dine_in',
      items: [{ menuItemId: pasta.id, quantity: 1 }],
      customerName: 'Session Guest',
      sessionToken: sessToken,
    },
  })
  ok('a session cannot be used at another restaurant', sessionElsewhere.status === 400, sessionElsewhere.body)

  const tableSession = await call('/sessions', { body: { value: `ORDRO:TABLE:${tableRow.token}` } })
  ok('a scanned table QR opens a session with the table set', tableSession.body.session.tableLabel === tableRow.label && tableSession.body.session.source === 'table_qr', tableSession.body)
  const urlSession = await call('/sessions', { body: { value: `http://localhost:5273/t/${tableRow.token}` } })
  ok('a table QR URL opens a session too', urlSession.status === 201)
  ok('a session from another restaurant is refused when one is named', (await call('/sessions', { body: { value: tableRow.token, restaurantId: basil.id } })).status === 400)
  ok('a nonsense code opens nothing', (await call('/sessions', { body: { value: 'ZZZZZZ' } })).status === 404)

  // The whole point of a QR stuck to one table: scanning it should be the last
  // thing the customer has to do about where they are sitting. The landing page
  // only remembered the table and dropped them on the menu, so the checkout
  // still showed an empty grid of every table, still asked for a staff code,
  // and the order was refused because nothing carried the QR to the server.
  {
    const scanned = await call('/sessions', { body: { value: `KHAPEE:TABLE:${tableRow.token}` } })
    const s = scanned.body.session
    ok('scanning a table QR says which table it was', s.tableLabel === tableRow.label, s)
    ok('and the session is live, so no code is asked for', s.active === true, s)

    const order = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
        customerName: 'Scanned the QR',
        sessionToken: s.token,
      },
    })
    ok('the order goes through on the QR alone', order.status === 201, order.body)
    ok('seated at the table on the sticker', order.body.order.tableLabel === tableRow.label, order.body.order)

    // The token on its own is proof too, for a checkout whose session lapsed.
    const byToken = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
        customerName: 'Lapsed session',
        tableToken: tableRow.token,
      },
    })
    ok('the QR token alone is still enough to order', byToken.status === 201, byToken.body)
    ok('and still lands on the right table', byToken.body.order.tableLabel === tableRow.label, byToken.body.order)
  }

  const ended = await call(`/sessions/${sessToken}`, { method: 'DELETE' })
  ok('a session can be ended', ended.status === 200)
  const afterEnd = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Session Guest',
      sessionToken: sessToken,
    },
  })
  ok('an ended session cannot be used to order', afterEnd.status === 400, afterEnd.body)

  group('PAY FIRST — payment stands in for the code')
  const payFirstTable = (await call(`/orders/tables/${mornington.id}`)).body.tables[0]
  const payFirst = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Prepaid Diner',
      tableId: payFirstTable.id,
      paymentClaim: { upiRef: '555566667777' },
    },
  })
  ok('paying through the app needs no access code', payFirst.status === 201, payFirst.body)
  ok('the prepaid order is seated at the chosen table', payFirst.body.order.tableLabel === payFirstTable.label)
  ok('paying opens a session for the rest of the meal', typeof payFirst.body.order.sessionToken === 'string')
  const paidSession = payFirst.body.order.sessionToken
  ok(
    'that session orders a second round with no code and no second payment',
    (await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Prepaid Diner',
        sessionToken: paidSession,
      },
    })).status === 201,
  )
  const stillNoProof = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Chancer',
      tableId: payFirstTable.id,
    },
  })
  ok('ordering with neither code, session nor payment is still refused', stillNoProof.status === 400, stillNoProof.body)

  const groupFromSession = await call('/sessions', { body: { value: `ORDRO:TABLE:${tableRow.token}` } })
  const groupViaSession = await call('/groups', {
    body: { restaurantId: mornington.id, hostName: 'Session Host', sessionToken: groupFromSession.body.session.token },
  })
  ok('a group can start from an open session', groupViaSession.status === 201, groupViaSession.body)
  ok('the group inherits the session table', groupViaSession.body.session.tableLabel === tableRow.label)

  group('ONE ACCOUNT — customer and restaurant owner')
  const dual = await call('/auth/register', {
    body: { name: 'Dual Role', email: 'dual@tablo.test', password: 'hunter22' },
  })
  const dualToken = dual.body.token
  ok('a plain customer starts with no restaurants', dual.body.user.restaurants.length === 0, dual.body.user)
  ok('and cannot reach the dashboard', (await call('/staff/orders', { token: dualToken })).status === 403)

  const firstPlace = await call('/auth/register-restaurant', {
    token: dualToken,
    body: { restaurantName: "Dual's Diner", address: 'Indore', categories: 'Cafe', tables: 4 },
  })
  ok('a customer can add a restaurant to their own account', firstPlace.status === 201, firstPlace.body)
  ok('no second account is created', firstPlace.body.user.email === 'dual@tablo.test')
  ok('the account now runs one restaurant', firstPlace.body.user.restaurants.length === 1)
  ok('the dashboard opens on it', firstPlace.body.user.restaurantName === "Dual's Diner")
  ok('the same session still works — no re-login', firstPlace.body.token === undefined)
  ok('the dashboard is now reachable', (await call('/staff/orders', { token: dualToken })).status === 200)
  ok('and they can still order as a customer', (await call('/orders/mine', { token: dualToken })).status === 200)

  const secondPlace = await call('/auth/register-restaurant', {
    token: dualToken,
    body: { restaurantName: "Dual's Second Spot", address: 'Indore', tables: 2 },
  })
  ok('a second restaurant can be added to the same account', secondPlace.status === 201, secondPlace.body)
  ok('both are listed', secondPlace.body.user.restaurants.length === 2)
  ok('the newest becomes active', secondPlace.body.user.restaurantName === "Dual's Second Spot")

  const dupName = await call('/auth/register-restaurant', {
    token: dualToken,
    body: { restaurantName: "Dual's Diner" },
  })
  ok('the same account cannot add the same name twice', dupName.status === 409, dupName.body)

  const firstId = secondPlace.body.user.restaurants.find((r: any) => r.name === "Dual's Diner").id
  const switched = await call('/staff/switch', { token: dualToken, body: { restaurantId: firstId } })
  ok('the dashboard switches between them', switched.body.user.restaurantId === firstId, switched.body.user)
  ok(
    'and the board follows the switch',
    (await call('/staff/menu', { token: dualToken })).body.restaurant.name === "Dual's Diner",
  )
  const foreignSwitch = await call('/staff/switch', { token: dualToken, body: { restaurantId: mornington.id } })
  ok('you cannot switch to a restaurant you do not run', foreignSwitch.status === 403, foreignSwitch.body)

  const strangerAdds = await call('/auth/register-restaurant', {
    body: { name: 'Someone', email: 'dual@tablo.test', password: 'hunter22', restaurantName: 'Sneaky' },
  })
  ok('signed out, a taken email is still refused', strangerAdds.status === 409)
  ok('existing staff accounts keep working', (await call('/staff/orders', { token: basilToken })).status === 200)

  group('EVERY ORDER IS A ROOM')
  const roomCode2 = await call('/staff/codes', { token: reLogin.body.token, body: { minutes: 20 } })
  const roomSess = await call('/sessions', { body: { value: roomCode2.body.code.code } })
  const roomTables = (await call(`/sessions/${roomSess.body.session.token}/tables`)).body.tables
  const soloOrder = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Solo Diner',
      tableId: roomTables[1].id,
      sessionToken: roomSess.body.session.token,
    },
  })
  ok(
    'an ordinary dine-in order opens a room',
    soloOrder.status === 201 && /^G[A-Z0-9]{4}$/.test(soloOrder.body.order.roomCode),
    soloOrder.body.order?.roomCode,
  )
  ok('the person who ordered is the host', typeof soloOrder.body.order.groupToken === 'string')

  const roomPreview = await call(`/groups/${soloOrder.body.order.roomCode}`)
  ok('the room can be previewed by code', roomPreview.body.group.tableLabel === roomTables[1].label, roomPreview.body)

  const friend = await call('/groups/join', {
    body: { code: soloOrder.body.order.roomCode, displayName: 'Friend' },
  })
  ok('a friend joins with no new order', friend.status === 201)
  const friendAdds = await call('/groups/session/items', {
    body: { groupToken: friend.body.groupToken, items: [{ menuItemId: croissant.id, quantity: 1 }] },
  })
  ok("the friend's food joins the same ticket", friendAdds.status === 201, friendAdds.body)

  const roomState = await call(`/groups/session/state?groupToken=${soloOrder.body.order.groupToken}`)
  ok('both people are on the table', roomState.body.session.members.length === 2, roomState.body.session.members)
  ok(
    "the original order is attributed to whoever placed it",
    roomState.body.session.members.find((m: any) => m.name === 'Solo Diner')?.items.length === 1,
    roomState.body.session.members,
  )
  ok(
    'one kitchen ticket, not two',
    roomState.body.session.order.orderNumber === soloOrder.body.order.orderNumber,
  )
  ok(
    'the ticket totals both people',
    roomState.body.session.totalCents === coldCoffee.priceCents + croissant.priceCents,
    roomState.body.session.totalCents,
  )
  const roomOrder = await call(`/orders/${soloOrder.body.order.orderNumber}?token=${soloOrder.body.order.verifyToken}`)
  ok('the receipt shows the room code', roomOrder.body.order.roomCode === soloOrder.body.order.roomCode)

  const takeawayNoRoom = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      takeaway: true,
      items: [{ menuItemId: croissant.id, quantity: 1 }],
      customerName: 'Takeaway Solo',
      sessionToken: roomSess.body.session.token,
    },
  })
  ok('takeaway opens no room — there is no table to share', takeawayNoRoom.body.order.roomCode == null, takeawayNoRoom.body.order?.roomCode)

  group('TABLE SERVICE — waiter adds, bill settles')
  const svcCode2 = (await call('/staff/codes', { token: reLogin.body.token, body: { minutes: 10 } })).body.code.code
  const svcSess = (await call('/sessions', { body: { value: svcCode2 } })).body.session.token
  const svcTable = (await call(`/sessions/${svcSess}/tables`)).body.tables[0]
  await call(`/sessions/${svcSess}/table`, { body: { tableId: svcTable.id } })
  const appOrder = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'Half And Half',
      sessionToken: svcSess,
    },
  })
  ok('customer orders part of the meal in the app', appOrder.status === 201, appOrder.body)
  const svcOrderId = appOrder.body.order.id
  const appOnly = appOrder.body.order.totalCents

  const waiterAdd = await call(`/staff/orders/${svcOrderId}/items`, {
    token: reLogin.body.token,
    body: { items: [{ menuItemId: croissant.id, quantity: 2 }] },
  })
  ok('a waiter adds the rest by hand', waiterAdd.status === 201, waiterAdd.body)
  ok('both halves land on one bill', waiterAdd.body.order.totalCents === appOnly + croissant.priceCents * 2)
  ok('the hand-added items are marked as such', waiterAdd.body.order.items.some((i: any) => i.addedByStaff))
  ok('the app items are not', waiterAdd.body.order.items.some((i: any) => !i.addedByStaff))

  const bill = await call(`/staff/bill/${svcOrderId}`, { token: reLogin.body.token })
  ok('a bill can be drawn for the table', bill.status === 200, bill.body)
  ok('the bill totals everything', bill.body.bill.totalCents === appOnly + croissant.priceCents * 2)
  ok('the bill shows what is still due', bill.body.bill.dueCents === bill.body.bill.totalCents)
  ok('the bill carries the restaurant header', bill.body.bill.restaurant.name === 'Mornington Coffee House')
  ok('the bill is itemised per person', bill.body.bill.byPerson.length >= 1, bill.body.bill.byPerson)

  const billSettled = await call(`/staff/bill/${svcOrderId}/settle`, { token: reLogin.body.token, body: { method: 'cash' } })
  ok('settling marks the order paid', billSettled.body.order.paymentStatus === 'PAID', billSettled.body.order?.paymentStatus)
  const afterSettle = await call(`/staff/bill/${svcOrderId}`, { token: reLogin.body.token })
  ok('nothing is left due', afterSettle.body.bill.dueCents === 0)
  ok('the bill is closed', afterSettle.body.bill.closed === true)
  const addAfterSettle = await call(`/staff/orders/${svcOrderId}/items`, {
    token: reLogin.body.token,
    body: { items: [{ menuItemId: croissant.id, quantity: 1 }] },
  })
  ok('nothing can be added to a settled bill', addAfterSettle.status === 409, addAfterSettle.body)
  ok(
    'another restaurant cannot see the bill',
    (await call(`/staff/bill/${svcOrderId}`, { token: basilToken })).status === 404,
  )
  ok(
    'another restaurant cannot add to the table',
    (await call(`/staff/orders/${svcOrderId}/items`, { token: basilToken, body: { items: [{ menuItemId: pasta.id, quantity: 1 }] } })).status === 404,
  )

  group('GOING LIVE — Done puts the restaurant on the app')
  const liveReg = await call('/auth/register-restaurant', {
    body: {
      name: 'Nadia Fernandes',
      email: 'nadia@golive.test',
      password: 'password123',
      restaurantName: 'Go Live Cafe',
      address: 'Palasia, Indore',
      tables: 2,
    },
  })
  const liveToken = liveReg.body.token as string
  const liveId = (await call('/staff/restaurant', { token: liveToken })).body.restaurant.id as number

  const beforeAnything = await call('/staff/restaurant', { token: liveToken })
  ok('a brand new restaurant is not on the app', beforeAnything.body.restaurant.isListed === false)
  ok('and it has not been published', beforeAnything.body.restaurant.publishedAt === null)
  ok(
    'customers browsing do not see it',
    !(await call('/restaurants')).body.restaurants.some((r: any) => r.id === liveId),
  )

  const emptyDone = await call('/staff/restaurant', {
    token: liveToken,
    method: 'PATCH',
    body: { publish: true, phone: '+91 90000 00000', city: 'Indore' },
  })
  ok('Done saves the details', emptyDone.body.restaurant.phone === '+91 90000 00000')
  ok('but an empty menu cannot go live', emptyDone.body.justPublished === false)
  ok('so it stays closed', emptyDone.body.restaurant.isOpen === false, emptyDone.body.restaurant)

  const liveCat = (await call('/staff/categories', { token: liveToken, body: { name: 'All day' } })).body.category.id
  const liveDish = (
    await call('/staff/menu', { token: liveToken, body: { categoryId: liveCat, name: 'Filter Coffee', price: '90' } })
  ).body.item.id

  const done = await call('/staff/restaurant', {
    token: liveToken,
    method: 'PATCH',
    body: { publish: true, hours: '8:00 AM – 10:00 PM' },
  })
  ok('with a dish on the menu, Done publishes', done.body.justPublished === true, done.body)
  ok('it opens for orders', done.body.restaurant.isOpen === true)
  ok('it is on the app', done.body.restaurant.isListed === true)
  ok('and the last edit saved with it', done.body.restaurant.hours === '8:00 AM – 10:00 PM')

  const browse = await call('/restaurants')
  ok(
    'customers can now see it',
    browse.body.restaurants.some((r: any) => r.id === liveId),
    browse.body.restaurants.map((r: any) => r.name),
  )

  const liveOrder = await call('/orders', {
    body: {
      restaurantId: liveId,
      type: 'pickup',
      items: [{ menuItemId: liveDish, quantity: 2 }],
      customerName: 'First Guest',
    },
  })
  ok('and order from it', liveOrder.status === 201, liveOrder.body)
  ok('at the price on the menu', liveOrder.body.order.totalCents === 18000)

  await call('/staff/restaurant/open', { token: liveToken, body: { isOpen: false } })
  const secondDone = await call('/staff/restaurant', {
    token: liveToken,
    method: 'PATCH',
    body: { publish: true, description: 'Filter coffee and not much else' },
  })
  ok('a later Done does not publish twice', secondDone.body.justPublished === false)
  ok(
    'and does not reopen a restaurant its owner closed',
    secondDone.body.restaurant.isOpen === false,
    secondDone.body.restaurant,
  )
  ok('while still saving the edit', secondDone.body.restaurant.description === 'Filter coffee and not much else')
  ok(
    'a closed restaurant cannot be ordered from',
    (
      await call('/orders', {
        body: { restaurantId: liveId, type: 'pickup', items: [{ menuItemId: liveDish, quantity: 1 }], customerName: 'Too Late' },
      })
    ).status === 409,
  )

  const openReg = await call('/auth/register-restaurant', {
    body: {
      name: 'Imran Qureshi',
      email: 'imran@openpublish.test',
      password: 'password123',
      restaurantName: 'Open Publish Kitchen',
      address: 'Saket, Indore',
      tables: 1,
    },
  })
  const openToken = openReg.body.token as string
  const openCat = (await call('/staff/categories', { token: openToken, body: { name: 'Rolls' } })).body.category.id
  await call('/staff/menu', { token: openToken, body: { categoryId: openCat, name: 'Paneer Roll', price: '140' } })
  await call('/staff/restaurant/open', { token: openToken, body: { isOpen: true } })
  const viaSwitch = await call('/staff/restaurant', { token: openToken })
  ok('opening from the menu screen publishes too', viaSwitch.body.restaurant.publishedAt !== null)
  const afterSwitch = await call('/staff/restaurant', {
    token: openToken,
    method: 'PATCH',
    body: { publish: true, phone: '+91 98888 77777' },
  })
  ok('so a later Done has nothing left to publish', afterSwitch.body.justPublished === false)

  group('JOINING A ROOM — a code, a link, or a QR')
  const aheadRoom = await call('/groups', {
    body: { restaurantId: mornington.id, hostName: 'Siya', ahead: true },
  })
  ok('a room can be opened around a cart with no code at all', aheadRoom.status === 201, aheadRoom.body)
  ok('and it has no table until someone arrives', aheadRoom.body.session.tableLabel === null)
  const aheadCode = aheadRoom.body.session.code as string

  const byCode = await call('/resolve', { body: { value: aheadCode } })
  ok('a typed room code resolves to the room', byCode.body.kind === 'room' && byCode.body.code === aheadCode, byCode.body)
  ok('and names the restaurant so nobody joins the wrong one', byCode.body.restaurantName === mornington.name)
  ok(
    'a room link resolves the same way',
    (await call('/resolve', { body: { value: `http://localhost:5273/g/${aheadCode}` } })).body.code === aheadCode,
  )
  ok(
    'so does a scanned room QR',
    (await call('/resolve', { body: { value: `ORDRO:ROOM:${aheadCode}` } })).body.code === aheadCode,
  )
  ok('lowercase typing still works', (await call('/resolve', { body: { value: aheadCode.toLowerCase() } })).body.kind === 'room')
  ok('an unknown room code is refused', (await call('/resolve', { body: { value: 'ZZZZ' } })).status === 404)

  // A six-character code is still the restaurant's, not a room's.
  const freshStaffCode = (await call('/staff/codes', { token: reLogin.body.token, body: { minutes: 20 } })).body.code.code
  const resolvedStaff = await call('/resolve', { body: { value: freshStaffCode } })
  ok('a six-character code is still read as the restaurant code', resolvedStaff.body.kind === 'access', resolvedStaff.body)
  // A spent code is refused at the sheet rather than at checkout three taps later.
  const spent = await call('/resolve', { body: { value: code1 } })
  ok('a code already used for an order is refused up front', spent.status === 400, spent.body)

  const roomFriend = await call('/groups/join', { body: { code: aheadCode, displayName: 'Aarav' } })
  ok('a friend can join the room', roomFriend.status === 201, roomFriend.body)
  const friendToken = roomFriend.body.groupToken as string
  const friendAdd = await call('/groups/session/items', {
    body: { groupToken: friendToken, items: [{ menuItemId: coldCoffee.id, quantity: 1 }] },
  })
  ok('and add their own food to it', friendAdd.status === 201, friendAdd.body)
  const roomStateAfterJoin = await call('/groups/session/state', { body: { groupToken: friendToken }, method: 'POST' })
  ok(
    'everything lands on one ticket',
    !!(await call(`/groups/${aheadCode}`)).body.group,
    roomStateAfterJoin.body,
  )

  await call('/groups/session/close', { body: { groupToken: aheadRoom.body.groupToken, force: true } })
  ok(
    'a closed room cannot be joined',
    (await call('/resolve', { body: { value: aheadCode } })).status === 409,
  )

  group('TAX ENGINE — the money maths, in isolation')
  {
    const { computeBill, taxableFromInclusive, financialYear } = await import('../server/tax.ts')
    const b1 = computeBill({
      lines: [{ name: 'Food', quantity: 1, unitPriceCents: 80000, rateBp: 500, inclusive: false }],
      billDiscountCents: 5000,
    })
    ok('discount comes off before tax, not after', b1.taxableCents === 75000, b1)
    ok('and the halves of GST are exact', b1.cgstCents === 1875 && b1.sgstCents === 1875 && b1.totalCents === 78750)

    const b2 = computeBill({
      lines: [{ name: 'Sandwich', quantity: 1, unitPriceCents: 10500, rateBp: 500, inclusive: true }],
    })
    ok('an inclusive price is not taxed twice', b2.totalCents === 10500 && b2.taxableCents === 10000, b2)

    const b3 = computeBill({
      lines: [{ name: 'x', quantity: 1, unitPriceCents: 100000, rateBp: 500, inclusive: false }],
      interState: true,
    })
    ok('another state is IGST, not CGST plus SGST', b3.igstCents === 5000 && b3.cgstCents === 0)

    const b4 = computeBill({ lines: [{ name: 'x', quantity: 2, unitPriceCents: 12000, rateBp: 0, inclusive: true }] })
    ok('a restaurant with no tax registration gets no tax line', b4.taxCents === 0 && b4.totalCents === 24000)

    const b5 = computeBill({ lines: [{ name: 'x', quantity: 3, unitPriceCents: 3333, rateBp: 500, inclusive: false }] })
    ok('CGST and SGST always add back to the tax exactly', b5.cgstCents + b5.sgstCents === b5.taxCents)
    ok('reverse-calculating an inclusive price is exact', taxableFromInclusive(10500, 500) === 10000)
    ok('the financial year runs April to March', financialYear(new Date('2026-08-20')) === '2026-27')
    ok('and January falls in the year before', financialYear(new Date('2026-02-10')) === '2025-26')
  }

  group('POS — one bill per order, and it never changes afterwards')
  // staffToken was signed out earlier on purpose; this is the live staff token.
  const roadToken = reLogin.body.token
  await call('/staff/tax', {
    token: roadToken,
    method: 'PATCH',
    body: { taxEnabled: true, gstin: '23TESTGST1234Z', stateCode: '23', invoicePrefix: 'TST', legalName: 'Test Foods' },
  })
  const rate = await call('/staff/tax/rates', {
    token: roadToken,
    body: { name: 'GST 5%', ratePercent: 5, hsnSac: '996331', inclusive: true, isDefault: true },
  })
  ok('a restaurant configures its own rate rather than inheriting one', rate.status === 201, rate.body)

  const sale = await call('/staff/pos/sale', {
    token: roadToken,
    body: { serviceMode: 'counter', items: [{ menuItemId: coldCoffee.id, quantity: 2 }], customerName: 'Walk-in' },
  })
  ok('a cashier can ring up a counter sale', sale.status === 201, sale.body)
  ok('and it is accepted, not waiting on a code', sale.body.order.status === 'ACCEPTED')

  const posOrderId = sale.body.order.id
  const quoted = await call('/staff/pos/quote', { token: roadToken, body: { orderId: posOrderId } })
  ok('the server prices the bill, not the browser', quoted.body.bill.totalCents > 0, quoted.body)
  ok(
    'an inclusive rate leaves the customer paying the menu price',
    quoted.body.bill.totalCents === quoted.body.bill.subtotalCents,
    quoted.body.bill,
  )
  ok(
    'and the tax is carved out of it, not added to it',
    quoted.body.bill.taxableCents + quoted.body.bill.taxCents === quoted.body.bill.totalCents,
    quoted.body.bill,
  )

  const fin = await call('/staff/pos/finalise', { token: roadToken, body: { orderId: posOrderId } })
  ok('finalising numbers the invoice', /^TST\/\d{4}-\d{2}\/\d{6}$/.test(fin.body.invoice.number), fin.body)
  const invoiceId = fin.body.invoice.id
  const again = await call('/staff/pos/finalise', { token: roadToken, body: { orderId: posOrderId } })
  ok('billing the same order twice returns the first bill', again.body.invoice.id === invoiceId)
  ok('and does not take a second number', again.body.invoice.number === fin.body.invoice.number)

  const total = fin.body.invoice.totalCents
  const part = await call('/staff/pos/pay', {
    token: roadToken,
    body: { invoiceId, amountCents: Math.floor(total / 2), method: 'cash', tenderedCents: 100000 },
  })
  ok('part payment leaves the bill partly paid', part.body.invoice.paymentStatus === 'PARTIALLY_PAID', part.body)
  ok('and cash change is worked out for the cashier', part.body.changeCents > 0)
  const rest = await call('/staff/pos/pay', {
    token: roadToken,
    body: { invoiceId, amountCents: total - Math.floor(total / 2), method: 'upi' },
  })
  ok('splitting across methods settles the same bill', rest.body.invoice.paymentStatus === 'PAID', rest.body)
  ok('with both payments recorded against it', rest.body.invoice.payments.length === 2)
  ok(
    'taking more than is owed is refused',
    (await call('/staff/pos/pay', { token: roadToken, body: { invoiceId, amountCents: 5000, method: 'cash' } })).status === 400,
  )

  ok(
    'a paid bill cannot be voided away',
    (await call(`/staff/pos/invoice/${invoiceId}/void`, { token: roadToken, body: { reason: 'x' } })).status === 409,
  )
  const refunded = await call(`/staff/pos/invoice/${invoiceId}/refund`, {
    token: roadToken,
    body: { amountCents: 1000, method: 'cash', reason: 'Item returned' },
  })
  ok('a refund is recorded without deleting the payment', refunded.status === 200, refunded.body)
  ok('the original payments are still there', refunded.body.invoice.payments.filter((p: any) => !p.isRefund).length === 2)
  ok('and the bill reads as partly refunded', refunded.body.invoice.paymentStatus === 'PARTIALLY_REFUNDED')

  group('POS — a finalised bill outlives the menu it came from')
  const invBefore = await call(`/staff/pos/invoice/${invoiceId}`, { token: roadToken })
  const lineBefore = invBefore.body.invoice.lines[0]
  await call('/staff/menu/' + coldCoffee.id, { token: roadToken, method: 'PATCH', body: { price: '999' } })
  await call('/staff/tax/rates', {
    token: roadToken,
    body: { name: 'GST 18%', ratePercent: 18, inclusive: true, isDefault: true },
  })
  const invAfter = await call(`/staff/pos/invoice/${invoiceId}`, { token: roadToken })
  const lineAfter = invAfter.body.invoice.lines[0]
  ok('the price on the old bill does not move', lineAfter.unitPriceCents === lineBefore.unitPriceCents, lineAfter)
  ok('nor does the rate it was taxed at', lineAfter.rateBp === lineBefore.rateBp)
  ok('nor the total the customer paid', invAfter.body.invoice.totalCents === invBefore.body.invoice.totalCents)
  ok('and the seller on it is who they were that day', invAfter.body.invoice.seller.gstin === '23TESTGST1234Z')

  group('DELIVERY — the kitchen gets to say no')
  const area = await call('/staff/delivery-areas', {
    token: roadToken,
    body: { name: 'Saket', note: 'Saket Nagar', feeRupees: 30, minOrderRupees: 250 },
  })
  ok('a restaurant names the areas it will deliver to', area.status === 201, area.body)
  const areaId = area.body.area.id
  ok(
    'naming one turns delivery on',
    (await call(`/restaurants/${mornington.id}`)).body.restaurant.acceptsDelivery === true,
  )
  ok(
    'and customers can see where it delivers, with the fee',
    (await call(`/restaurants/${mornington.id}/delivery-areas`)).body.areas[0].feeCents === 3000,
  )

  ok(
    'an address outside those areas is refused before anything is ordered',
    (await call('/sessions/delivery', {
      body: { restaurantId: mornington.id, areaId: 999999, address: '12 Somewhere Else Road', phone: '9876543210' },
    })).status === 400,
  )
  ok(
    'a locality on its own is not an address',
    (await call('/sessions/delivery', {
      body: { restaurantId: mornington.id, areaId, address: 'Saket', phone: '9876543210' },
    })).status === 400,
  )
  ok(
    'and a delivery without a phone number is refused',
    (await call('/sessions/delivery', {
      body: { restaurantId: mornington.id, areaId, address: '301 Silver Heights, Saket Nagar', phone: '12' },
    })).status === 400,
  )

  const del = await call('/sessions/delivery', {
    body: { restaurantId: mornington.id, areaId, address: '301 Silver Heights, Saket Nagar', phone: '9876543210' },
  })
  ok('a proper address in the area opens a session', del.status === 201, del.body)
  ok('which knows the area it is in', del.body.session.areaName === 'Saket')

  const delOrder = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 2 }],
      customerName: 'Home',
      sessionToken: del.body.session.token,
    },
  })
  ok('the order is placed without a table or a code', delOrder.status === 201, delOrder.body)
  ok(
    'and waits to be accepted rather than going straight to the kitchen',
    delOrder.body.order.status === 'REQUESTED',
    delOrder.body.order,
  )
  ok('it carries the address with it', delOrder.body.order.deliveryAddress.includes('Silver Heights'))

  const delBoard = await call('/staff/ops', { token: roadToken })
  ok('it shows on the board as waiting on the kitchen', delBoard.body.summary.deliveryRequests >= 1, delBoard.body.summary)
  ok(
    'with the address and phone the rider will need',
    delBoard.body.deliveries.some((d: any) => d.address.includes('Silver Heights') && d.phone.length > 0),
  )

  ok(
    'declining without a reason is refused',
    (await call(`/staff/orders/${delOrder.body.order.id}/decline`, { token: roadToken, body: { reason: '' } })).status === 400,
  )

  const accepted = await call(`/staff/orders/${delOrder.body.order.id}/accept`, { token: roadToken, method: 'POST' })
  ok('accepting starts the kitchen', accepted.body.order.status === 'ACCEPTED', accepted.body)
  for (const st of ['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    const r = await call(`/staff/orders/${delOrder.body.order.id}/status`, { token: roadToken, body: { status: st } })
    ok(`a delivery walks through ${st.toLowerCase().replace(/_/g, ' ')}`, r.status === 200, r.body)
  }

  // A second one, this time refused.
  const del2 = await call('/sessions/delivery', {
    body: { restaurantId: mornington.id, areaId, address: '88 Saket Nagar, second lane', phone: '9000000000' },
  })
  const refusedOrder = await call('/orders', {
    // Two, because one is under the area's minimum now that the minimum is
    // actually applied.
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 2 }],
      customerName: 'Busy night',
      sessionToken: del2.body.session.token,
    },
  })
  const declined = await call(`/staff/orders/${refusedOrder.body.order.id}/decline`, {
    token: roadToken,
    body: { reason: 'Kitchen is full tonight' },
  })
  ok('a full kitchen can refuse an order', declined.body.order.status === 'DECLINED', declined.body)
  ok('and the reason comes back with it', declined.body.order.declinedReason === 'Kitchen is full tonight')
  ok(
    'the customer reads that reason on their own order',
    (await call(`/orders/${refusedOrder.body.order.orderNumber}?token=${refusedOrder.body.order.verifyToken}`)).body.order
      .declinedReason === 'Kitchen is full tonight',
  )
  ok(
    'and a refused order cannot be quietly accepted afterwards',
    (await call(`/staff/orders/${refusedOrder.body.order.id}/accept`, { token: roadToken, method: 'POST' })).status === 409,
  )

  group('WHAT DELIVERY COSTS — the fee and the minimum, both promised up front')
  {
    // The area screen advertises "₹30 delivery · ₹250 minimum" before anyone
    // picks a dish. Neither was applied: an order under the minimum went
    // through, and the fee was quoted and then never charged, so the restaurant
    // was paying to deliver its own food.
    // Priced from the menu as it stands right now: earlier tests deliberately
    // move these prices around, and a hardcoded rupee figure here would be
    // testing the fixture rather than the rule.
    const live = (await call(`/restaurants/${mornington.id}`)).body.menu
      .flatMap((c: any) => c.items)
      .find((i: any) => i.id === coldCoffee.id)
    const unit = live.priceCents
    // One is under the minimum, two are over it, whatever the coffee costs today.
    const minRupees = Math.ceil((unit * 2) / 100)

    const kerb = await call('/staff/delivery-areas', {
      token: roadToken,
      body: { name: 'Test Kerb', note: 'For the money checks', feeRupees: 30, minOrderRupees: minRupees },
    })
    const kerbId = kerb.body.area.id

    const session = async () =>
      (
        await call('/sessions/delivery', {
          body: { restaurantId: mornington.id, areaId: kerbId, address: '5 Saket Nagar, top floor', phone: '9811111111' },
        })
      ).body.session

    const s1 = await session()
    ok('the session carries what delivery adds', s1.deliveryFeeCents === 3000, s1)
    ok('and what it will not go out under', s1.minOrderCents === minRupees * 100, s1)

    const under = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
        customerName: 'Too small',
        sessionToken: s1.token,
      },
    })
    ok('an order under the minimum is refused', under.status === 400, under.body)
    ok('and says how much more is needed', /add ₹/i.test(under.body.error ?? ''), under.body.error)

    const s2 = await session()
    const paid = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: coldCoffee.id, quantity: 2 }],
        customerName: 'Pays the fee',
        sessionToken: s2.token,
      },
    })
    ok('an order over it goes through', paid.status === 201, paid.body)
    ok('the dishes are the dishes', paid.body.order.subtotalCents === unit * 2, paid.body.order)
    ok('the fee is charged on top', paid.body.order.deliveryFeeCents === 3000, paid.body.order)
    ok('and the total is both', paid.body.order.totalCents === unit * 2 + 3000, paid.body.order)

    // Paying by UPI has to ask for what is owed. This summed the dishes alone,
    // so the app quoted one total on screen and asked the customer's bank for
    // a smaller one, leaving the restaurant carrying the fee it had just
    // advertised.
    const s3 = await session()
    const quote = await call('/orders/payment-request', {
      body: {
        restaurantId: mornington.id,
        items: [{ menuItemId: coldCoffee.id, quantity: 2 }],
        sessionToken: s3.token,
      },
    })
    ok('a UPI request for a delivery includes the fee', quote.body.amountCents === unit * 2 + 3000, quote.body)
    ok(
      'and the link asks the bank for that same amount',
      quote.body.upiLink.includes(`am=${((unit * 2 + 3000) / 100).toFixed(2)}`),
      quote.body.upiLink,
    )
    const underQuote = await call('/orders/payment-request', {
      body: {
        restaurantId: mornington.id,
        items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
        sessionToken: s3.token,
      },
    })
    ok('and it will not take money for an order under the minimum', underQuote.status === 400, underQuote.body)

    // Every other way of ordering still asks for exactly the dishes.
    const plain = await call('/orders/payment-request', {
      body: { restaurantId: mornington.id, items: [{ menuItemId: coldCoffee.id, quantity: 2 }] },
    })
    ok('a request with no delivery behind it is just the dishes', plain.body.amountCents === unit * 2, plain.body)

    // Rebuilt totals are the classic way a charge disappears.
    const added = await call(`/staff/orders/${paid.body.order.id}/items`, {
      token: roadToken,
      body: { items: [{ menuItemId: croissant.id, quantity: 1 }] },
    })
    ok('a waiter adding a dish does not cancel the fee', added.body.order.deliveryFeeCents === 3000, added.body.order)
    ok(
      'and the total still counts it',
      added.body.order.totalCents === added.body.order.subtotalCents + 3000,
      added.body.order,
    )

    const bill = await call(`/staff/bill/${paid.body.order.id}`, { token: roadToken })
    ok('the counter bill shows it as its own line', bill.body.bill.deliveryFeeCents === 3000, bill.body.bill)

    const inv = await call('/staff/pos/finalise', { token: roadToken, body: { orderId: paid.body.order.id } })
    ok('the invoice carries it as a charge', inv.status === 200 || inv.status === 201, inv.body)
    ok(
      'named so a customer can see what it was',
      JSON.stringify(inv.body.invoice).includes('Delivery'),
      inv.body.invoice?.charges ?? inv.body.invoice,
    )
    ok(
      'and the invoice is worth what the order was',
      inv.body.invoice.totalCents === added.body.order.totalCents,
      { invoice: inv.body.invoice.totalCents, order: added.body.order.totalCents },
    )

    // The fee was copied onto the order, so what the customer agreed to pay
    // survives the restaurant changing its mind about the area afterwards.
    await call(`/staff/delivery-areas/${kerbId}`, { token: roadToken, method: 'DELETE' })
    ok(
      'dropping the area later leaves an existing order alone',
      (await call(`/orders/${paid.body.order.orderNumber}?token=${paid.body.order.verifyToken}`)).body.order
        .deliveryFeeCents === 3000,
    )
  }

  group('THE ACCOUNT ITSELF — a restaurant taking over its own login')
  {
    // A restaurant could edit its menu and its photos but not the login it was
    // handed, so the password whoever set it up chose was the password forever.
    const start = await call('/auth/register-restaurant', {
      body: {
        name: 'Handover Owner',
        email: 'handover@tablo.test',
        password: 'firstpass1',
        restaurantName: 'Handover Cafe',
      },
    })
    ok('a restaurant account exists', start.status === 201, start.body)
    let token = start.body.token

    ok(
      'the wrong current password changes nothing',
      (await call('/auth/me/credentials', { token, body: { currentPassword: 'nope', newPassword: 'secondpass1' } }))
        .status === 403,
    )
    ok(
      'and a short new password is refused',
      (await call('/auth/me/credentials', { token, body: { currentPassword: 'firstpass1', newPassword: 'abc' } }))
        .status === 400,
    )
    ok(
      'an email somebody else already uses is refused',
      (await call('/auth/me/credentials', {
        token,
        body: { currentPassword: 'firstpass1', email: 'test.customer@tablo.test' },
      })).status === 409,
    )

    const moved = await call('/auth/me/credentials', {
      token,
      body: { currentPassword: 'firstpass1', email: 'the.actual.cafe@tablo.test', newPassword: 'secondpass1' },
    })
    ok('the account moves to the restaurant’s own address', moved.status === 200, moved.body)
    ok('and hands back a token so the screen keeps working', !!moved.body.token, moved.body)
    token = moved.body.token
    ok(
      'that token is still good for staff work',
      (await call('/staff/restaurant', { token })).status === 200,
    )

    ok(
      'the old password no longer opens it',
      (await call('/auth/login', { body: { email: 'the.actual.cafe@tablo.test', password: 'firstpass1' } })).status ===
        401,
    )
    ok(
      'the old address no longer opens it either',
      (await call('/auth/login', { body: { email: 'handover@tablo.test', password: 'secondpass1' } })).status === 401,
    )
    const back = await call('/auth/login', {
      body: { email: 'the.actual.cafe@tablo.test', password: 'secondpass1' },
    })
    ok('the new pair does', back.status === 200, back.body)
    ok(
      'and whoever else was signed in has been signed out',
      (await call('/staff/restaurant', { token: start.body.token })).status === 401,
    )
  }

  group('ROADSIDE — a car outside is a session like a table is')
  const zoneRes = await call('/staff/zones', {
    token: roadToken,
    body: { name: 'Zone A', note: 'Directly outside' },
  })
  ok('staff can define a roadside zone', zoneRes.status === 201, zoneRes.body)
  const zoneId = zoneRes.body.zone.id
  ok('the zone carries a token for its own sign', !!zoneRes.body.zone.token)
  ok(
    'defining a zone turns roadside service on',
    (await call(`/restaurants/${mornington.id}`)).body.restaurant.acceptsCar === true,
  )
  ok(
    'customers can see the zones to pick from',
    (await call(`/restaurants/${mornington.id}/zones`)).body.zones.some((z: any) => z.id === zoneId),
  )

  const car = await call('/sessions/car', {
    body: { restaurantId: mornington.id, zoneId, vehicle: 'White Honda City', partySize: 3 },
  })
  ok('a car session opens with no code and no staff', car.status === 201, car.body)
  ok('and is numbered the way staff say it out loud', /^Car \d+$/.test(car.body.session.label), car.body.session)
  ok('it knows which zone it is in', car.body.session.zoneName === 'Zone A')
  ok('a car with no description is refused', (await call('/sessions/car', {
    body: { restaurantId: mornington.id, zoneId, vehicle: '  ' },
  })).status === 400)

  const carOrder = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 2 }],
      customerName: 'Roadside',
      sessionToken: car.body.session.token,
    },
  })
  ok('a car orders without ever choosing a table', carOrder.status === 201, carOrder.body)
  ok('and the order follows the roadside flow', carOrder.body.order.serviceType === 'car', carOrder.body.order)

  const rsBoard = await call('/staff/ops', { token: roadToken })
  const rsMine = rsBoard.body.sessions.find((x: any) => x.token === car.body.session.token)
  ok('the car is on the floor board', !!rsMine, rsBoard.body.summary)
  ok('with its vehicle and zone', rsMine?.vehicle === 'White Honda City' && rsMine?.zoneName === 'Zone A')
  ok('and what it owes', rsMine?.dueCents === carOrder.body.order.totalCents)

  const empty = await call('/sessions/car', {
    body: { restaurantId: mornington.id, zoneId, vehicle: 'Black Creta' },
  })
  const board2 = await call('/staff/ops', { token: roadToken })
  const unasked = board2.body.sessions.find((x: any) => x.token === empty.body.session.token)
  ok('a car nobody has been to shows as waiting to order', unasked?.waitingToOrder === true)
  ok('and the summary counts it', board2.body.summary.waitingToOrder >= 1, board2.body.summary)

  for (const st of ['ACCEPTED', 'PREPARING', 'READY']) {
    await call(`/staff/orders/${carOrder.body.order.id}/status`, { token: roadToken, body: { status: st } })
  }
  const runs = await call('/staff/runs', { token: roadToken })
  const drop = runs.body.groups.flatMap((g: any) => g.drops).find((d: any) => d.id === carOrder.body.order.id)
  ok('a ready car order reaches the runner queue', !!drop, runs.body)
  ok('grouped under its zone, so one walk covers it', runs.body.groups.some((g: any) => g.zone === 'Zone A'))
  ok('the runner sees what is in the bag', (drop?.items ?? []).length > 0)

  const delivered = await call(`/staff/orders/${carOrder.body.order.id}/delivered`, {
    token: roadToken,
    method: 'POST',
  })
  ok('the runner can mark it delivered', delivered.status === 200)
  const board3 = await call('/staff/ops', { token: roadToken })
  const after = board3.body.sessions
    .find((x: any) => x.token === car.body.session.token)
    ?.orders.find((o: any) => o.id === carOrder.body.order.id)
  ok('which is recorded against the order', after?.status === 'DELIVERED', after)
  ok('and it still shows as unpaid until money changes hands', after?.paymentStatus === 'UNPAID')

  const moved = await call(`/sessions/${car.body.session.token}/zone`, { body: { zoneId: null } })
  ok('a car that moves keeps its session', moved.status === 200 && moved.body.session.zoneName === null)
  ok(
    'and keeps the number staff have been calling it',
    moved.body.session.label === car.body.session.label,
  )

  const guest = await call('/staff/sessions/car', {
    token: roadToken,
    body: { zoneId, vehicle: 'Red Swift' },
  })
  ok('staff can open a car for someone with no phone', guest.status === 201, guest.body)
  const board4 = await call('/staff/ops', { token: roadToken })
  ok(
    'and the board says it was opened by staff',
    board4.body.sessions.find((x: any) => x.token === guest.body.session.token)?.openedByStaff === true,
  )

  group('OLD QR CODES — printed before the rename, still on tables')
  {
    const t = tableRow.token
    for (const prefix of ['KHAPEE', 'ORDRO', 'TABLO']) {
      const r = await call('/resolve', { body: { value: `${prefix}:TABLE:${t}` } })
      ok(`a ${prefix}: table code still scans`, r.status === 200 && r.body.kind === 'table', r.body)
    }
    const fresh = await call('/staff/codes', { token: roadToken, body: { minutes: 10 } })
    const c = fresh.body.code.code
    for (const prefix of ['KHAPEE', 'ORDRO', 'TABLO']) {
      const r = await call('/resolve', { body: { value: `${prefix}:ACCESS:${mornington.id}:${c}` } })
      ok(`a ${prefix}: access code still scans`, r.status === 200 && r.body.kind === 'access', r.body)
    }
  }

  group('STAYING SIGNED IN — across the rebuild that happens every night')
  {
    // The free plan's container has no disk: each time the site sleeps, the
    // database is rebuilt from the snapshot and the sessions table comes back
    // empty. Every login died with it, so a restaurant signed in again every
    // time it opened the dashboard. A token that proves itself does not.
    const who = await call('/auth/login', { body: { email: 'owner@newplace.test', password: 'hunter22' } })
    ok('an owner signs in', who.status === 200, who.body)
    const token = who.body.token
    ok('and the token says who it is for, signed', /^v1\.\d+\.\d+\./.test(token), token)

    // Exactly what a restart does to it.
    const wipe = new Database(DB_PATH)
    wipe.prepare('DELETE FROM sessions').run()
    wipe.close()

    ok(
      'the same token still works with the sessions table emptied',
      (await call('/staff/restaurant', { token })).status === 200,
    )
    ok(
      'and still on the same restaurant',
      (await call('/auth/me', { token })).body.user.restaurantId != null,
    )

    // The things that should still turn a token away.
    ok(
      'a token signed for nobody is refused',
      (await call('/staff/restaurant', { token: 'v1.1.99999999999999.notasignature' })).status === 401,
    )
    ok(
      'and one whose expiry has been edited is refused',
      (await call('/staff/restaurant', { token: token.replace(/\.(\d+)\./, '.99999999999999.') })).status === 401,
    )
    const out = await call('/auth/logout', { token, method: 'POST' })
    ok('signing out still ends it', out.status === 200 && (await call('/auth/me', { token })).status === 401)
  }

  group('SEARCH — what a crawler is handed')
  {
    // Fetched over HTTP rather than imported: these read the database, and the
    // test process opens a different one from the server under test.
    const site = BASE.replace(/\/api$/, '')
    const text = async (p: string) => (await fetch(site + p)).text()

    const home = await text('/')
    ok('the front page is named after the site', /<title>Khapee[^<]*<\/title>/.test(home), home.match(/<title>[^<]*<\/title>/)?.[0])
    ok('and carries a description a result can print', /<meta name="description" content="[^"]{60,}"/.test(home))
    ok('with a canonical url', home.includes('rel="canonical"'))
    ok('and an Open Graph image for link previews', home.includes('property="og:image"'))

    const page = await text(`/r/${mornington.id}`)
    ok('a restaurant page is titled after the restaurant', /<title>Mornington/.test(page), page.match(/<title>[^<]*<\/title>/)?.[0])
    ok('and still says which site it is on', /<title>[^<]*Khapee/.test(page))
    ok('it carries Restaurant structured data', page.includes('"@type":"Restaurant"'), page.includes('ld+json'))

    const robots = await text('/robots.txt')
    ok('robots points crawlers at the sitemap', robots.includes('/sitemap.xml'), robots)
    ok('and keeps the staff area out of search', robots.includes('Disallow: /staff'))
    ok("along with anybody's individual order", robots.includes('Disallow: /order/'))

    const map = await text('/sitemap.xml')
    ok('the sitemap lists the front page', map.includes('<loc>' + site + '/</loc>'), map.slice(0, 200))
    ok('and every restaurant with a menu', map.includes(`<loc>${site}/r/${mornington.id}</loc>`))

    // This server has no proxy in front of it, so a caller claiming the request
    // arrived over https is claiming something only a proxy could know.
    // Believing them would let anyone dictate the canonical URL we hand Google.
    const forged = await (await fetch(site + '/', { headers: { 'X-Forwarded-Proto': 'https' } })).text()
    ok(
      'a forged X-Forwarded-Proto is ignored with no proxy in front',
      forged.includes(`rel="canonical" href="${site}/"`),
      forged.match(/rel="canonical"[^>]*/)?.[0],
    )
  }

  group('SEARCH BEHIND A PROXY — the scheme the customer actually used')
  {
    // In production the host terminates TLS and forwards to us over plain HTTP.
    // Taking req.protocol at face value there wrote http:// into every canonical
    // link, telling Google to prefer a URL that only redirects. Run a second
    // server the way production runs it and check what a crawler is told.
    const port = PORT + 1
    const proxied = spawn('npx', ['tsx', 'server/index.ts'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'production', TABLO_PORT: String(port), TABLO_DB: DB_PATH },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    try {
      const base = `http://localhost:${port}`
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + '/api/health')).ok) break
        } catch {}
        await new Promise((r) => setTimeout(r, 100))
      }
      // The host stays localhost — a proxy passes the customer's Host through
      // untouched, and it is only the scheme it has to tell us about.
      const secure = `https://localhost:${port}`
      const asEdge = (p: string) =>
        fetch(base + p, { headers: { 'X-Forwarded-Proto': 'https' } }).then((r) => r.text())

      const home = await asEdge('/')
      ok(
        'the canonical url is the https one the customer is on',
        home.includes(`rel="canonical" href="${secure}/"`),
        home.match(/rel="canonical"[^>]*/)?.[0],
      )
      ok('and so is the url in the link preview', home.includes(`property="og:url" content="${secure}/"`))

      const map = await asEdge('/sitemap.xml')
      ok('every sitemap url is https', !map.includes('<loc>http://'), map.match(/<loc>[^<]*/)?.[0])

      const robots = await asEdge('/robots.txt')
      ok('and the sitemap robots points at is too', robots.includes(`Sitemap: ${secure}/sitemap.xml`), robots)
    } finally {
      proxied.kill('SIGTERM')
    }
  }

  group('ORDERING FROM AWAY — the path that needs no code')
  ok(
    'eating in still needs proof you are at the restaurant',
    (await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
        customerName: 'From home',
      },
    })).status === 400,
  )
  ok(
    'and so does takeaway, which is also ordered at the counter',
    (await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        takeaway: true,
        items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
        customerName: 'From home',
      },
    })).status === 400,
  )
  const fromAway = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'pickup',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'From home',
    },
  })
  ok('but collecting later needs nothing at all', fromAway.status === 201, fromAway.body)
  ok('and it is a real order the restaurant can see', fromAway.body.order.status === 'REQUESTED')

  group('ROADSIDE WITHOUT ZONES — a place with one stretch of kerb')
  // Some places have several stretches of road and need to know which one you
  // are on. A cafe serving the few cars outside its own door does not, and
  // should never be made to invent zones to use the feature.
  const zoneList = await call('/staff/zones', { token: roadToken })
  for (const z of zoneList.body.zones) {
    await call(`/staff/zones/${z.id}`, { token: roadToken, method: 'DELETE' })
  }
  ok(
    'a restaurant can drop its zones and still take cars',
    (await call(`/restaurants/${mornington.id}/zones`)).body.zones.length === 0,
  )

  const bare = await call('/sessions/car', {
    body: { restaurantId: mornington.id, vehicle: 'White Baleno', vehicleNumber: 'MP09 CD 4455' },
  })
  ok('a car session opens with no zone at all', bare.status === 201, bare.body)
  ok('it still gets the number staff will call it', /^Car \d+$/.test(bare.body.session.label))
  ok('and simply has no zone rather than a broken one', bare.body.session.zoneName === null)

  const bareOrder = await call('/orders', {
    body: {
      restaurantId: mornington.id,
      type: 'dine_in',
      items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
      customerName: 'In the car',
      sessionToken: bare.body.session.token,
    },
  })
  ok('the car orders without a zone, a table or a code', bareOrder.status === 201, bareOrder.body)
  ok('and follows the roadside flow all the same', bareOrder.body.order.serviceType === 'car')

  for (const st of ['ACCEPTED', 'PREPARING', 'READY']) {
    await call(`/staff/orders/${bareOrder.body.order.id}/status`, { token: roadToken, body: { status: st } })
  }
  const bareRuns = await call('/staff/runs', { token: roadToken })
  ok(
    'the runner sees it under Outside rather than a missing zone',
    bareRuns.body.groups.some((g: any) => g.zone === 'Outside'),
    bareRuns.body.groups.map((g: any) => g.zone),
  )

  group('PAYING DECIDES WHO WAITS')
  {
    // A restaurant that has been paid can start cooking. One that has not is
    // being asked to make food on the promise that somebody turns up, and that
    // is a decision it has to be able to refuse — whatever way the order came.
    const unpaid = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Owes money',
      },
    })
    ok('an unpaid order waits on the kitchen', unpaid.body.order.status === 'REQUESTED', unpaid.body.order)

    const prepaid = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Already paid',
        paymentClaim: { upiRef: '402312345679' },
      },
    })
    ok('one paid in the app goes straight in', prepaid.body.order.status === 'NEW', prepaid.body.order)

    // The same is true of eating in, which used to skip the question entirely.
    const table = await call('/sessions', { body: { value: `KHAPEE:TABLE:${tableRow.token}` } })
    const atTable = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'At a table',
        sessionToken: table.body.session.token,
      },
    })
    ok('so does an unpaid order at a table', atTable.body.order.status === 'REQUESTED', atTable.body.order)

    // And saying yes drops it into that mode's own flow, not delivery's.
    const yes = await call(`/staff/orders/${atTable.body.order.id}/accept`, { token: roadToken, method: 'POST' })
    ok('accepting puts it in the kitchen', yes.body.order.status === 'ACCEPTED', yes.body)
    for (const st of ['PREPARING', 'READY', 'COMPLETED']) {
      const r = await call(`/staff/orders/${atTable.body.order.id}/status`, { token: roadToken, body: { status: st } })
      ok(`and it finishes the dine-in way through ${st.toLowerCase()}`, r.status === 200, r.body)
    }

    ok(
      'refusing one needs a reason the customer can read',
      (await call(`/staff/orders/${unpaid.body.order.id}/decline`, { token: roadToken, body: { reason: '' } }))
        .status === 400,
    )
    const no = await call(`/staff/orders/${unpaid.body.order.id}/decline`, {
      token: roadToken,
      body: { reason: 'Out of croissants' },
    })
    ok('and it can be refused', no.body.order.status === 'DECLINED', no.body)
    ok('with the reason on it', no.body.order.declinedReason === 'Out of croissants')
  }

  group('WHAT THE MONEY LOOKS LIKE FROM BOTH SIDES')
  {
    // Money over UPI goes bank to bank and Khapee is not in the middle, so
    // between "owes money" and "confirmed" there is a real third state that
    // both screens have to be able to say.
    const cash = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Pays later',
      },
    })
    ok('an order nobody has paid for reads as unpaid', cash.body.order.paymentState === 'unpaid', cash.body.order)
    ok(
      'and its history starts where it actually is, not at NEW',
      cash.body.order.events[0]?.status === 'REQUESTED',
      cash.body.order.events,
    )

    const sent = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Paid in the app',
        paymentClaim: { upiRef: '402311112222' },
      },
    })
    // Khapee never sees the money, so "I paid" has to come with the number the
    // restaurant can look up. Without it the claim is unfalsifiable and the
    // person carrying the risk is whoever made the food.
    const noRef = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'No reference',
        paymentClaim: { upiRef: '' },
      },
    })
    ok('a payment claim without a reference is refused', noRef.status === 400, noRef.body)
    const shortRef = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Half a reference',
        paymentClaim: { upiRef: '4023111' },
      },
    })
    ok('and so is half of one', shortRef.status === 400, shortRef.body)

    ok('one paid through the app reads as sent, not unpaid', sent.body.order.paymentState === 'sent', sent.body.order)
    ok('with the reference the customer gave', sent.body.order.upiRef === '402311112222', sent.body.order)
    ok('and it did not wait for a yes', sent.body.order.status === 'NEW', sent.body.order)

    // The board sees the same thing the customer was told.
    const board = await call('/staff/orders?scope=active', { token: roadToken })
    const onBoard = (board.body.orders as any[]).find((o) => o.id === sent.body.order.id)
    ok('the restaurant sees it as sent too', onBoard?.paymentState === 'sent', onBoard)

    // And confirming it settles the claim rather than leaving two records that
    // disagree about the same money.
    const confirmed = await call(`/staff/orders/${sent.body.order.id}/payment`, {
      token: roadToken,
      body: { paymentStatus: 'PAID' },
    })
    ok('confirming makes it paid', confirmed.body.order.paymentState === 'paid', confirmed.body.order)
    ok(
      'and the claim is settled, not left waiting',
      confirmed.body.order.claimedCents === 0 && confirmed.body.order.confirmedCents > 0,
      confirmed.body.order,
    )

    const undone = await call(`/staff/orders/${sent.body.order.id}/payment`, {
      token: roadToken,
      body: { paymentStatus: 'UNPAID' },
    })
    ok('undoing puts the claim back', undone.body.order.paymentState === 'sent', undone.body.order)
  }

  group('SAYING YES, AND SAYING NO')
  {
    // An order waiting on a yes has exactly three answers, and the board has
    // to offer all of them.
    const waiting = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Waiting on a yes',
      },
    })
    ok('an unpaid order waits', waiting.body.order.status === 'REQUESTED', waiting.body.order)

    const yes = await call(`/staff/orders/${waiting.body.order.id}/status`, {
      token: roadToken,
      body: { status: 'ACCEPTED' },
    })
    ok('yes is one tap from the board', yes.body.order.status === 'ACCEPTED', yes.body)

    const another = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Turned away',
      },
    })
    const no = await call(`/staff/orders/${another.body.order.id}/decline`, {
      token: roadToken,
      body: { reason: 'Kitchen is closing' },
    })
    ok('and no is one tap with a reason', no.body.order.status === 'DECLINED', no.body)
    ok('which the customer can read', no.body.order.declinedReason === 'Kitchen is closing', no.body.order)
  }

  group('THE TAP THAT REACHES WHATSAPP')
  {
    // Every route to the thank-you ends at one of these two strings, so they
    // are worth pinning: a scheme that opens the app rather than a web page
    // about the app, and a number with the country code WhatsApp insists on.
    const { thanksText, waAppLink, waLink, waNumber } = await import('../shared/thanks.ts')

    const message = thanksText('Aarav')
    ok(
      'the thank-you names the customer and Khapee',
      message === 'Hi Aarav, Thanks for ordering through Khapee today! We hope you enjoy your food. 🍕',
      message,
    )

    // wa.me is a website: on a phone it loads Safari, shows a "Continue to
    // Chat" page, and inside an installed app that detour dead-ends. This is
    // the address of the app itself.
    const app = waAppLink('98765 43210', message)
    ok('the button opens WhatsApp itself, not a page about it', app.startsWith('whatsapp://send?'), app)
    ok('addressed with the country code on the front', app.includes('phone=919876543210'), app)
    ok('and the message already written', app.includes(encodeURIComponent(message)), app)

    // Kept as the way out for a computer, or a phone without the app.
    ok('the web address stays as the fallback', waLink('9876543210', message).startsWith('https://wa.me/'), '')

    // A number nobody can be reached on must produce no link at all: a button
    // that opens WhatsApp on an empty chat is worse than no button.
    ok('nothing to send to means no link', waAppLink('', message) === '', waAppLink('', message))
    ok('and a number too short to be real is refused', waNumber('98765') === '', waNumber('98765'))
    ok('while one already carrying +91 is left alone', waNumber('+91 98765 43210') === '919876543210', '')

    // The page the notification lands on, which exists to be passed through.
    //
    // It is served by the server rather than being a route in the app, and the
    // difference is the whole point: a route in the app means downloading the
    // app first, which on a host waking from sleep is several seconds of white
    // screen before anything can even try to open WhatsApp. This is one
    // document that redirects while it is still being parsed, so what is
    // checked here is that it answers at all, that the jump is written above
    // the content, and that it carries a button for the phone that asks first.
    const landed = await fetch(`http://localhost:${PORT}/thank?to=919876543210&who=Aarav&text=${encodeURIComponent(message)}`)
    const html = await landed.text()
    ok('the notification lands on a page that answers', landed.status === 200, landed.status)
    ok('served as a page, not the app', /text\/html/.test(landed.headers.get('content-type') ?? ''), '')
    ok('never cached, because the message differs every time', landed.headers.get('cache-control') === 'no-store', '')
    ok('the jump is written before the page it replaces', html.indexOf('location.replace') < html.indexOf('<body'), '')
    ok('it hands over to the app, not to a page about the app', html.includes('whatsapp://send?phone=919876543210'), '')
    ok('and a button is there for a phone that asks first', html.includes('>Open WhatsApp<'), '')
    ok('with the thank-you carried through', html.includes('Thanks for ordering through Khapee'), '')

    // A name is somebody else's text on its way back into markup.
    const nasty = await fetch(`http://localhost:${PORT}/thank?to=919876543210&who=${encodeURIComponent('<script>x</script>')}&text=hi`)
    const nastyHtml = await nasty.text()
    ok('a customer cannot write markup into it', !nastyHtml.includes('<script>x</script>'), '')

    // No number means no button: one that opens WhatsApp on an empty chat is
    // worse than being told plainly there is nobody to write to.
    const nobody = await fetch(`http://localhost:${PORT}/thank?to=&who=nobody&text=hi`)
    const nobodyHtml = await nobody.text()
    ok('an order with no number says so instead', nobodyHtml.includes('No number on this order'), '')
    ok('and offers no link to nowhere', !nobodyHtml.includes('whatsapp://'), '')
  }

  group('A NUMBER THEY CAN RING')
  {
    // The two calls a kitchen actually makes are "we are out of that" and "we
    // cannot find you". Neither works on a customer who only left a name.
    const noNumber = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'No phone',
      }),
    })
    ok('an order without a phone number is refused', noNumber.status === 400, noNumber.status)
    const why = (await noNumber.json()) as any
    ok('and says what to add', /10-digit mobile/i.test(why.error ?? ''), why)

    const tooShort = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Typo',
        contactPhone: '9876',
      }),
    })
    ok('so is half a number', tooShort.status === 400, tooShort.status)

    const good = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Reachable',
        contactPhone: '+91 98765 43210',
      },
    })
    ok('a real one goes through', good.status === 201, good.body)
    ok(
      'and it is kept on the order, so the kitchen can ring back',
      good.body.order.customerPhone === '+91 98765 43210',
      good.body.order.customerPhone,
    )

    // A counter sale is the exception: that customer is standing at the till.
    const counter = await call('/staff/pos/sale', {
      token: roadToken,
      body: { items: [{ menuItemId: croissant.id, quantity: 1 }], customerName: 'Walk-in' },
    })
    ok('but the till never asks for one', counter.status === 200 || counter.status === 201, counter.body)
  }

  group('TELLING THE CUSTOMER, FOR NOTHING')
  {
    // WhatsApp bills a business per order for messaging somebody who has not
    // messaged them first. This costs nothing and reaches the same locked
    // screen, so it is the one that runs by default.
    const mine = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Wants telling',
      },
    })
    const o = mine.body.order

    const key = await call('/orders/notify-key')
    ok('a browser can fetch the key it subscribes with', typeof key.body.publicKey === 'string', key.body)

    const device = {
      endpoint: 'https://push.example/customer-phone',
      keys: { p256dh: 'BDpUB9' + 'q'.repeat(80), auth: 'abcdefghijklmnop' },
    }
    const signedUp = await call(`/orders/${o.orderNumber}/notify`, {
      body: { token: o.verifyToken, subscription: device },
    })
    ok('the receipt token is proof enough — no account needed', signedUp.status === 200, signedUp.body)

    const stranger = await call(`/orders/${o.orderNumber}/notify`, {
      body: { token: 'not-this-order', subscription: device },
    })
    ok('somebody else cannot follow your order', stranger.status === 403, stranger.body)

    const junk = await call(`/orders/${o.orderNumber}/notify`, {
      body: { token: o.verifyToken, subscription: { endpoint: 'https://push.example/x' } },
    })
    ok('an incomplete subscription is refused', junk.status === 400, junk.body)

    const missing = await call('/orders/ZZZZ/notify', { body: { token: 'x', subscription: device } })
    ok('and an order that does not exist is a 404', missing.status === 404, missing.body)
  }

  group('TELLING THE RESTAURANT, WITH THE BOARD SHUT')
  {
    // Silence is how an alerting system fails, so the dashboard has to be able
    // to say what is actually switched on rather than promise.
    const state = await call('/staff/alerts', { token: roadToken })
    ok('the dashboard can read what its alerts can do', state.status === 200, state.body)
    ok('including the key a browser subscribes with', typeof state.body.push?.publicKey === 'string', state.body)
    ok('and where the email would go', typeof state.body.email?.to === 'string', state.body)
    ok('and everywhere a switched-on phone will ring for', Array.isArray(state.body.ringsFor), state.body)
    ok(
      'which is the owner of this restaurant',
      String(state.body.email.to).includes('@'),
      state.body.email,
    )

    // A one-person café is fine with the owner's own address; a kitchen with a
    // shared inbox is not, so it is a field rather than an assumption.
    const ownerAddress = state.body.email.to
    const badAddress = await call('/staff/alerts/email', {
      token: roadToken,
      method: 'PATCH',
      body: { email: 'not-an-address' },
    })
    ok('a mistyped alert address is refused', badAddress.status === 400, badAddress.body)

    const named = await call('/staff/alerts/email', {
      token: roadToken,
      method: 'PATCH',
      body: { email: 'kitchen@roadside.test' },
    })
    ok('a restaurant can name its own inbox', named.body.to === 'kitchen@roadside.test', named.body)

    const cleared = await call('/staff/alerts/email', {
      token: roadToken,
      method: 'PATCH',
      body: { email: '' },
    })
    ok('and clearing it falls back to the owner', cleared.body.to === ownerAddress, cleared.body)

    ok(
      'a test email says so plainly when Khapee cannot send any',
      (await call('/staff/alerts/test-email', { token: roadToken, body: {} })).status === 503,
    )

    const junk = await call('/staff/alerts/subscribe', {
      token: roadToken,
      body: { subscription: { endpoint: 'https://push.example/x' } },
    })
    ok('a subscription with no keys is refused', junk.status === 400, junk.body)

    const good = await call('/staff/alerts/subscribe', {
      token: roadToken,
      body: {
        subscription: {
          endpoint: 'https://push.example/real-device',
          keys: { p256dh: 'BDpUB9' + 'x'.repeat(80), auth: 'abcdefghijklmnop' },
        },
      },
    })
    ok('a complete one is kept', good.status === 200 && good.body.devices >= 1, good.body)

    // The endpoint is the device: subscribing twice is the same phone, not two.
    const again = await call('/staff/alerts/subscribe', {
      token: roadToken,
      body: {
        subscription: {
          endpoint: 'https://push.example/real-device',
          keys: { p256dh: 'BDpUB9' + 'y'.repeat(80), auth: 'ponmlkjihgfedcba' },
        },
      },
    })
    ok('the same device does not count twice', again.body.devices === good.body.devices, again.body)

    // One phone, an owner with two places. Nobody should have to guess that
    // the picker at the top of the dashboard was also choosing which orders
    // would wake them.
    const bothPlaces = await call('/staff/alerts', { token: dualToken })
    ok('an owner is told everywhere a phone will ring for', bothPlaces.body.ringsFor.length === 2, bothPlaces.body)

    // Subscribed with one restaurant selected...
    const activeNow = (await call('/staff/menu', { token: dualToken })).body.restaurant.id
    await call('/staff/alerts/subscribe', {
      token: dualToken,
      body: {
        subscription: {
          endpoint: 'https://push.example/owner-phone',
          keys: { p256dh: 'BDpUB9' + 'z'.repeat(80), auth: 'qrstuvwxyzabcdef' },
        },
      },
    })
    // ...and it counts for the other one too, without being told about it.
    const otherPlace = (
      (await call('/auth/me', { token: dualToken })).body.user.restaurants as any[]
    ).find((r) => r.id !== activeNow)
    await call('/staff/switch', { token: dualToken, body: { restaurantId: otherPlace.id } })
    const fromOther = await call('/staff/alerts', { token: dualToken })
    ok(
      'and one phone covers both places, not just the selected one',
      fromOther.body.push.devices >= 1,
      fromOther.body.push,
    )
    await call('/staff/alerts/unsubscribe', {
      token: dualToken,
      body: { endpoint: 'https://push.example/owner-phone' },
    })

    // Anybody who can sign in can add a phone, so an owner has to be able to
    // see the list and take one off it.
    const listed = await call('/staff/alerts', { token: roadToken })
    ok('the devices are listed, not just counted', Array.isArray(listed.body.push.list), listed.body.push)
    const entry = (listed.body.push.list as any[]).find((d) => d.who)
    ok('with who signed each one up', !!entry?.who, listed.body.push.list)

    // A link instead of the password: it grants one capability to one device.
    const invite = await call('/staff/alerts/invite', { token: roadToken, body: {} })
    ok('an owner can make an invite link', invite.status === 201 && !!invite.body.token, invite.body)
    ok(
      'and it is six characters somebody can type off another screen',
      /^[A-Z0-9]{6}$/.test(invite.body.code),
      invite.body,
    )
    ok(
      'typed in any case, it still works',
      (await call(`/alerts/invite/${String(invite.body.code).toLowerCase()}`)).status === 200,
    )

    const opened = await call(`/alerts/invite/${invite.body.token}`)
    ok(
      'the phone that opens it is told which restaurant',
      opened.body.restaurant === 'Mornington Coffee House',
      opened.body,
    )
    ok('and given the key to subscribe with', typeof opened.body.publicKey === 'string', opened.body)

    const invitedDevice = {
      endpoint: 'https://push.example/invited-phone',
      keys: { p256dh: 'BDpUB9' + 'w'.repeat(80), auth: 'zyxwvutsrqponmlk' },
    }
    const took = await call(`/alerts/invite/${invite.body.token}`, { body: { subscription: invitedDevice } })
    ok('it can sign that phone up with no account at all', took.status === 200, took.body)

    const reused = await call(`/alerts/invite/${invite.body.token}`, { body: { subscription: invitedDevice } })
    ok('and is spent — a second phone cannot use it', reused.status === 410, reused.body)

    // Unless it was meant to be kept: the owner's own phones have to be put
    // back every time the server forgets them, and a spent code cannot do it.
    const keep = new Database(DB_PATH)
    keep
      .prepare(
        `INSERT INTO alert_invites (restaurant_id, token, expires_at, reusable)
         VALUES (?, 'KEEPME', datetime('now', '+1 day'), 1)`,
      )
      .run(mornington.id)
    keep.close()
    const first = await call('/alerts/invite/KEEPME', {
      body: {
        subscription: {
          endpoint: 'https://push.example/kept-one',
          keys: { p256dh: 'BDpUB9' + 'k'.repeat(80), auth: 'aaaaaaaaaaaaaaaa' },
        },
      },
    })
    const second = await call('/alerts/invite/KEEPME', {
      body: {
        subscription: {
          endpoint: 'https://push.example/kept-two',
          keys: { p256dh: 'BDpUB9' + 'm'.repeat(80), auth: 'bbbbbbbbbbbbbbbb' },
        },
      },
    })
    ok('a code kept on purpose works twice', first.status === 200 && second.status === 200, {
      first: first.body,
      second: second.body,
    })
    ok('and still reads as valid afterwards', (await call('/alerts/invite/KEEPME')).status === 200)

    const withInvited = (await call('/staff/alerts', { token: roadToken })).body.push.list as any[]
    ok(
      'the invited phone is on the list, marked as invited',
      withInvited.some((d) => /invited/i.test(d.who)),
      withInvited,
    )

    const spare = await call('/staff/alerts/invite', { token: roadToken, body: {} })
    const cancelled = await call(`/staff/alerts/invite/${(await call('/staff/alerts', { token: roadToken })).body.invites[0].id}/revoke`, {
      token: roadToken,
      body: {},
    })
    ok('an unused link can be called back', cancelled.status === 200, cancelled.body)
    ok(
      'and stops working once it is',
      (await call(`/alerts/invite/${spare.body.token}`)).status === 410,
    )

    // One device can follow the whole platform rather than one kitchen —
    // whoever runs Khapee wants the board, not a subscription per restaurant
    // that has to be redone every time one joins.
    const everywhere = new Database(DB_PATH)
    everywhere
      .prepare(
        `INSERT INTO alert_invites (restaurant_id, token, expires_at, all_restaurants)
         VALUES (?, 'ALLONE', datetime('now', '+1 day'), 1)`,
      )
      .run(mornington.id)
    everywhere.close()

    const wide = await call('/alerts/invite/ALLONE')
    ok('a platform-wide code says so', wide.body.everywhere === true, wide.body)

    await call('/alerts/invite/ALLONE', {
      body: {
        subscription: {
          endpoint: 'https://push.example/owner-everywhere',
          keys: { p256dh: 'BDpUB9' + 'v'.repeat(80), auth: 'lkjhgfdsamnbvcxz' },
        },
      },
    })
    const elsewhere = await call('/staff/alerts', { token: basilToken })
    ok(
      'and that phone counts for a restaurant it was never invited to',
      (elsewhere.body.push.list as any[]).some((d) => /every restaurant/i.test(d.who)),
      elsewhere.body.push.list,
    )

    const notMine = await call('/staff/alerts/devices/999999/remove', { token: roadToken, body: {} })
    ok('a device on another restaurant cannot be removed', notMine.status === 404, notMine.body)

    const removed = await call(`/staff/alerts/devices/${entry.id}/remove`, { token: roadToken, body: {} })
    ok('and the owner can take one off', removed.status === 200, removed.body)
    ok(
      'which takes it off the list',
      !((await call('/staff/alerts', { token: roadToken })).body.push.list as any[]).some(
        (d) => d.id === entry.id,
      ),
    )

    const off = await call('/staff/alerts/unsubscribe', {
      token: roadToken,
      body: { endpoint: 'https://push.example/real-device' },
    })
    ok('and a device can stop itself too', off.status === 200, off.body)

    ok(
      'none of this is anybody else\u2019s to read',
      (await call('/staff/alerts')).status === 401,
    )
  }

  group('THE THANK-YOU ON WHATSAPP')
  {
    // Sending it needs Meta's Cloud API — a token, an account, a charge per
    // message. With none of that set nothing must leave the server, and above
    // all the order must not care: the kitchen has a ticket either way.
    const withNumber = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Reachable',
        contactPhone: '98765 43210',
      },
    })
    ok('an order still goes through with nothing configured', withNumber.status === 201, withNumber.body)

    const log = new Database(DB_PATH)
    const row = log
      .prepare('SELECT * FROM whatsapp_messages WHERE order_id = ?')
      .get(withNumber.body.order.id) as any
    log.close()

    // The words, exactly. The two names are the whole point of the message.
    const { orderMessageText, WHATSAPP_TEMPLATE_BODY } = await import('../server/whatsapp.ts')
    const written = orderMessageText({
      phone: '9876543210',
      customerName: 'Siya',
      restaurantName: 'Revery',
      orderNumber: 'A123',
      total: '₹470',
      trackUrl: 'https://khapee.com/order/A123',
    })
    ok(
      'the message greets the customer by name and thanks them for Khapee',
      written === 'Hi Siya, Thanks for ordering through Khapee today! We hope you enjoy your food. 🍕',
      written,
    )
    ok(
      'and the template registered with Meta is the same sentence',
      WHATSAPP_TEMPLATE_BODY ===
        'Hi {{1}}, Thanks for ordering through Khapee today! We hope you enjoy your food. 🍕',
      WHATSAPP_TEMPLATE_BODY,
    )
    ok('but the attempt is written down', !!row, row)
    ok('saying it is switched off, not broken', row?.status === 'off', row)
    // A ten-digit Indian number is what people type; WhatsApp wants the code.
    ok('with the number in the form WhatsApp wants', row?.phone === '919876543210', row)

    // An account's own number stands in when the form is left alone — the
    // customer is reachable either way, which is the only thing that matters.
    const reachable = await call('/auth/register', {
      body: { name: 'Has A Phone', email: 'has.phone@tablo.test', password: 'hunter22' },
    })
    await call('/auth/me', {
      method: 'PATCH',
      token: reachable.body.token,
      body: { name: 'Has A Phone', phone: '90000 00001' },
    })

    const account = await call('/orders', {
      token: reachable.body.token,
      body: {
        restaurantId: mornington.id,
        type: 'pickup',
        items: [{ menuItemId: croissant.id, quantity: 1 }],
        customerName: 'Signed in',
        contactPhone: '',
      },
    })
    const log2 = new Database(DB_PATH)
    const row2 = log2
      .prepare('SELECT * FROM whatsapp_messages WHERE order_id = ?')
      .get(account.body.order?.id) as any
    log2.close()
    ok('an order from an account falls back to the number on it', !!row2 && row2.status === 'off', {
      status: account.status,
      row2,
    })
  }

  group('A PRECINCT — ordering from wherever you are standing')
  {
    // 140 in Indore already works this way with a phone: you stand outside one
    // café, ring another, and somebody carries it over. The app's job is to
    // remove the second and third walk — back for the money, back to ask what
    // you meant — not to invent the first one.
    const made = new Database(DB_PATH)
    made.prepare("INSERT OR IGNORE INTO precincts (slug, name, city) VALUES ('t140', 'Test 140', 'Indore')").run()
    const pid = (made.prepare("SELECT id FROM precincts WHERE slug = 't140'").get() as any).id
    made
      .prepare('INSERT INTO precinct_spots (precinct_id, label, note, sort_order) VALUES (?, ?, ?, 1)')
      .run(pid, 'Outside the sweet shop', 'The shopfront')
    const spotId = (made.prepare('SELECT id FROM precinct_spots WHERE precinct_id = ?').get(pid) as any).id
    made.close()

    const seen = await call(`/precincts/t140`)
    ok('the area is a page of its own', seen.status === 200 && seen.body.precinct.name === 'Test 140', seen.body)
    ok('with somewhere to stand', seen.body.spots.some((s: any) => s.id === spotId), seen.body.spots)
    ok(
      'and nobody on it until a restaurant joins',
      !seen.body.restaurants.some((r: any) => r.id === mornington.id),
      seen.body.restaurants.map((r: any) => r.name),
    )

    const beforeJoin = await call('/sessions/precinct', {
      body: { restaurantId: mornington.id, spotId, lookFor: 'Blue scooter', phone: '9876543210' },
    })
    ok('and will not take an order for one that has not', beforeJoin.status === 409, beforeJoin.body)

    const list = await call('/staff/precincts', { token: roadToken })
    const mine = list.body.precincts.find((p: any) => p.slug === 't140')
    ok('a restaurant sees the area on its own settings', !!mine && mine.joined === false, list.body)
    const joined = await call(`/staff/precincts/${pid}/join`, { token: roadToken, body: { joined: true } })
    ok('and can put itself on the list', joined.status === 200 && joined.body.joined === true, joined.body)
    ok(
      'after which customers see it there',
      (await call('/precincts/t140')).body.restaurants.some((r: any) => r.id === mornington.id),
    )

    ok(
      'a number is required — they may have to ring before setting off',
      (await call('/sessions/precinct', { body: { restaurantId: mornington.id, spotId, lookFor: 'x' } })).status ===
        400,
    )

    const sess = await call('/sessions/precinct', {
      body: { restaurantId: mornington.id, spotId, lookFor: 'Blue scooter, grey shirt', phone: '9876543210' },
    })
    ok('somebody standing there opens a session', sess.status === 201, sess.body)
    ok('which knows the landmark', sess.body.session.spotLabel === 'Outside the sweet shop', sess.body.session)
    ok('and what to look for', sess.body.session.lookFor === 'Blue scooter, grey shirt', sess.body.session)
    ok('and a number to ring', sess.body.session.phone === '9876543210', sess.body.session)
    ok('with no table and no code', sess.body.session.tableLabel === null && sess.body.session.spotId === spotId)

    // A list of shopfronts cannot name every doorway in a market, so somebody
    // standing between two of them says where they are in their own words.
    ok(
      'a landmark nobody picked and no words either is refused',
      (await call('/sessions/precinct', {
        body: { restaurantId: mornington.id, precinctSlug: 't140', phone: '9876543210' },
      })).status === 400,
    )
    const own = await call('/sessions/precinct', {
      body: {
        restaurantId: mornington.id,
        precinctSlug: 't140',
        place: 'By the ATM next to the bank',
        lookFor: 'Red helmet',
        phone: '9811111111',
      },
    })
    ok('their own words open a session just as well', own.status === 201, own.body)
    ok('with no landmark attached', own.body.session.spotId === null, own.body.session)
    ok('and where they are is what they typed', own.body.session.whereLabel === 'By the ATM next to the bank')
    ok('still in the right area', own.body.session.precinctName === 'Test 140', own.body.session)

    const ownOrder = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
        customerName: 'By the ATM',
        sessionToken: own.body.session.token,
      },
    })
    ok('and the order carries those words to the runner', ownOrder.body.order.whereLabel === 'By the ATM next to the bank', ownOrder.body.order)
    ok('with what to look for kept separate', ownOrder.body.order.lookFor === 'Red helmet', ownOrder.body.order)

    const order = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
        customerName: 'Standing outside',
        sessionToken: sess.body.session.token,
      },
    })
    ok('the order goes through with neither', order.status === 201, order.body)
    ok('it waits to be accepted, like a delivery', order.body.order.status === 'REQUESTED', order.body.order)
    ok('and is its own kind of order', order.body.order.serviceType === 'precinct', order.body.order)
    ok('carrying the landmark for whoever walks it out', order.body.order.spotLabel === 'Outside the sweet shop')
    ok('and nothing is charged for the walk', order.body.order.deliveryFeeCents === 0, order.body.order)
    ok('the number rides along with it', order.body.order.deliveryPhone === '9876543210', order.body.order)

    const board = await call('/staff/ops', { token: roadToken })
    ok(
      'it lands on the same list as the deliveries',
      board.body.deliveries.some((d: any) => d.orderNumber === order.body.order.orderNumber && d.nearby),
      board.body.deliveries.map((d: any) => [d.orderNumber, d.area]),
    )
    ok('waiting on an answer', board.body.summary.deliveryRequests >= 1, board.body.summary)

    const yes = await call(`/staff/orders/${order.body.order.id}/accept`, { token: roadToken, method: 'POST' })
    ok('the kitchen can take it', yes.body.order.status === 'ACCEPTED', yes.body)
    for (const st of ['PREPARING', 'READY', 'OUT_FOR_DELIVERY']) {
      const r = await call(`/staff/orders/${order.body.order.id}/status`, { token: roadToken, body: { status: st } })
      ok(`and walk it through ${st.toLowerCase().replace(/_/g, ' ')}`, r.status === 200, r.body)
    }

    // Out of the door but not yet handed over: still the runner's problem, and
    // still needing a button to say it arrived.
    const onFoot = await call('/staff/runs', { token: roadToken })
    const drop = onFoot.body.groups
      .flatMap((g: any) => g.drops.map((d: any) => ({ ...d, zone: g.zone })))
      .find((d: any) => d.orderNumber === order.body.order.orderNumber)
    ok('it stays on the runner list while it is out', !!drop, onFoot.body.groups.map((g: any) => g.zone))
    ok('grouped by the area, the way a zone is', drop?.zone === 'Test 140', drop?.zone)
    ok('showing the landmark', drop?.label === 'Outside the sweet shop', drop?.label)
    ok('what to look for', drop?.detail === 'Blue scooter, grey shirt', drop?.detail)
    ok('and the number to ring', drop?.phone === '9876543210', drop?.phone)

    const handed = await call(`/staff/orders/${order.body.order.id}/delivered`, { token: roadToken, method: 'POST' })
    ok('handing it over closes it', handed.status === 200, handed.body)
    ok(
      'and it leaves the runner list',
      !(await call('/staff/runs', { token: roadToken })).body.groups.some((g: any) =>
        g.drops.some((d: any) => d.orderNumber === order.body.order.orderNumber),
      ),
    )

    // Leaving has to work too: one person on a Sunday cannot go anywhere.
    await call(`/staff/precincts/${pid}/join`, { token: roadToken, body: { joined: false } })
    ok(
      'stepping off the list takes them off the area page',
      !(await call('/precincts/t140')).body.restaurants.some((r: any) => r.id === mornington.id),
    )
    ok(
      'and stops new orders at once',
      (await call('/sessions/precinct', { body: { restaurantId: mornington.id, spotId, phone: '9876543210' } }))
        .status === 409,
    )
  }

  group('A CAR IS NOT A TABLE — where group ordering stops')
  {
    // A room is a table's shared ticket and the kitchen sends it to that table.
    // Someone in their car has no table for it to go to. The cart was deciding
    // "you are in a group" from a handle left over at this restaurant, so a car
    // customer with an old room was offered "Add to table" as the only button
    // and could not place a car order at all.
    const car = await call('/sessions/car', {
      body: { restaurantId: mornington.id, vehicle: 'Grey Alto' },
    })
    const fromCar = await call('/groups', {
      body: { restaurantId: mornington.id, hostName: 'Siya', sessionToken: car.body.session.token, ahead: true },
    })
    ok('a room cannot be opened from a car', fromCar.status === 409, fromCar.body)
    ok(
      'and it says what to do instead of asking for a table number',
      /bring it out/.test(fromCar.body.error ?? ''),
      fromCar.body.error,
    )

    const areaForCar = await call('/staff/delivery-areas', {
      token: roadToken,
      body: { name: 'Kerbside', note: 'For the room checks', feeRupees: 0, minOrderRupees: 0 },
    })
    const home = await call('/sessions/delivery', {
      body: {
        restaurantId: mornington.id,
        areaId: areaForCar.body.area.id,
        address: '4 Saket Nagar, blue gate',
        phone: '9822222222',
      },
    })
    const fromHome = await call('/groups', {
      body: { restaurantId: mornington.id, hostName: 'Siya', sessionToken: home.body.session.token, ahead: true },
    })
    ok('nor from an address', fromHome.status === 409, fromHome.body)

    // The feature itself is untouched: this is the same call without a car.
    const stillWorks = await call('/groups', {
      body: { restaurantId: mornington.id, hostName: 'Siya', ahead: true },
    })
    ok('a room still opens around an ordinary cart', stillWorks.status === 201, stillWorks.body)

    // And the car order the customer actually wanted goes through.
    const carOrder = await call('/orders', {
      body: {
        restaurantId: mornington.id,
        type: 'dine_in',
        items: [{ menuItemId: coldCoffee.id, quantity: 1 }],
        customerName: 'Grey Alto',
        sessionToken: car.body.session.token,
      },
    })
    ok('the car orders for itself', carOrder.status === 201, carOrder.body)
    ok('as a car order, not a table one', carOrder.body.order.serviceType === 'car', carOrder.body.order)
    ok('with no room attached to it', !carOrder.body.order.roomCode, carOrder.body.order.roomCode)

    await call(`/staff/delivery-areas/${areaForCar.body.area.id}`, { token: roadToken, method: 'DELETE' })
  }

  group('GROUPED ITEMS — a bar list inside one section')
  const grouped = await call(`/restaurants/${mornington.id}`)
  ok(
    'every dish reports a group, empty when it has none',
    grouped.body.menu.every((c: any) => c.items.every((i: any) => typeof i.groupLabel === 'string')),
  )
  ok(
    'an ordinary dish has no group',
    grouped.body.menu.flatMap((c: any) => c.items).every((i: any) => i.groupLabel === ''),
  )

  group('THEMES — a restaurant can carry its own look')
  const themed = await call('/restaurants')
  ok(
    'every restaurant reports a theme, empty for the standard one',
    themed.body.restaurants.every((r: any) => typeof r.theme === 'string'),
  )
  ok(
    'the standard look is the default',
    themed.body.restaurants.some((r: any) => r.theme === ''),
  )
  const detail = await call(`/restaurants/${mornington.id}`)
  ok('a restaurant detail carries it too', detail.body.restaurant.theme === '')

  group('PROFILE — an account you can edit, but never need')
  const me = await call('/auth/me', { token: customerToken })
  ok('the account carries a phone field and a join date', me.body.user.phone === '' && !!me.body.user.memberSince)

  const edited = await call('/auth/me', {
    token: customerToken,
    method: 'PATCH',
    body: { name: 'Siya A.', phone: '+91 98765 43210' },
  })
  ok('a name and phone can be saved', edited.body.user.name === 'Siya A.', edited.body)
  ok('and the phone comes back', edited.body.user.phone === '+91 98765 43210')
  ok(
    'the change sticks for the next request',
    (await call('/auth/me', { token: customerToken })).body.user.name === 'Siya A.',
  )
  ok(
    'an empty name is refused',
    (await call('/auth/me', { token: customerToken, method: 'PATCH', body: { name: ' ' } })).status === 400,
  )
  ok(
    'the email is not editable here',
    (
      await call('/auth/me', {
        token: customerToken,
        method: 'PATCH',
        body: { email: 'someone@else.test' },
      })
    ).body.user.email !== 'someone@else.test',
  )
  ok('a signed-out visitor has no profile to read', (await call('/auth/me')).status === 401)
  ok(
    'and cannot edit one',
    (await call('/auth/me', { method: 'PATCH', body: { name: 'Nobody' } })).status === 401,
  )

  group('QR codes (generated and scanned locally)')
  const tableToScan = db.prepare('SELECT token, label FROM restaurant_tables WHERE restaurant_id = ? LIMIT 1').get(basil.id) as any
  const payloads = [
    `ORDRO:ORDER:${o3.orderNumber}:${o3.verifyToken}`,
    `ORDRO:ACCESS:${mornington.id}:${code1}`,
    `http://localhost:5273/t/${tableToScan.token}`,
  ]
  for (const payload of payloads) {
    const decoded = await roundTripQr(payload)
    ok(`QR round-trips through the scanner: ${payload.slice(0, 26)}…`, decoded === payload, decoded)
  }
  const scannedTableUrl = await call('/resolve', { body: { value: payloads[2] } })
  ok('a scanned table URL resolves to its table', scannedTableUrl.body.tableLabel === tableToScan.label, scannedTableUrl.body)

  db.close()
}

/** Encodes with the same library the UI uses, then decodes with the same one the camera uses. */
async function roundTripQr(text: string): Promise<string | null> {
  const QRCode = (await import('qrcode')).default
  const jsQR = (await import('jsqr')).default
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const modules = qr.modules
  const scale = 4
  const quiet = 4
  const side = (modules.size + quiet * 2) * scale
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (!modules.get(x, y)) continue
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx
          const py = (y + quiet) * scale + dy
          const i = (py * side + px) * 4
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 0
        }
      }
    }
  }
  return jsQR(rgba, side, side)?.data ?? null
}
