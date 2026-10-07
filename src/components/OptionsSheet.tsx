import { useEffect, useMemo, useState } from 'react'
import { Modal, money } from './ui'
import type { Choice } from '../lib/cart'

export type DishOptions = {
  variations: { id: number; name: string; groupName: string; priceCents: number; isAvailable: boolean }[]
  addonGroups: {
    id: number
    name: string
    min: number
    max: number
    variationId: number | null
    items: { id: number; name: string; priceCents: number; isAvailable: boolean }[]
  }[]
}

/** Whether a dish has anything to choose before it goes in the basket. */
export function hasOptions(o?: DishOptions | null): o is DishOptions {
  return !!o && (o.variations.length > 0 || o.addonGroups.length > 0)
}

/**
 * Choosing how a dish comes: its size or portion, then any extras.
 *
 * The same rules the server prices by (server/menu-options.ts) — one variation
 * if the dish has them, each add-on group within its minimum and maximum — so
 * the Add button is only live for a choice the order will accept, and the
 * price on it is the price that will be charged.
 */
export default function OptionsSheet({
  dish,
  onClose,
  onAdd,
}: {
  dish: { name: string; priceCents: number; options: DishOptions } | null
  onClose: () => void
  onAdd: (choice: Choice) => void
}) {
  const variations = dish?.options.variations ?? []
  const firstOpen = variations.find((v) => v.isAvailable)?.id ?? null
  const [variationId, setVariationId] = useState<number | null>(firstOpen)
  const [picked, setPicked] = useState<number[]>([])

  // A new dish starts clean.
  useEffect(() => {
    setVariationId(firstOpen)
    setPicked([])
  }, [dish]) // eslint-disable-line react-hooks/exhaustive-deps

  const variation = variations.find((v) => v.id === variationId) ?? null
  const groups = useMemo(
    () => (dish?.options.addonGroups ?? []).filter((g) => g.variationId === null || g.variationId === variationId),
    [dish, variationId],
  )

  // Extras that belong to a different variation drop off when it changes.
  useEffect(() => {
    const allowed = new Set(groups.flatMap((g) => g.items.map((a) => a.id)))
    setPicked((p) => p.filter((id) => allowed.has(id)))
  }, [groups])

  if (!dish) return null

  const countIn = (g: DishOptions['addonGroups'][number]) => g.items.filter((a) => picked.includes(a.id)).length
  const toggle = (g: DishOptions['addonGroups'][number], id: number) => {
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id)
      // A group that allows one behaves like a choice: picking swaps.
      if (g.max === 1) return [...p.filter((x) => !g.items.some((a) => a.id === x)), id]
      if (g.max > 0 && countIn(g) >= g.max) return p
      return [...p, id]
    })
  }

  const short = groups.find((g) => countIn(g) < g.min)
  const needsVariation = variations.length > 0 && !variation
  const extras = groups.flatMap((g) => g.items).filter((a) => picked.includes(a.id))
  const unit = (variation ? variation.priceCents : dish.priceCents) + extras.reduce((n, a) => n + a.priceCents, 0)
  const label = [variation?.name, extras.map((a) => a.name).join(', ')].filter(Boolean).join(' · ')

  const rule = (g: DishOptions['addonGroups'][number]) =>
    g.min > 0 && g.max === g.min
      ? `Pick ${g.min}`
      : g.min > 0
        ? `Pick at least ${g.min}${g.max ? `, up to ${g.max}` : ''}`
        : g.max > 0
          ? `Optional · up to ${g.max}`
          : 'Optional'

  return (
    <Modal open={!!dish} onClose={onClose} title={dish.name}>
      <div className="opt-sheet">
        {variations.length > 0 && (
          <fieldset className="opt-group">
            <legend>
              <span>{variations[0].groupName || 'Choose one'}</span>
              <em>Required</em>
            </legend>
            {variations.map((v) => (
              <label key={v.id} className={`opt-row ${v.isAvailable ? '' : 'off'}`}>
                <input
                  type="radio"
                  name="opt-variation"
                  checked={variationId === v.id}
                  disabled={!v.isAvailable}
                  onChange={() => setVariationId(v.id)}
                />
                <span className="opt-name">{v.name}</span>
                <span className="opt-price">{v.isAvailable ? money(v.priceCents) : 'Sold out'}</span>
              </label>
            ))}
          </fieldset>
        )}

        {groups.map((g) => (
          <fieldset key={`${g.id}-${g.variationId ?? ''}`} className="opt-group">
            <legend>
              <span>{g.name}</span>
              <em>{rule(g)}</em>
            </legend>
            {g.items.map((a) => (
              <label key={a.id} className={`opt-row ${a.isAvailable ? '' : 'off'}`}>
                <input
                  type={g.max === 1 ? 'radio' : 'checkbox'}
                  name={`opt-group-${g.id}`}
                  checked={picked.includes(a.id)}
                  disabled={!a.isAvailable}
                  onChange={() => toggle(g, a.id)}
                  onClick={() => {
                    // A radio that is already on can be taken off again when the group is optional.
                    if (g.max === 1 && g.min === 0 && picked.includes(a.id)) setPicked((p) => p.filter((x) => x !== a.id))
                  }}
                />
                <span className="opt-name">{a.name}</span>
                <span className="opt-price">
                  {!a.isAvailable ? 'Sold out' : a.priceCents ? `+${money(a.priceCents)}` : 'Free'}
                </span>
              </label>
            ))}
          </fieldset>
        ))}

        <button
          className="btn btn-accent btn-lg btn-block"
          disabled={needsVariation || !!short}
          onClick={() => onAdd({ variationId: variation?.id ?? null, addonIds: picked, label, unitPriceCents: unit })}
        >
          {needsVariation ? 'Choose an option' : short ? `Choose from "${short.name}"` : `Add · ${money(unit)}`}
        </button>
      </div>
    </Modal>
  )
}
