import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { EmptyState, LoadingBlock, Modal, Spinner, useToast } from '../../components/ui'
import { QRCanvas } from '../../lib/qr'

type Zone = { id: number; name: string; note: string; token: string; isActive: boolean; qrPayload: string }

/**
 * Where the restaurant says its outside is.
 *
 * Deliberately coarse — a name and a note, no map and no coordinates. Staff
 * need to know roughly where to walk, and anything more precise is work for the
 * restaurant to maintain and nobody to use.
 */
export default function StaffZones() {
  const toast = useToast()
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState<Zone | null>(null)

  const load = useCallback(() => {
    api<{ zones: Zone[] }>('/staff/zones')
      .then((r) => setZones(r.zones))
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])

  const add = async () => {
    setBusy(true)
    try {
      await api('/staff/zones', { body: { name: name.trim(), note: note.trim() } })
      setName('')
      setNote('')
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (z: Zone) => {
    try {
      await api(`/staff/zones/${z.id}`, { method: 'DELETE' })
      toast(`${z.name} removed`, 'info')
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  return (
    <>
      <div className="staff-head">
        <h1>Roadside zones</h1>
      </div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 16 }}>
        The areas outside where customers park. Staff see these on the floor board.
      </p>

      <div className="card card-pad mb-2">
        <div className="row row-wrap">
          <input
            className="input"
            style={{ flex: '1 1 140px' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Zone A"
            maxLength={40}
          />
          <input
            className="input"
            style={{ flex: '2 1 220px' }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Directly outside the restaurant"
            maxLength={80}
          />
          <button className="btn btn-accent" disabled={busy || !name.trim()} onClick={add}>
            {busy ? <Spinner /> : 'Add zone'}
          </button>
        </div>
      </div>

      {!zones ? (
        <LoadingBlock />
      ) : zones.length === 0 ? (
        <EmptyState
          emoji="🚗"
          title="No zones yet"
          body="Add one for each area outside — directly outside, opposite side, further down."
        />
      ) : (
        zones.map((z) => (
          <div key={z.id} className="code-card">
            <span className="mono">{z.name}</span>
            <span className="tiny muted">{z.note}</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-secondary btn-sm" onClick={() => setQr(z)}>
              Sign QR
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => remove(z)}>
              Remove
            </button>
          </div>
        ))
      )}

      <Modal open={!!qr} onClose={() => setQr(null)} title={qr ? `${qr.name} sign` : ''}>
        {qr && (
          <div className="center">
            <p className="tiny muted">Print this and put it where the cars park.</p>
            <div style={{ display: 'grid', placeItems: 'center', margin: '16px 0' }}>
              <QRCanvas value={qr.qrPayload} size={220} />
            </div>
            <p className="tiny muted">Scanning it starts an order already set to {qr.name}.</p>
          </div>
        )}
      </Modal>
    </>
  )
}
