import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Spinner, useToast } from './ui'

/**
 * Half open — the switch for when the kitchen has gone home.
 *
 * A restaurant has two closing times: the one the chef leaves at and the one
 * the door locks at. Between them the only thing anybody can be served is
 * whatever comes ready out of the fridge, and Khapee had no way to say that.
 * Open meant the whole menu; closed meant losing two hours of dessert trade.
 *
 * So: one switch, and a tick against each section saying what survives it.
 * Paying in the app comes with the switch rather than sitting beside it as a
 * second setting, because the two are the same decision — a place running on
 * one person and a fridge cannot carry somebody who orders and never comes.
 */
type Section = { id: number; name: string; stillOn: boolean }

export default function HalfOpen() {
  const toast = useToast()
  const [on, setOn] = useState(false)
  const [sections, setSections] = useState<Section[] | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    api<{ on: boolean; sections: Section[] }>('/staff/limited')
      .then((r) => {
        setOn(r.on)
        setSections(r.sections)
      })
      .catch(() => setSections([]))
  }, [])

  useEffect(load, [load])

  const flip = async () => {
    setBusy('on')
    try {
      const r = await api<{ on: boolean }>('/staff/limited', { body: { on: !on } })
      setOn(r.on)
      toast(
        r.on
          ? 'Half open. Only the ticked sections can be ordered, and only paid in the app.'
          : 'Back to the full menu.',
        r.on ? 'info' : 'good',
      )
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const toggleSection = async (s: Section) => {
    setBusy(`s${s.id}`)
    try {
      await api(`/staff/limited/sections/${s.id}`, { body: { stillOn: !s.stillOn } })
      setSections((prev) => prev?.map((x) => (x.id === s.id ? { ...x, stillOn: !x.stillOn } : x)) ?? prev)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  if (!sections) return null

  const kept = sections.filter((s) => s.stillOn)

  return (
    <section className={`card card-pad ${on ? 'half-open-live' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Kitchen closed, still serving</h2>
          <p className="tiny muted" style={{ margin: 0 }}>
            For the hours after the chef goes home. Only the sections you tick can be ordered, and
            they have to be paid for in the app.
          </p>
        </div>
        <button
          className={`switch ${on ? 'on' : ''}`}
          onClick={flip}
          disabled={busy === 'on'}
          aria-pressed={on}
          aria-label="Kitchen closed, still serving"
        />
      </div>

      {on && (
        <p className="tiny half-open-now">
          <strong>On now.</strong>{' '}
          {kept.length
            ? `Customers can order ${kept.map((s) => s.name).join(' and ')}, paid by UPI. Everything else shows as unavailable.`
            : 'Nothing is ticked, so nothing can be ordered.'}
        </p>
      )}

      <p className="tiny muted" style={{ margin: '14px 0 6px' }}>
        Keep serving:
      </p>
      <div className="half-open-sections">
        {sections.map((s) => (
          <label key={s.id} className={`half-open-chip ${s.stillOn ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={s.stillOn}
              disabled={busy === `s${s.id}`}
              onChange={() => void toggleSection(s)}
            />
            <span>{s.name}</span>
          </label>
        ))}
      </div>
      {!sections.length && <p className="tiny muted">Add some sections to your menu first.</p>}
    </section>
  )
}
