import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import { db, DB_PATH } from './db.ts'

export type StaffedRestaurant = { id: number; name: string; emoji: string; jobTitle: string }

export type AuthUser = {
  id: number
  name: string
  email: string
  phone: string
  memberSince: string
  role: 'customer' | 'staff'
  /** Every restaurant this account runs. Empty for a pure customer. */
  restaurants: StaffedRestaurant[]
  /** The one the dashboard is currently showing. */
  restaurantId: number | null
  restaurantName: string | null
  jobTitle: string | null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

const SESSION_DAYS = 30

/**
 * Why a signed token rather than only a row in `sessions`.
 *
 * On the free plan the container has no disk: every time the site sleeps and
 * wakes, the database is rebuilt from the committed snapshot — which ships no
 * sessions, deliberately, because live login tokens have no business in git.
 * So every login died roughly fifteen minutes after the last visitor left, and
 * a restaurant that opened the dashboard twice in a morning signed in twice.
 *
 * A token that carries its own proof survives that. The signature covers the
 * account's current password hash, so changing the password still invalidates
 * every token ever issued to it — which is what the Sign in card promises —
 * and a signing key that outlives the process keeps the rest valid.
 */
const SECRET = (() => {
  if (process.env.KHAPEE_SECRET) return process.env.KHAPEE_SECRET
  // Development has a real disk, so keep a key beside the database rather than
  // making a new one each restart and signing everybody out locally too.
  try {
    const file = path.join(path.dirname(DB_PATH), '.session-secret')
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
    const made = crypto.randomBytes(32).toString('hex')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, made, { mode: 0o600 })
    return made
  } catch {
    // Nowhere to keep one. Tokens then last only as long as this process,
    // which is the behaviour we had before.
    return crypto.randomBytes(32).toString('hex')
  }
})()

/** Ties a token to one account, one expiry, and that account's password. */
function signature(userId: number, expiresMs: number, passwordHash: string): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${userId}.${expiresMs}.${passwordHash}`)
    .digest('base64url')
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10)
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash)
  } catch {
    return false
  }
}

export function createSession(userId: number): string {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any
  if (!row) throw new Error(`No user ${userId} to open a session for`)
  const expiresMs = Date.now() + SESSION_DAYS * 86_400_000
  const token = `v1.${userId}.${expiresMs}.${signature(userId, expiresMs, row.password_hash)}`

  // Still recorded. The row is what lets a signed-out token be turned away
  // while this process is alive, and what purgeExpiredSessions tidies up.
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
  ).run(token, userId)
  return token
}

export function destroySession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  // A signed token proves itself without the row, so signing out has to be
  // written down rather than simply forgotten.
  db.prepare(`INSERT OR IGNORE INTO revoked_tokens (token) VALUES (?)`).run(token)
}

/** Reads a signed token, or nothing if it was not one or does not hold up. */
function verifySigned(token: string): number | null {
  const parts = token.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') return null
  const userId = Number(parts[1])
  const expiresMs = Number(parts[2])
  if (!Number.isInteger(userId) || !Number.isFinite(expiresMs)) return null
  if (Date.now() > expiresMs) return null

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any
  if (!row) return null

  const expected = signature(userId, expiresMs, row.password_hash)
  const a = Buffer.from(expected)
  const b = Buffer.from(parts[3])
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  if (db.prepare('SELECT 1 FROM revoked_tokens WHERE token = ?').get(token)) return null
  return userId
}

const USER_FIELDS = 'u.id, u.name, u.email, u.phone, u.created_at, u.role, u.active_restaurant_id'

export function userFromToken(token: string | undefined): AuthUser | null {
  if (!token) return null

  // A signed token stands on its own, so it still works after the database has
  // been rebuilt from the snapshot and the sessions table is empty again.
  const signedFor = verifySigned(token)
  if (signedFor != null) return userById(signedFor)

  // Tokens handed out before signing existed, still good until they expire.
  const row = db
    .prepare(
      `SELECT ${USER_FIELDS}
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as any
  if (!row) return null
  return shapeUser(row)
}

/** The same account, read straight rather than through a session token. */
export function userById(id: number): AuthUser | null {
  const row = db.prepare(`SELECT ${USER_FIELDS} FROM users u WHERE u.id = ?`).get(id) as any
  return row ? shapeUser(row) : null
}

function shapeUser(row: any): AuthUser {

  const restaurants = db
    .prepare(
      `SELECT r.id, r.name, r.emoji, rs.job_title AS jobTitle
       FROM restaurant_staff rs JOIN restaurants r ON r.id = rs.restaurant_id
       WHERE rs.user_id = ? ORDER BY r.name`,
    )
    .all(row.id) as StaffedRestaurant[]

  // Fall back to the first restaurant if the remembered one has gone away.
  const active =
    restaurants.find((r) => r.id === row.active_restaurant_id) ?? restaurants[0] ?? null

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? '',
    memberSince: row.created_at,
    role: row.role,
    restaurants,
    restaurantId: active?.id ?? null,
    restaurantName: active?.name ?? null,
    jobTitle: active?.jobTitle ?? null,
  }
}

function tokenFrom(req: Request): string | undefined {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim()
  const q = req.query.token
  if (typeof q === 'string' && q) return q
  return undefined
}

/** Attaches req.user when a valid session token is present. Never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.user = userFromToken(tokenFrom(req)) ?? undefined
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' })
  next()
}

/** Access follows restaurant membership, not the account's original role. */
export function requireStaff(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' })
  if (!req.user.restaurants.length || !req.user.restaurantId) {
    return res.status(403).json({ error: 'This area is for restaurant owners and staff.' })
  }
  next()
}

/** Guards every :restaurantId route param against the staff member's own restaurant. */
export function assertOwnRestaurant(req: Request, restaurantId: number): boolean {
  return !!req.user && req.user.restaurants.some((r) => r.id === restaurantId)
}

/** Moves the dashboard to another restaurant this account runs. */
export function setActiveRestaurant(userId: number, restaurantId: number): boolean {
  const owns = db
    .prepare('SELECT 1 FROM restaurant_staff WHERE user_id = ? AND restaurant_id = ?')
    .get(userId, restaurantId)
  if (!owns) return false
  db.prepare('UPDATE users SET active_restaurant_id = ? WHERE id = ?').run(restaurantId, userId)
  return true
}

export function purgeExpiredSessions() {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run()
}
