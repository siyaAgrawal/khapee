import { useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { fileToDataUrl } from '../lib/image'
import { Art, Spinner, useToast } from './ui'

/**
 * Upload / replace / remove a photo. Everything happens against the local API —
 * the file is resized in the browser and stored in this app's data folder.
 */
export default function ImagePicker({
  imageUrl,
  emoji,
  hue,
  uploadPath,
  onChange,
  label = 'Photo',
  aspect = '4 / 3',
}: {
  imageUrl: string | null
  emoji: string
  hue: number
  /** API path that accepts POST { dataUrl } and DELETE. */
  uploadPath: string
  onChange: (imageUrl: string | null) => void
  label?: string
  aspect?: string
}) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await fileToDataUrl(file)
      const r = await api<{ imageUrl: string }>(uploadPath, { body: { dataUrl } })
      onChange(r.imageUrl)
      toast('Photo updated', 'good')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : (e as Error).message, 'bad')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api(uploadPath, { method: 'DELETE' })
      onChange(null)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="image-picker">
      <div className="image-picker-preview" style={{ aspectRatio: aspect }}>
        <Art emoji={emoji} hue={hue} imageUrl={imageUrl} rounded={14} className="image-picker-art" alt={label} />
        {busy && (
          <div className="image-picker-busy">
            <Spinner />
          </div>
        )}
      </div>
      <div className="row row-wrap">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          {imageUrl ? 'Replace photo' : 'Upload photo'}
        </button>
        {imageUrl && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
      <p className="tiny muted">
        Use a photo you own or have permission to use. It is resized here and stored on this
        machine.
      </p>
    </div>
  )
}
