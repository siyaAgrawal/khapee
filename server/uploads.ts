import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BACKED_UP, db, UPLOAD_DIR } from './db.ts'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const MAX_BYTES = 5 * 1024 * 1024

export type SaveResult = { ok: true; file: string } | { ok: false; error: string }

/**
 * Stores a browser-supplied data URL on disk. Images never leave this machine —
 * the client downsizes them first, and we only accept a short allow-list of types.
 */
export function saveDataUrl(dataUrl: unknown): SaveResult {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return { ok: false, error: 'Please choose an image file.' }
  }
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/)
  if (!match) return { ok: false, error: 'That image could not be read.' }

  const mime = match[1].toLowerCase()
  const ext = MIME_EXT[mime]
  if (!ext) return { ok: false, error: 'Use a JPG, PNG, WEBP or GIF image.' }

  let buffer: Buffer
  try {
    buffer = Buffer.from(match[2], 'base64')
  } catch {
    return { ok: false, error: 'That image could not be read.' }
  }
  if (!buffer.length) return { ok: false, error: 'That image is empty.' }
  if (buffer.length > MAX_BYTES) return { ok: false, error: 'Images must be under 5 MB.' }

  const file = `${crypto.randomBytes(10).toString('hex')}.${ext}`
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buffer)
  // The uploads folder does not survive a restart on the host; the database,
  // being backed up, does. See upload_files in db.ts.
  if (BACKED_UP) db.prepare('INSERT OR REPLACE INTO upload_files (name, data) VALUES (?, ?)').run(file, buffer)
  return { ok: true, file }
}

/** Best-effort cleanup so replaced photos do not pile up on disk. */
export function deleteUpload(file: string | null | undefined) {
  if (!file) return
  const safe = path.basename(file)
  if (BACKED_UP) db.prepare('DELETE FROM upload_files WHERE name = ?').run(safe)
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, safe))
  } catch {
    /* already gone */
  }
}

export function imageUrl(file: string | null | undefined): string | null {
  return file ? `/api/uploads/${path.basename(file)}` : null
}
