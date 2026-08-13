import { Router } from 'express'
import { db } from '../db.ts'
import { closeSession, sessionByToken, setSessionTable, shapeDiningSession, startSession } from '../dining.ts'

export const sessionsRouter = Router()

/** Opens a dining session from a scanned QR or a typed access code. */
sessionsRouter.post('/', (req, res) => {
  const result = startSession({
    value: String(req.body?.value ?? ''),
    restaurantId: req.body?.restaurantId ? Number(req.body.restaurantId) : null,
    userId: req.user?.id ?? null,
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  res.status(201).json({ session: shapeDiningSession(result.session) })
})

sessionsRouter.get('/:token', (req, res) => {
  const row = sessionByToken(req.params.token)
  if (!row) return res.status(404).json({ error: 'That session has ended.' })
  res.json({ session: shapeDiningSession(row) })
})

/** Sets or changes the table without needing the code again. */
sessionsRouter.post('/:token/table', (req, res) => {
  const result = setSessionTable(req.params.token, Number(req.body?.tableId))
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  res.json({ session: shapeDiningSession(result.session) })
})

sessionsRouter.delete('/:token', (req, res) => {
  closeSession(req.params.token)
  res.json({ ok: true })
})

/** Tables for the session's restaurant, so the picker works from anywhere. */
sessionsRouter.get('/:token/tables', (req, res) => {
  const row = sessionByToken(req.params.token)
  if (!row) return res.status(404).json({ error: 'That session has ended.' })
  const tables = db
    .prepare('SELECT id, label, seats FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id')
    .all(row.restaurant_id)
  res.json({ tables })
})
