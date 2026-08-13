import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { saveGroup } from '../lib/group'
import { readTableContext } from '../lib/table-context'
import { useSession } from '../lib/session'
import { LoadingBlock, Modal, Spinner } from './ui'

type Table = { id: number; label: string; seats: number }

/**
 * Starts a shared table order. Needs the same presence proof as any dine-in
 * order — a scanned table QR, or the staff access code.
 */
export default function StartGroup({
  restaurantId,
  restaurantName,
  open,
  onClose,
}: {
  restaurantId: number
  restaurantName: string
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { user } = useSession()
  const scanned = readTableContext(restaurantId)

  const [name, setName] = useState(user?.name ?? '')
  const [code, setCode] = useState('')
  const [tables, setTables] = useState<Table[] | null>(null)
  const [tableId, setTableId] = useState<number | null>(scanned?.tableId ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    api<{ tables: Table[] }>(`/orders/tables/${restaurantId}`)
      .then((r) => setTables(r.tables))
      .catch(() => setTables([]))
  }, [open, restaurantId])

  useEffect(() => {
    if (user?.name && !name) setName(user.name)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ groupToken: string; session: any }>('/groups', {
        body: {
          restaurantId,
          hostName: name.trim(),
          tableId,
          tableToken: scanned?.tableToken ?? null,
          accessCode: code.trim() || null,
        },
      })
      saveGroup({ token: r.groupToken, code: r.session.code, restaurantId })
      navigate('/group')
    } catch (e) {
      setError((e as ApiError).message)
      setBusy(false)
    }
  }

  const canStart = name.trim().length >= 2 && !!tableId && (!!scanned || code.trim().length === 6)

  return (
    <Modal open={open} onClose={onClose} title="Start a group order">
      <p className="tiny muted mb-2">
        One table, one bill, everyone orders for themselves at {restaurantName}.
      </p>

      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label htmlFor="sg-name">Your name</label>
        <input
          id="sg-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Siya"
        />
      </div>

      {scanned ? (
        <div className="verified-banner">
          <span>✓</span> {scanned.tableLabel} confirmed by QR
        </div>
      ) : (
        <div className="field">
          <label htmlFor="sg-code">Restaurant access code</label>
          <input
            id="sg-code"
            className="input input-code"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="K7X92P"
          />
          <span className="hint">Ask a staff member for today&rsquo;s code.</span>
        </div>
      )}

      <div className="field">
        <label>Table</label>
        {!tables ? (
          <LoadingBlock />
        ) : (
          <div className="table-grid">
            {tables.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`table-btn ${tableId === t.id ? 'selected' : ''}`}
                onClick={() => setTableId(t.id)}
              >
                <strong>{t.label}</strong>
                <span>{t.seats} seats</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-accent btn-lg btn-block" disabled={!canStart || busy} onClick={start}>
        {busy ? <Spinner /> : 'Start group'}
      </button>
    </Modal>
  )
}
