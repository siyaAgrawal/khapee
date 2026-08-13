import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import { db } from './db.ts'

export type AuthUser = {
  id: number
  name: string
  email: string
  role: 'customer' | 'staff'
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
      `SELECT u.id, u.name, u.email, u.role,
              rs.restaurant_id AS restaurantId, rs.job_title AS jobTitle,
              r.name AS restaurantName
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN restaurant_staff rs ON rs.user_id = u.id
       LEFT JOIN restaurants r ON r.id = rs.restaurant_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as any
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    restaurantId: row.restaurantId ?? null,
    restaurantName: row.restaurantName ?? null,
    jobTitle: row.jobTitle ?? null,
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

export function requireStaff(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' })
  if (req.user.role !== 'staff' || !req.user.restaurantId) {
    return res.status(403).json({ error: 'This area is for restaurant staff only.' })
  }
  next()
}

/** Guards every :restaurantId route param against the staff member's own restaurant. */
export function assertOwnRestaurant(req: Request, restaurantId: number): boolean {
  return !!req.user && req.user.role === 'staff' && req.user.restaurantId === restaurantId
}

export function purgeExpiredSessions() {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run()
}
