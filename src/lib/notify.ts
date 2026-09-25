/**
 * New-order alerts for staff. Everything here is local to the browser — the
 * Notification API and a synthesised chime, no push service and nothing sent
 * anywhere.
 */
const SEEN = 'khapee.notified'

export function canNotify(): boolean {
  return typeof Notification !== 'undefined'
}

export function notifyPermission(): NotificationPermission | 'unsupported' {
  return canNotify() ? Notification.permission : 'unsupported'
}

export async function askToNotify(): Promise<boolean> {
  if (!canNotify()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

/** A short two-tone chime, generated rather than loaded from a file. */
export function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const play = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + dur + 0.02)
    }
    play(880, 0, 0.18)
    play(1320, 0.16, 0.26)
    setTimeout(() => ctx.close(), 900)
  } catch {
    /* audio blocked until the page is interacted with — the toast still shows */
  }
}

/** Fires once per order, even if several tabs are open. */
export function announceOrder(orderNumber: string, body: string) {
  let seen: string[] = []
  try {
    seen = JSON.parse(sessionStorage.getItem(SEEN) || '[]')
  } catch {
    seen = []
  }
  if (seen.includes(orderNumber)) return
  seen.push(orderNumber)
  try {
    sessionStorage.setItem(SEEN, JSON.stringify(seen.slice(-80)))
  } catch {
    /* ignore */
  }

  chime()
  if (canNotify() && Notification.permission === 'granted') {
    try {
      new Notification(`New order #${orderNumber}`, { body, tag: `order-${orderNumber}` })
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
}
