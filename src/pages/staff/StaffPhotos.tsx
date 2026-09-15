import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { EmptyState, LoadingBlock, useToast } from '../../components/ui'

type Photo = { id: number; url: string; assignedItemId: number | null; assignedName: string | null }
type Item = { id: number; name: string; section: string; hasPhoto: boolean }

/**
 * Photos arrive in bulk with no usable filenames, so pairing them with dishes
 * is done by eye here: pick the dish under each picture and it goes live.
 */
export default function StaffPhotos() {
  const toast = useToast()
  const [data, setData] = useState<{ photos: Photo[]; items: Item[] } | null>(null)
  const [filter, setFilter] = useState<'todo' | 'done' | 'all'>('todo')
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    api<{ photos: Photo[]; items: Item[] }>('/staff/photos')
      .then(setData)
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])

  const assign = async (photo: Photo, itemId: number | null) => {
    setBusyId(photo.id)
    try {
      const r = await api<{ itemName?: string }>(`/staff/photos/${photo.id}/assign`, { body: { itemId } })
      setData((prev) =>
        prev
          ? {
              items: prev.items.map((i) =>
                i.id === itemId ? { ...i, hasPhoto: true } : i,
              ),
              photos: prev.photos.map((p) =>
                p.id === photo.id
                  ? { ...p, assignedItemId: itemId, assignedName: r.itemName ?? null }
                  : // one photo per dish — release any other holding it
                    p.assignedItemId === itemId
                    ? { ...p, assignedItemId: null, assignedName: null }
                    : p,
              ),
            }
          : prev,
      )
      if (itemId) toast(`Photo set for ${r.itemName}`, 'good')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (photo: Photo) => {
    if (!window.confirm('Delete this photo from your library?')) return
    setBusyId(photo.id)
    try {
      await api(`/staff/photos/${photo.id}`, { method: 'DELETE' })
      setData((prev) => (prev ? { ...prev, photos: prev.photos.filter((p) => p.id !== photo.id) } : prev))
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  const visible = useMemo(() => {
    if (!data) return []
    if (filter === 'todo') return data.photos.filter((p) => !p.assignedItemId)
    if (filter === 'done') return data.photos.filter((p) => p.assignedItemId)
    return data.photos
  }, [data, filter])

  if (!data) return <LoadingBlock label="Loading your photos…" />

  const assigned = data.photos.filter((p) => p.assignedItemId).length
  const withPhoto = data.items.filter((i) => i.hasPhoto).length

  /** Dishes grouped by section for the picker. */
  const grouped = data.items.reduce<Record<string, Item[]>>((acc, i) => {
    ;(acc[i.section] ??= []).push(i)
    return acc
  }, {})

  return (
    <>
      <div className="staff-head">
        <span className="badge">{assigned}/{data.photos.length} placed</span>
        <div className="spacer" />
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['todo', 'done', 'all'] as const).map((f) => (
            <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'todo' ? 'To place' : f === 'done' ? 'Placed' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <p className="tiny muted mb-2">
        {withPhoto} of {data.items.length} dishes have a photo. Pick the dish under each picture —
        it goes live on the menu straight away.
      </p>

      {visible.length === 0 ? (
        <EmptyState
          emoji="📷"
          title={filter === 'todo' ? 'Every photo is placed' : 'Nothing here'}
          body={
            filter === 'todo'
              ? 'Switch to “Placed” to change any of them.'
              : 'Upload photos from a dish, or import a folder.'
          }
        />
      ) : (
        <div className="photo-grid">
          {visible.map((photo) => (
            <figure key={photo.id} className={`photo-cell ${photo.assignedItemId ? 'is-placed' : ''}`}>
              <img src={photo.url} alt={photo.assignedName ?? 'Unassigned dish photo'} loading="lazy" />
              <figcaption>
                <select
                  className="select"
                  value={photo.assignedItemId ?? ''}
                  disabled={busyId === photo.id}
                  onChange={(e) => assign(photo, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— pick a dish —</option>
                  {Object.entries(grouped).map(([section, items]) => (
                    <optgroup key={section} label={section}>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.hasPhoto && i.id !== photo.assignedItemId ? '• ' : ''}
                          {i.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busyId === photo.id}
                  onClick={() => remove(photo)}
                  aria-label="Delete photo"
                >
                  Delete
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </>
  )
}
