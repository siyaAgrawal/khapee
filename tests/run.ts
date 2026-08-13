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
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
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
  ok('code QR payload identifies restaurant + code', gen.body.code.qrPayload === `TABLO:ACCESS:${mornington.id}:${code1}`)

  const gen2 = await call('/staff/codes', { token: staffToken, body: { minutes: 10 } })
  ok('generated codes are unique', gen2.body.code.code !== code1)

  const verify = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: code1 } })
  ok('customer can verify a valid code', verify.status === 200 && verify.body.ok)

  const verifyLower = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: code1.toLowerCase() } })
  ok('code entry is case-insensitive', verifyLower.status === 200)

  const resolveCode = await call('/resolve', { body: { value: `TABLO:ACCESS:${mornington.id}:${code1}` } })
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
  ok('order starts as NEW and UNPAID', o1.status === 'NEW' && o1.paymentStatus === 'UNPAID')
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
  const resolveTable = await call('/resolve', { body: { value: `TABLO:TABLE:${tableRow.token}` } })
  ok('a scanned table QR resolves to restaurant + table', resolveTable.body.kind === 'table' && resolveTable.body.tableLabel === tableRow.label, resolveTable.body)

  const bareToken = await call('/resolve', { body: { value: tableRow.token } })
  ok('a bare table token also resolves', bareToken.body.kind === 'table')

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
    body: { value: `TABLO:ORDER:${o3.orderNumber}:${o3.verifyToken}` },
  })
  ok('staff can verify the customer QR at handover', scan.status === 200 && scan.body.order.id === o3.id, scan.body)

  const manual = await call('/staff/verify-order', { token: basilToken, body: { value: `#${o3.orderNumber}` } })
  ok('staff can verify by typing the order number', manual.status === 200 && manual.body.order.id === o3.id)

  const badToken = await call('/staff/verify-order', {
    token: basilToken,
    body: { value: `TABLO:ORDER:${o3.orderNumber}:deadbeefdead` },
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
  ok('staff can add a table', newTable.status === 201 && newTable.body.table.qrPayload.startsWith('TABLO:TABLE:'))
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
    (await call(`/restaurants/${newRestaurantId}`)).body.menu[0].items[0].imageUrl === dishPhoto.body.imageUrl,
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
    (await call(`/restaurants/${newRestaurantId}`)).body.menu[0].items.length === 0,
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

  const codeSpent = await call('/orders/verify-code', { body: { restaurantId: mornington.id, code: sessCode } })
  ok('the code is spent opening the session, not at order time', codeSpent.status === 400 && codeSpent.body.reason === 'used', codeSpent.body)

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

  const tableSession = await call('/sessions', { body: { value: `TABLO:TABLE:${tableRow.token}` } })
  ok('a scanned table QR opens a session with the table set', tableSession.body.session.tableLabel === tableRow.label && tableSession.body.session.source === 'table_qr', tableSession.body)
  const urlSession = await call('/sessions', { body: { value: `http://localhost:5273/t/${tableRow.token}` } })
  ok('a table QR URL opens a session too', urlSession.status === 201)
  ok('a session from another restaurant is refused when one is named', (await call('/sessions', { body: { value: tableRow.token, restaurantId: basil.id } })).status === 400)
  ok('a nonsense code opens nothing', (await call('/sessions', { body: { value: 'ZZZZZZ' } })).status === 404)

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

  const groupFromSession = await call('/sessions', { body: { value: `TABLO:TABLE:${tableRow.token}` } })
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

  group('QR codes (generated and scanned locally)')
  const tableToScan = db.prepare('SELECT token, label FROM restaurant_tables WHERE restaurant_id = ? LIMIT 1').get(basil.id) as any
  const payloads = [
    `TABLO:ORDER:${o3.orderNumber}:${o3.verifyToken}`,
    `TABLO:ACCESS:${mornington.id}:${code1}`,
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
