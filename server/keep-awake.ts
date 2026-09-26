/**
 * Keeping a free host from falling asleep, because sleeping loses the alerts.
 *
 * A free Render service sleeps after fifteen minutes with no traffic, and on
 * waking the database is rebuilt from the committed snapshot. The phones that
 * switched on order alerts live in that database and not in the snapshot, so
 * every wake unsubscribed every restaurant — and the thing that wakes the
 * service is a customer placing an order, which then reached nobody. The owner
 * found out from the customer standing at the counter.
 *
 * So while the service is up it asks for its own health page every ten
 * minutes, through its public address so the request counts as traffic. It
 * never gets to fifteen idle minutes, never sleeps, and the alert list
 * survives until the next deploy. A deploy still starts from the snapshot;
 * each phone is signed up again the next time its dashboard is opened.
 *
 * Only on a host that keeps no disk and tells us its own address, so local
 * development and the tests never make a request they did not ask for.
 * KHAPEE_KEEP_AWAKE=off turns it off — on a paid plan with a disk, or if the
 * free plan's monthly hours turn out not to cover a whole month.
 */
import { WRITES_ARE_TEMPORARY } from './db.ts'

const EVERY_MS = 10 * 60 * 1000

export function keepAwake(): void {
  const off = String(process.env.KHAPEE_KEEP_AWAKE ?? '').trim().toLowerCase()
  if (off === 'off' || off === '0' || off === 'false') return
  if (!WRITES_ARE_TEMPORARY) return
  const base = String(process.env.KHAPEE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim()
  if (!base) return

  const url = `${base.replace(/\/+$/, '')}/api/health`
  const ping = () => {
    fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((e) => {
      console.warn(`  keep-awake: ${url} did not answer (${(e as Error)?.message ?? e})`)
    })
  }
  setInterval(ping, EVERY_MS)
  console.log(`    keep-awake →  ${url} every ${EVERY_MS / 60000} min, so the alert list is not wiped by a sleep`)
}
