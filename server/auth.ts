import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import { db } from './db.ts'

export type StaffedRestaurant = { id: number; name: string; emoji: string; jobTitle: string }

export type AuthUser = {
  id: number
  name: string
  email: string
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
  const token = crypto.randomBytes(32).toString('hex')
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
  ).run(token, userId)
  return token
}

export function destroySession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function userFromToken(token: string | undefined): AuthUser | null {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active_restaurant_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as any
  if (!row) return null

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
