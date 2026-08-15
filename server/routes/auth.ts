import { Router } from 'express'
import { db } from '../db.ts'
import {
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  userById,
  userFromToken,
  verifyPassword,
} from '../auth.ts'
import { tableToken } from '../ids.ts'

export const authRouter = Router()

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

authRouter.post('/register', (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' })
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' })

  const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)
  if (existing) return res.status(409).json({ error: 'An account with that email already exists.' })

  const info = db
    .prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'customer')`)
    .run(name, email, hashPassword(password))

  const token = createSession(Number(info.lastInsertRowid))
  res.status(201).json({ token, user: userFromToken(token) })
})

/**
 * Creates a restaurant. Signed in, it is added to the account you already have
 * — a customer stays a customer and simply gains a dashboard, and an existing
 * owner can run as many restaurants as they like. Signed out, it also creates
 * the account.
 */
authRouter.post('/register-restaurant', (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const restaurantName = String(req.body?.restaurantName ?? '').trim()
  const address = String(req.body?.address ?? '').trim().slice(0, 200)
  const categoriesInput = req.body?.categories
  const tableCount = Math.max(0, Math.min(40, Math.round(Number(req.body?.tables) || 6)))

  const existingUser = req.user
  if (restaurantName.length < 2) return res.status(400).json({ error: 'Please enter your restaurant name.' })

  if (!existingUser) {
    if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' })
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' })
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' })
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'An account with that email already exists. Sign in first to add a restaurant to it.' })
    }
  }

  const duplicate = db
    .prepare(
      `SELECT 1 FROM restaurant_staff rs JOIN restaurants r ON r.id = rs.restaurant_id
       WHERE rs.user_id = ? AND lower(r.name) = lower(?)`,
    )
    .get(existingUser?.id ?? -1, restaurantName)
  if (duplicate) {
    return res.status(409).json({ error: `You already have a restaurant called ${restaurantName}.` })
  }

  const baseSlug =
    restaurantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'restaurant'
  let slug = baseSlug
  for (let n = 2; db.prepare('SELECT 1 FROM restaurants WHERE slug = ?').get(slug); n++) {
    slug = `${baseSlug}-${n}`
  }

  const categories = (Array.isArray(categoriesInput) ? categoriesInput : String(categoriesInput ?? '').split(','))
    .map((c: unknown) => String(c).trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(', ')

  const result = db.transaction(() => {
    const userId =
      existingUser?.id ??
      Number(
        db
          .prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'staff')`)
          .run(name, email, hashPassword(password)).lastInsertRowid,
      )
    const restaurantInfo = db
      .prepare(
        `INSERT INTO restaurants (slug, name, description, address, categories, emoji, hue, is_open, hours, prep_minutes, rating)
         VALUES (?, ?, '', ?, ?, '🍽️', ?, 0, '9:00 AM – 11:00 PM', 20, 0)`,
      )
      .run(slug, restaurantName, address, categories, 200 + (restaurantName.length * 37) % 160)
    const restaurantId = Number(restaurantInfo.lastInsertRowid)

    db.prepare('INSERT INTO restaurant_staff (user_id, restaurant_id, job_title) VALUES (?, ?, ?)').run(
      userId,
      restaurantId,
      'Owner',
    )
    // Land on the restaurant just created.
    db.prepare('UPDATE users SET active_restaurant_id = ? WHERE id = ?').run(restaurantId, userId)
    for (let t = 1; t <= tableCount; t++) {
      db.prepare('INSERT INTO restaurant_tables (restaurant_id, label, seats, token) VALUES (?, ?, 4, ?)').run(
        restaurantId,
        `Table ${t}`,
        tableToken(),
      )
    }
    return { userId, restaurantId }
  })()

  // Signed in already? Keep the session; otherwise start one.
  if (existingUser) {
    return res.status(201).json({ user: userFromToken(tokenOf(req)!), restaurantId: result.restaurantId })
  }
  const token = createSession(result.userId)
  res.status(201).json({ token, user: userFromToken(token), restaurantId: result.restaurantId })
})

function tokenOf(req: any): string | undefined {
  const header = req.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined
}

authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' })
  }
  const token = createSession(user.id)
  res.json({ token, user: userFromToken(token) })
})

authRouter.post('/logout', (req, res) => {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) destroySession(header.slice(7).trim())
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

/** The handful of things an account holder can change about themselves. */
authRouter.patch('/me', requireAuth, (req, res) => {
  const updates: Record<string, unknown> = {}
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim().slice(0, 80)
    if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' })
    updates.name = name
  }
  if (req.body?.phone !== undefined) updates.phone = String(req.body.phone).trim().slice(0, 30)

  const keys = Object.keys(updates)
  if (keys.length) {
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...keys.map((k) => updates[k]),
      req.user!.id,
    )
  }
  res.json({ user: userById(req.user!.id) })
})
