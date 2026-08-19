import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/* ------------------------------------------------------------------ toasts */

type Toast = { id: number; message: string; tone: 'good' | 'bad' | 'info' }
const ToastContext = createContext<{ push: (message: string, tone?: Toast['tone']) => void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span className="toast-dot" />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx.push
}

/* ------------------------------------------------------------------- state */

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-block">
      <Spinner />
      <p>{label}</p>
    </div>
  )
}

export function EmptyState({
  emoji = '🍽️',
  title,
  body,
  action,
}: {
  emoji?: string
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="state-block">
      <div className="state-emoji" aria-hidden>
        {emoji}
      </div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block state-error">
      <div className="state-emoji" aria-hidden>
        ⚠️
      </div>
      <h3>Something went wrong</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className ?? ''}`} style={style} />
}

/* --------------------------------------------------------------- food art */

/** Locally generated artwork — a deterministic gradient tile with the dish glyph. */
export function Art({
  emoji,
  hue,
  className,
  rounded = 18,
  imageUrl,
  alt,
}: {
  emoji: string
  hue: number
  className?: string
  rounded?: number
  /** An uploaded photo takes over when the restaurant has provided one. */
  imageUrl?: string | null
  alt?: string
}) {
  const [broken, setBroken] = useState(false)
  // A tall photo in a wide frame loses its subject to the crop — a drink ends up
  // as a slice of glass with no rim and no base. Those are shown whole instead,
  // against a blurred copy of themselves so the frame still fills.
  const [portrait, setPortrait] = useState(false)
  const style = {
    '--art-hue': String(hue),
    borderRadius: rounded,
  } as React.CSSProperties

  if (imageUrl && !broken) {
    return (
      <div
        className={`art art-photo ${portrait ? 'art-portrait' : ''} ${className ?? ''}`}
        style={style}
      >
        <img
          src={imageUrl}
          alt={alt ?? ''}
          loading="lazy"
          onError={() => setBroken(true)}
          onLoad={(e) => {
            const img = e.currentTarget
            if (img.naturalWidth && img.naturalHeight / img.naturalWidth > 1.15) setPortrait(true)
          }}
        />
      </div>
    )
  }
  return (
    <div className={`art ${className ?? ''}`} style={style} aria-hidden>
      <span className="art-glyph">{emoji}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  // Rendered on the body: a sheet opened from inside the header would otherwise
  // be positioned against it, since backdrop-filter makes a containing block.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ misc */

export function money(cents: number): string {
  return '₹' + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}

export function timeAgo(iso: string): string {
  const then = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 45) return 'just now'
  if (seconds < 90) return '1 min ago'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function clockTime(iso: string): string {
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(then.getTime())) return ''
  return then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
