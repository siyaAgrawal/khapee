import crypto from 'node:crypto'
import { db } from './db.ts'

/** Unambiguous alphabet: no 0/O, 1/I/L, so codes read cleanly off a screen. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ'

function pick(alphabet: string, length: number): string {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

/** Six-character restaurant access code, e.g. K7X92P. Unique across the table. */
export function generateAccessCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = pick(CODE_ALPHABET, 6)
    const clash = db.prepare('SELECT 1 FROM access_codes WHERE code = ?').get(code)
    if (!clash) return code
  }
  throw new Error('Could not generate a unique access code')
}

/** Order number like #A482 — stored without the leading hash. */
export function generateOrderNumber(): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const number = pick(LETTERS, 1) + pick('0123456789', 3)
    const clash = db.prepare('SELECT 1 FROM orders WHERE order_number = ?').get(number)
    if (!clash) return number
  }
  // Fallback keeps ordering possible even if the 4-char space fills up.
  return pick(LETTERS, 2) + pick('0123456789', 3)
}

export function randomToken(bytes = 12): string {
  return crypto.randomBytes(bytes).toString('hex')
}

export function tableToken(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const token = randomToken(8)
    const clash = db.prepare('SELECT 1 FROM restaurant_tables WHERE token = ?').get(token)
    if (!clash) return token
  }
  throw new Error('Could not generate a unique table token')
}

export function normalizeCode(input: unknown): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}
