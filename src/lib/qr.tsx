import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

/** Renders a QR code entirely in the browser — no network, no image service. */
export function QRCanvas({ value, size = 200, className }: { value: string; size?: number; className?: string }) {
  const [dataUrl, setDataUrl] = useState<string>('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#17120fff', light: '#ffffffff' },
    })
      .then((url) => !cancelled && setDataUrl(url))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [value, size])

  if (failed) return <div className="qr-fallback">Could not draw this QR code.</div>
  return (
    <div className={`qr-frame ${className ?? ''}`} style={{ width: size, height: size }}>
      {dataUrl ? (
        <img src={dataUrl} width={size} height={size} alt={`QR code for ${value}`} />
      ) : (
        <div className="qr-skeleton" />
      )}
    </div>
  )
}

type ScannerState = 'starting' | 'scanning' | 'error'

/** Live camera QR scanner. Callers must always offer manual entry as well. */
export function QRScanner({ onResult, onError }: { onResult: (value: string) => void; onError?: (msg: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [state, setState] = useState<ScannerState>('starting')
  const [message, setMessage] = useState('')
  const resultRef = useRef(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('error')
        const msg = 'This browser cannot open the camera. Enter the code by hand instead.'
        setMessage(msg)
        onError?.(msg)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.setAttribute('playsinline', 'true')
        await video.play()
        setState('scanning')
        tick()
      } catch {
        setState('error')
        const msg = 'Camera access was blocked. Enter the code by hand instead.'
        setMessage(msg)
        onError?.(msg)
      }
    }

    function tick() {
      if (stopped || resultRef.current) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = (canvas.width = video.videoWidth)
        const h = (canvas.height = video.videoHeight)
        if (w && h) {
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h)
            const image = ctx.getImageData(0, 0, w, h)
            const found = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })
            if (found?.data) {
              resultRef.current = true
              onResult(found.data.trim())
              return
            }
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }

    start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onResult, onError])

  return (
    <div className="scanner">
      <div className="scanner-viewport">
        <video ref={videoRef} muted playsInline />
        <canvas ref={canvasRef} hidden />
        <div className="scanner-reticle" aria-hidden />
        {state !== 'scanning' && (
          <div className="scanner-overlay">
            {state === 'starting' ? <span className="spinner" /> : <span className="scanner-error">{message}</span>}
          </div>
        )}
      </div>
      {state === 'scanning' && <p className="scanner-hint">Point the camera at the QR code</p>}
    </div>
  )
}
