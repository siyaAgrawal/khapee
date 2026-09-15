import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { EmptyState, LoadingBlock, Modal, mmss, Spinner, timeAgo, useToast } from '../../components/ui'
import { QRCanvas } from '../../lib/qr'

type Code = {
  id: number
  code: string
  createdAt: string
  expiresAt: string
  secondsLeft: number
  singleUse: boolean
  usedAt: string | null
  revokedAt: string | null
  usedByOrder: string | null
  qrPayload: string
}

export default function StaffCodes() {
  const toast = useToast()
  const [codes, setCodes] = useState<Code[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [minutes, setMinutes] = useState(10)
  const [singleUse, setSingleUse] = useState(true)
  const [showQr, setShowQr] = useState<Code | null>(null)

  const load = useCallback(() => {
    api<{ codes: Code[] }>('/staff/codes')
      .then((r) => setCodes(r.codes))
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])

  // Local tick keeps every countdown honest without hammering the server.
  useEffect(() => {
    const t = setInterval(() => {
      setCodes((prev) => prev?.map((c) => ({ ...c, secondsLeft: Math.max(0, c.secondsLeft - 1) })) ?? null)
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const generate = async () => {
    setBusy(true)
    try {
      const r = await api<{ code: Code }>('/staff/codes', { body: { minutes, singleUse } })
      setCodes((prev) => [r.code, ...(prev ?? [])])
      setShowQr(r.code)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (code: Code) => {
    try {
      await api(`/staff/codes/${code.id}/revoke`, { method: 'POST' })
      load()
      toast(`Code ${code.code} cancelled`, 'info')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  const state = (c: Code) => {
    if (c.revokedAt) return { label: 'Cancelled', tone: 'badge-closed' }
    if (c.singleUse && c.usedAt) return { label: `Used · #${c.usedByOrder ?? ''}`, tone: 'badge' }
    if (c.secondsLeft <= 0) return { label: 'Expired', tone: 'badge-closed' }
    return { label: 'Active', tone: 'badge-open' }
  }

  const active = codes?.find((c) => !c.revokedAt && c.secondsLeft > 0 && !(c.singleUse && c.usedAt))

  return (
    <>
      <div className="staff-head">
        <div className="spacer" />
        <button className="btn btn-accent" onClick={generate} disabled={busy}>
          {busy ? <Spinner /> : 'Generate new code'}
        </button>
      </div>

      <div className="card card-pad mb-2">
        <div className="row row-wrap">
          <label className="tiny muted">Valid for</label>
          <select className="select" style={{ width: 130 }} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
          <label className="row tiny muted" style={{ gap: 8 }}>
            <button
              type="button"
              className={`switch ${singleUse ? 'on' : ''}`}
              onClick={() => setSingleUse((s) => !s)}
              aria-pressed={singleUse}
              aria-label="Single use"
            />
            Single use (invalid once an order is placed)
          </label>
        </div>
      </div>

      {active && (
        <div className="card card-pad mb-2" style={{ textAlign: 'center' }}>
          <p className="tiny muted">Current code</p>
          <div className="code-display">{active.code}</div>
          <p className="muted tiny">
            Expires in <span className="countdown">{mmss(active.secondsLeft)}</span>
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowQr(active)}>
              Generate QR
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => revoke(active)}>
              Cancel code
            </button>
          </div>
        </div>
      )}

      <h2 style={{ margin: '22px 0 10px' }}>Recent codes</h2>
      {!codes ? (
        <LoadingBlock />
      ) : codes.length === 0 ? (
        <EmptyState emoji="🔑" title="No codes yet" body="Generate one when a customer asks to order at their table." />
      ) : (
        codes.map((c) => {
          const s = state(c)
          return (
            <div key={c.id} className={`code-card ${s.label === 'Active' ? '' : 'spent'}`}>
              <span className="mono">{c.code}</span>
              <span className={`badge ${s.tone}`}>{s.label}</span>
              <span className="tiny muted">
                {s.label === 'Active' ? (
                  <>
                    expires in <span className="countdown">{mmss(c.secondsLeft)}</span>
                  </>
                ) : (
                  `created ${timeAgo(c.createdAt)}`
                )}
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-secondary btn-sm" onClick={() => setShowQr(c)}>
                QR
              </button>
              {s.label === 'Active' && (
                <button className="btn btn-ghost btn-sm" onClick={() => revoke(c)}>
                  Cancel
                </button>
              )}
            </div>
          )
        })
      )}

      <Modal open={!!showQr} onClose={() => setShowQr(null)} title="Show this to the customer">
        {showQr && (
          <div className="center">
            <div className="code-display">{showQr.code}</div>
            <p className="tiny muted">
              Expires in <span className="countdown">{mmss(showQr.secondsLeft)}</span>
            </p>
            <div style={{ display: 'grid', placeItems: 'center', margin: '16px 0' }}>
              <QRCanvas value={showQr.qrPayload} size={220} />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
