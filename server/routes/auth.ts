import crypto from 'node:crypto'
import { Router } from 'express'
import { db } from '../db.ts'
import { mailConfigured, sendMail } from '../mail.ts'
import {
  createSession,
  destroySession,
  endAllSessions,
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

/**
 * The sign-in itself: the address it is under and the password that opens it.
 *
 * Kept apart from PATCH /me, which is a form anyone might save by accident.
 * These two are the account, so each needs the current password — an unlocked
 * phone left on a counter should not be enough to lock the owner out of their
 * own restaurant. Changing either ends every other session, because the usual
 * reason to change a password is that someone else knows it.
 */
authRouter.post('/me/credentials', requireAuth, (req, res) => {
  const current = String(req.body?.currentPassword ?? '')
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any
  if (!row || !verifyPassword(current, row.password_hash)) {
    return res.status(403).json({ error: 'That is not your current password.' })
  }

  const wantsEmail = req.body?.email !== undefined
  const wantsPassword = req.body?.newPassword !== undefined

  let email = row.email
  if (wantsEmail) {
    email = String(req.body.email).trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email does not look right.' })
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, row.id) as any
    if (taken) return res.status(409).json({ error: 'Another account already uses that email.' })
  }

  let hash = row.password_hash
  if (wantsPassword) {
    const next = String(req.body.newPassword)
    if (next.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' })
    if (verifyPassword(next, row.password_hash)) {
      return res.status(400).json({ error: 'That is already your password.' })
    }
    hash = hashPassword(next)
  }

  if (!wantsEmail && !wantsPassword) return res.status(400).json({ error: 'Nothing to change.' })

  // Signed back in immediately on this device, so changing a password does not
  // throw the person doing it out of the screen they are standing at.
  const token = db.transaction(() => {
    db.prepare('UPDATE users SET email = ?, password_hash = ? WHERE id = ?').run(email, hash, row.id)
    /*
     * Every other device is signed out, and it has to be done by moving the
     * epoch rather than by emptying the sessions table. A signed token proves
     * itself without a row — that is what lets one survive the database being
     * rebuilt — so deleting rows alone would leave a stolen or borrowed token
     * working after the password it belongs to had been changed.
     */
    if (wantsPassword) endAllSessions(row.id)
    else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id)
    return createSession(row.id)
  })()

  res.json({ token, user: userFromToken(token) })
})

/*
 * Forgotten passwords.
 *
 * A link, emailed to the address on the account, that lets whoever holds that
 * inbox choose a new password once, within half an hour. Only a hash of the
 * link's token is stored, so the table itself cannot be used to reset
 * anybody. Using it signs every device out, exactly as changing a password
 * does, and the reply to "send me a link" is the same whether or not an
 * account exists — the page must not become a way to test which addresses
 * have one.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
`)
const RESET_MINUTES = 30
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex')

authRouter.post('/forgot', (req: any, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' })
  if (!mailConfigured()) {
    return res.status(503).json({ error: 'Password reset by email is not switched on yet. Please contact Khapee.' })
  }
  const sent = { ok: true, message: 'If there is a Khapee account for that email, a reset link is on its way. Check your inbox and spam.' }

  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email) as any
  if (!user) return res.json(sent)

  // Three links an hour per account is plenty for a person and useless for spam.
  const recent = db
    .prepare("SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at >= datetime('now', '-1 hour')")
    .get(user.id) as any
  if (Number(recent.n) >= 3) return res.json(sent)

  const token = crypto.randomBytes(32).toString('base64url')
  db.prepare(
    `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${RESET_MINUTES} minutes'))`,
  ).run(hashToken(token), user.id)

  const origin = (process.env.KHAPEE_ORIGIN || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
  const link = `${origin}/reset?token=${token}`
  void sendMail({
    to: user.email,
    subject: 'Reset your Khapee password',
    text: [
      `Hi ${user.name || 'there'},`,
      '',
      'Someone asked to reset the password for your Khapee account. If it was you, open this link to choose a new one:',
      '',
      link,
      '',
      `The link works once and expires in ${RESET_MINUTES} minutes.`,
      'If you did not ask for this, ignore this email — your password stays the same.',
      '',
      '— Khapee',
    ].join('\n'),
  }).then((r) => {
    if (r !== 'sent') console.warn(`[auth] password reset email to ${user.email}: ${r}`)
  })
  res.json(sent)
})

authRouter.post('/reset', (req, res) => {
  const token = String(req.body?.token ?? '')
  const password = String(req.body?.password ?? '')
  if (!token) return res.status(400).json({ error: 'That reset link is incomplete.' })
  if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' })

  const row = db
    .prepare(
      `SELECT r.*, (r.expires_at <= datetime('now')) AS expired FROM password_resets r WHERE r.token_hash = ?`,
    )
    .get(hashToken(token)) as any
  if (!row || row.used_at) {
    return res.status(400).json({ error: 'That reset link has already been used or is not valid. Ask for a new one.' })
  }
  if (row.expired) return res.status(400).json({ error: 'That reset link has expired. Ask for a new one.' })

  const session = db.transaction(() => {
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(row.token_hash)
    // Any other unused links for this account stop working too.
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(row.user_id)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id)
    endAllSessions(row.user_id)
    return createSession(row.user_id)
  })()
  res.json({ token: session, user: userFromToken(session) })
})
