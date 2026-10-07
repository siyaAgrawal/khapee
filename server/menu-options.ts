import { db } from './db.ts'

/**
 * Variations and add-ons: what a dish can be ordered as, and what it costs.
 *
 * One function prices a line for every route that takes an order — the
 * checkout, the UPI request before it, a table's round, a waiter's extra — so
 * the amount a customer is asked for and the amount on the order can never
 * disagree. Prices always come from the database, never from the phone.
 *
 * Rules, as Petpooja's menus define them:
 *   - a dish with variations must be ordered as one of them, and is priced by it
 *   - add-on groups belong to the dish (or to one variation of it), each with a
 *     minimum and maximum number of picks; a maximum of 0 means no limit
 *   - add-ons are added on top of the dish or variation price
 */

export type Variation = {
  id: number
  name: string
  groupName: string
  priceCents: number
  isAvailable: boolean
  posVariationId: string | null
}

export type AddonItem = { id: number; name: string; priceCents: number; isAvailable: boolean; posAddonId: string | null }

export type AddonGroup = {
  id: number
  name: string
  min: number
  max: number
  /** Only offered with this variation, when set. */
  variationId: number | null
  posGroupId: string | null
  items: AddonItem[]
}

export type DishOptions = { variations: Variation[]; addonGroups: AddonGroup[] }

/** Every option for a set of dishes, in one pass. Dishes with none are absent. */
export function optionsFor(menuItemIds: number[]): Map<number, DishOptions> {
  const out = new Map<number, DishOptions>()
  if (!menuItemIds.length) return out
  const ids = [...new Set(menuItemIds)]
  const marks = ids.map(() => '?').join(',')
  const get = (id: number) => {
    let o = out.get(id)
    if (!o) out.set(id, (o = { variations: [], addonGroups: [] }))
    return o
  }

  const variations = db
    .prepare(
      `SELECT * FROM menu_item_variations WHERE menu_item_id IN (${marks}) ORDER BY sort_order, price_cents, id`,
    )
    .all(...ids) as any[]
  for (const v of variations) {
    get(v.menu_item_id).variations.push({
      id: v.id,
      name: v.name,
      groupName: v.group_name ?? '',
      priceCents: v.price_cents,
      isAvailable: !!v.is_available,
      posVariationId: v.pos_variation_id ?? null,
    })
  }

  const links = db
    .prepare(
      `SELECT l.menu_item_id, l.variation_id, l.min_select, l.max_select,
              g.id AS group_id, g.name AS group_name, g.pos_group_id
         FROM menu_item_addon_groups l
         JOIN menu_addon_groups g ON g.id = l.group_id AND g.is_active = 1
        WHERE l.menu_item_id IN (${marks})
        ORDER BY g.sort_order, g.id`,
    )
    .all(...ids) as any[]
  if (links.length) {
    const groupIds = [...new Set(links.map((l) => l.group_id))]
    const items = db
      .prepare(
        `SELECT * FROM menu_addon_items WHERE group_id IN (${groupIds.map(() => '?').join(',')})
          ORDER BY sort_order, id`,
      )
      .all(...groupIds) as any[]
    const byGroup = new Map<number, AddonItem[]>()
    for (const a of items) {
      const list = byGroup.get(a.group_id) ?? []
      list.push({
        id: a.id,
        name: a.name,
        priceCents: a.price_cents,
        isAvailable: !!a.is_available,
        posAddonId: a.pos_addon_id ?? null,
      })
      byGroup.set(a.group_id, list)
    }
    for (const l of links) {
      get(l.menu_item_id).addonGroups.push({
        id: l.group_id,
        name: l.group_name,
        min: Math.max(0, Number(l.min_select) || 0),
        max: Math.max(0, Number(l.max_select) || 0),
        variationId: l.variation_id ?? null,
        posGroupId: l.pos_group_id ?? null,
        items: byGroup.get(l.group_id) ?? [],
      })
    }
  }
  return out
}

/** One add-on as it was when ordered, kept on the order line. */
export type ChosenAddon = {
  id: number
  posId: string | null
  name: string
  priceCents: number
  groupId: number
  groupName: string
  posGroupId: string | null
}

export type PricedLine =
  | {
      ok: true
      unitPriceCents: number
      variation: Variation | null
      addons: ChosenAddon[]
      /** "Large · Extra cheese, Olives", for receipts and the board. */
      label: string
    }
  | { ok: false; error: string }

/**
 * What one unit of this dish costs with these choices, or why the choices are
 * not valid. `options` is the dish's entry from optionsFor (absent = none).
 */
export function priceLine(
  item: { id: number; name: string; price_cents: number },
  line: { variationId?: unknown; addonIds?: unknown },
  options: DishOptions | undefined,
): PricedLine {
  const variations = options?.variations ?? []
  const wantedVariation = line.variationId === undefined || line.variationId === null || line.variationId === ''
    ? null
    : Number(line.variationId)

  let variation: Variation | null = null
  if (variations.length) {
    if (wantedVariation === null) return { ok: false, error: `Choose an option for ${item.name}.` }
    variation = variations.find((v) => v.id === wantedVariation) ?? null
    if (!variation) return { ok: false, error: `That option for ${item.name} is no longer on the menu.` }
    if (!variation.isAvailable) return { ok: false, error: `${item.name} (${variation.name}) just sold out.` }
  } else if (wantedVariation !== null) {
    return { ok: false, error: `${item.name} no longer has that option.` }
  }

  // The groups this dish offers with this variation.
  const groups = (options?.addonGroups ?? []).filter((g) => g.variationId === null || g.variationId === variation?.id)
  const wanted = Array.isArray(line.addonIds) ? [...new Set(line.addonIds.map(Number).filter(Number.isFinite))] : []
  const addons: ChosenAddon[] = []
  for (const id of wanted) {
    const group = groups.find((g) => g.items.some((a) => a.id === id))
    const addon = group?.items.find((a) => a.id === id)
    if (!group || !addon) return { ok: false, error: `One of the extras on ${item.name} is no longer offered.` }
    if (!addon.isAvailable) return { ok: false, error: `${addon.name} has run out. Take it off ${item.name} to continue.` }
    addons.push({
      id: addon.id,
      posId: addon.posAddonId,
      name: addon.name,
      priceCents: addon.priceCents,
      groupId: group.id,
      groupName: group.name,
      posGroupId: group.posGroupId,
    })
  }
  for (const g of groups) {
    const n = addons.filter((a) => a.groupId === g.id).length
    if (n < g.min) return { ok: false, error: `Choose at least ${g.min} from "${g.name}" for ${item.name}.` }
    if (g.max > 0 && n > g.max) return { ok: false, error: `Choose at most ${g.max} from "${g.name}" for ${item.name}.` }
  }

  const unitPriceCents = (variation ? variation.priceCents : item.price_cents) + addons.reduce((n, a) => n + a.priceCents, 0)
  const label = [variation?.name, addons.map((a) => a.name).join(', ')].filter(Boolean).join(' · ')
  return { ok: true, unitPriceCents, variation, addons, label }
}

/** Reads back what a line was ordered with. */
export function addonsOf(row: { addons?: string | null }): ChosenAddon[] {
  try {
    const parsed = JSON.parse(String(row?.addons || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
