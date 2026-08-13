import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { EmptyState, LoadingBlock, Modal, Spinner, useToast } from '../../components/ui'
import { QRCanvas } from '../../lib/qr'

type Table = { id: number; label: string; seats: number; token: string; activeOrders: number; qrPayload: string }

export default function StaffTables() {
  const toast = useToast()
  const [tables, setTables] = useState<Table[] | null>(null)
  const [label, setLabel] = useState('')
  const [seats, setSeats] = useState(4)
  const [busy, setBusy] = useState(false)
  const [qrFor, setQrFor] = useState<Table | null>(null)
  const [baseUrl, setBaseUrl] = useState(window.location.origin)
  const [baseChoices, setBaseChoices] = useState<string[]>([window.location.origin])

  const load = useCallback(() => {
    api<{ tables: Table[] }>('/staff/tables')
      .then((r) => setTables(r.tables))
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])

  // A QR printed from localhost is dead on a customer's phone, so offer the
  // addresses this machine is actually reachable on.
  useEffect(() => {
    api<{ localUrl: string; networkUrls: string[] }>('/network')
      .then((r) => {
        const choices = [...new Set([...r.networkUrls, r.localUrl, window.location.origin])]
        setBaseChoices(choices)
        setBaseUrl((current) =>
          current.includes('localhost') && r.networkUrls.length ? r.networkUrls[0] : current,
        )
      })
      .catch(() => {})
  }, [])

  const addTable = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/staff/tables', { body: { label: label.trim(), seats } })
      setLabel('')
      load()
      toast('Table added', 'good')
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const removeTable = async (t: Table) => {
    if (t.activeOrders > 0) {
      toast(`${t.label} still has an open order.`, 'bad')
      return
    }
    try {
      await api(`/staff/tables/${t.id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    }
  }

  const tableUrl = (t: Table) => `${baseUrl}/t/${t.token}`

  return (
    <>
      <div className="staff-head">
        <h1>Tables</h1>
      </div>

      <form className="card card-pad mb-2" onSubmit={addTable}>
        <div className="row row-wrap">
          <input
            className="input"
            style={{ maxWidth: 200 }}
            placeholder="Table 7"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Table name"
          />
          <select className="select" style={{ width: 120 }} value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
            {[2, 4, 6, 8, 10].map((s) => (
              <option key={s} value={s}>
                {s} seats
              </option>
            ))}
          </select>
          <button className="btn btn-accent" disabled={busy || !label.trim()}>
            {busy ? <Spinner /> : 'Add table'}
          </button>
        </div>
        <p className="tiny muted mt-3">
          Each table gets its own QR. A customer who scans it lands on your menu with the table already set — no code
          needed.
        </p>
        {baseChoices.length > 1 && (
          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label htmlFor="qr-base">Address printed on the QR</label>
            <select id="qr-base" className="select" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}>
              {baseChoices.map((url) => (
                <option key={url} value={url}>
                  {url}
                  {url.includes('localhost') ? ' — this computer only' : ' — phones on your Wi-Fi'}
                </option>
              ))}
            </select>
            <span className="hint">
              Pick the Wi-Fi address so a customer&rsquo;s phone can open it. A localhost QR only works here.
            </span>
          </div>
        )}
      </form>

      {!tables ? (
        <LoadingBlock />
      ) : tables.length === 0 ? (
        <EmptyState emoji="🪑" title="No tables yet" body="Add your first table above." />
      ) : (
        <div className="table-manage">
          {tables.map((t) => (
            <div key={t.id} className="table-card">
              <strong>{t.label}</strong>
              <span className="tiny muted">{t.seats} seats</span>
              <div style={{ display: 'grid', placeItems: 'center' }}>
                <QRCanvas value={tableUrl(t)} size={104} />
              </div>
              {t.activeOrders > 0 ? (
                <span className="badge badge-accent">{t.activeOrders} open</span>
              ) : (
                <span className="badge">Free</span>
              )}
              <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setQrFor(t)}>
                  Enlarge
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => removeTable(t)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!qrFor} onClose={() => setQrFor(null)} title={qrFor?.label ?? 'Table'}>
        {qrFor && (
          <div className="center">
            <div style={{ display: 'grid', placeItems: 'center', margin: '8px 0 14px' }}>
              <QRCanvas value={tableUrl(qrFor)} size={250} />
            </div>
            <p className="tiny muted">Print this and put it on {qrFor.label}.</p>
            <p className="tiny mono muted" style={{ marginTop: 6, wordBreak: 'break-all' }}>
              {tableUrl(qrFor)}
            </p>
          </div>
        )}
      </Modal>
    </>
  )
}
