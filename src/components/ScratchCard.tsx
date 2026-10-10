import { useEffect, useRef, useState } from 'react'

/**
 * A card you actually rub.
 *
 * The prize underneath was decided by the server when the order was placed and
 * is already sitting in the page — nothing is being revealed by the scratching
 * except to the person doing it. That is deliberate: a card that asks the
 * server what it won at the moment of rubbing shows a spinner in the middle of
 * the one second that is supposed to be fun.
 *
 * The foil is a canvas drawn over the prize and erased under the finger. Once
 * enough of it is gone the rest fades out by itself, because nobody enjoys
 * hunting the last few flecks, and the reveal is told to the server then.
 *
 * Anyone who cannot drag — a keyboard, a screen reader, a reduced-motion
 * setting — gets a button that does the same thing. The prize is theirs
 * either way; the scratching is decoration, and decoration is never the only
 * way through.
 */
export default function ScratchCard({
  label,
  caption,
  onScratched,
}: {
  /** What it says underneath: "₹20 off", "10% off". */
  label: string
  /** The line under the prize, about where it can be spent. */
  caption: string
  onScratched: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [open, setOpen] = useState(false)
  const openedRef = useRef(false)
  const drawing = useRef(false)

  /** Rubbed far enough to stop making them work for it. */
  const ENOUGH = 0.42

  const reveal = () => {
    if (openedRef.current) return
    openedRef.current = true
    setOpen(true)
    onScratched()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    // Drawn at the device's own resolution: a foil at CSS pixels on a phone is
    // visibly soft next to the type underneath it.
    const ratio = Math.min(window.devicePixelRatio || 1, 3)
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    ctx.scale(ratio, ratio)

    // Brushed foil, so it reads as something to rub rather than a grey box.
    const foil = ctx.createLinearGradient(0, 0, rect.width, rect.height)
    foil.addColorStop(0, '#cfd4d1')
    foil.addColorStop(0.35, '#9aa29d')
    foil.addColorStop(0.55, '#e6e9e5')
    foil.addColorStop(1, '#8e968f')
    ctx.fillStyle = foil
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    for (let x = -rect.height; x < rect.width; x += 7) {
      ctx.fillRect(x, 0, 2, rect.height)
    }
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = 'rgba(0,0,0,1)'
    ctx.fillStyle = 'rgba(0,0,0,1)'

    const pointAt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    /** How much of the foil is gone, sampled rather than counted in full. */
    const cleared = () => {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let clear = 0
      let seen = 0
      // Every 32nd pixel: enough to know, cheap enough to run on a drag.
      for (let i = 3; i < data.length; i += 4 * 32) {
        seen++
        if (data[i] < 24) clear++
      }
      return seen ? clear / seen : 0
    }

    /*
     * The line between two points, not the points.
     *
     * A pointer that moves fast reports a handful of positions across the
     * whole card, so rubbing only where it was heard leaves a row of dots
     * with foil between them — which is what this did at first. Joining each
     * position to the last one draws the stroke somebody actually made.
     */
    let last: { x: number; y: number } | null = null
    const stroke = (to: { x: number; y: number }) => {
      ctx.lineWidth = 44
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      if (last) {
        ctx.moveTo(last.x, last.y)
        ctx.lineTo(to.x, to.y)
        ctx.stroke()
      }
      ctx.arc(to.x, to.y, 22, 0, Math.PI * 2)
      ctx.fill()
      last = to
    }

    const down = (e: PointerEvent) => {
      drawing.current = true
      last = null
      // Captured so the stroke survives the finger leaving the card — without
      // it a drag off the edge ends the stroke and the card sits half rubbed.
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* some browsers refuse on a mouse; the listeners still work */
      }
      stroke(pointAt(e))
    }
    const move = (e: PointerEvent) => {
      if (!drawing.current) return
      e.preventDefault()
      stroke(pointAt(e))
      // Checked as they go rather than when they stop: a real card gives way
      // under the finger, and waiting for them to lift it feels like a form.
      if (cleared() >= ENOUGH) {
        drawing.current = false
        reveal()
      }
    }
    const up = () => {
      drawing.current = false
      last = null
      if (cleared() >= ENOUGH) reveal()
    }

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`scratch ${open ? 'is-open' : ''}`}>
      <div className="scratch-prize">
        <span className="scratch-won">You won</span>
        <strong className="scratch-label">{label}</strong>
        <span className="scratch-caption">{caption}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="scratch-foil"
        aria-hidden
        /* The browser's own drag and scroll would fight the finger. */
        style={{ touchAction: 'none' }}
      />
      {!open && (
        <span className="scratch-hint" aria-hidden>
          Scratch to reveal
        </span>
      )}
      {/* The way through for anyone not dragging a finger across glass. */}
      {!open && (
        <button type="button" className="scratch-skip" onClick={reveal}>
          Reveal my prize
        </button>
      )}
    </div>
  )
}
