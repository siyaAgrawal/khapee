import { useCallback, useEffect, useState } from 'react'
import LiveStrip from '../../components/LiveStrip'
import { api, ApiError } from '../../lib/api'
import ImagePicker from '../../components/ImagePicker'
import { Art, EmptyState, LoadingBlock, Modal, money, Spinner, useToast } from '../../components/ui'

type Item = {
  id: number
  categoryId: number
  name: string
  description: string
  priceCents: number
  emoji: string
  hue: number
  imageUrl: string | null
  isVeg: boolean
  isAvailable: boolean
  isSpecial: boolean
}
type Category = { id: number; name: string; items: Item[] }

const EMOJI_CHOICES = ['🍽️', '🥤', '☕', '🍵', '🥐', '🍰', '🍕', '🍝', '🍜', '🍛', '🍚', '🫓', '🥪', '🥗', '🍗', '🍤', '🌶️', '🧀', '🍮', '🍦']

type Draft = {
  id: number | null
  categoryId: number
  name: string
  description: string
  price: string
  emoji: string
  hue: number
  isVeg: boolean
  isAvailable: boolean
  isSpecial: boolean
  imageUrl: string | null
}

function emptyDraft(categoryId: number): Draft {
  return {
    id: null,
    categoryId,
    name: '',
    description: '',
    price: '',
    emoji: '🍽️',
    hue: 24,
    isVeg: true,
    isAvailable: true,
    isSpecial: false,
    imageUrl: null,
  }
}

export default function StaffMenu() {
  const toast = useToast()
  const [data, setData] = useState<{ restaurant: any; categories: Category[] } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [newSection, setNewSection] = useState('')
  const [addingSection, setAddingSection] = useState(false)
  /** Eighty dishes in nineteen sections is not a list anybody scrolls twice. */
  const [find, setFind] = useState('')

  const load = useCallback(() => {
    api<{ restaurant: any; categories: Category[] }>('/staff/menu')
      .then(setData)
      .catch((e: ApiError) => toast(e.message, 'bad'))
  }, [toast])

  useEffect(load, [load])

  const toggleItem = async (item: Item) => {
    try {
      await api(`/staff/menu/${item.id}/availability`, { body: { isAvailable: !item.isAvailable } })
      setData((prev) =>
        prev
          ? {
              ...prev,
              categories: prev.categories.map((c) => ({
                ...c,
                items: c.items.map((i) => (i.id === item.id ? { ...i, isAvailable: !i.isAvailable } : i)),
              })),
            }
          : prev,
      )
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  const toggleOpen = async () => {
    if (!data) return
    try {
      const r = await api<{ isOpen: boolean }>('/staff/restaurant/open', {
        body: { isOpen: !data.restaurant.isOpen },
      })
      setData({ ...data, restaurant: { ...data.restaurant, isOpen: r.isOpen } })
      toast(r.isOpen ? 'You are open for orders' : 'Closed — customers cannot order', r.isOpen ? 'good' : 'info')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  const addSection = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddingSection(true)
    try {
      await api('/staff/categories', { body: { name: newSection.trim() } })
      setNewSection('')
      load()
      toast('Section added', 'good')
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    } finally {
      setAddingSection(false)
    }
  }

  const renameSection = async (category: Category) => {
    const name = window.prompt('Rename this section', category.name)?.trim()
    if (!name || name === category.name) return
    try {
      await api(`/staff/categories/${category.id}`, { method: 'PATCH', body: { name } })
      load()
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    }
  }

  const deleteSection = async (category: Category) => {
    const count = category.items.length
    const message = count
      ? `Delete "${category.name}" and its ${count} item${count > 1 ? 's' : ''}? This cannot be undone.`
      : `Delete "${category.name}"?`
    if (!window.confirm(message)) return
    try {
      await api(`/staff/categories/${category.id}`, { method: 'DELETE' })
      load()
      toast('Section deleted', 'info')
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    }
  }

  /**
   * Moving a section or a dish one place.
   *
   * Up and down rather than dragging: the menu is edited on a phone behind a
   * counter as often as on a laptop, and a drag target on a list eighty rows
   * long is a miss waiting to happen.
   */
  const move = async (what: 'categories' | 'menu', id: number, direction: 'up' | 'down') => {
    try {
      await api(`/staff/${what}/${id}/move`, { body: { direction } })
      load()
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    }
  }

  const deleteItem = async (item: Item) => {
    if (!window.confirm(`Remove "${item.name}" from the menu?`)) return
    try {
      await api(`/staff/menu/${item.id}`, { method: 'DELETE' })
      load()
      toast(`${item.name} removed`, 'info')
    } catch (err) {
      toast((err as ApiError).message, 'bad')
    }
  }

  const saveDraft = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft) return
    setSaving(true)
    setFormError('')
    try {
      const body = {
        categoryId: draft.categoryId,
        name: draft.name,
        description: draft.description,
        price: draft.price,
        emoji: draft.emoji,
        hue: draft.hue,
        isVeg: draft.isVeg,
        isAvailable: draft.isAvailable,
        isSpecial: draft.isSpecial,
      }
      if (draft.id) {
        await api(`/staff/menu/${draft.id}`, { method: 'PATCH', body })
        toast('Dish updated', 'good')
        setDraft(null)
      } else {
        const r = await api<{ item: Item }>('/staff/menu', { body })
        toast('Dish added', 'good')
        // Keep the sheet open on the new dish so a photo can go straight on.
        setDraft({ ...draft, id: r.item.id, imageUrl: r.item.imageUrl })
      }
      load()
    } catch (err) {
      setFormError((err as ApiError).message)
    } finally {
      setSaving(false)
    }
  }

  if (!data) return <LoadingBlock />

  const itemCount = data.categories.reduce((n, c) => n + c.items.length, 0)

  // What is on screen while something is typed in the find box. Sections stay
  // whole so a match is still shown in the section it belongs to — a dish out
  // of context is not enough to decide whether it is the right one.
  const needle = find.trim().toLowerCase()
  const sections = !needle
    ? data.categories
    : data.categories
        .map((c) => ({
          ...c,
          items: c.items.filter(
            (i) =>
              i.name.toLowerCase().includes(needle) ||
              i.description.toLowerCase().includes(needle),
          ),
        }))
        .filter((c) => c.items.length > 0 || c.name.toLowerCase().includes(needle))
  const foundCount = sections.reduce((n, c) => n + c.items.length, 0)

  return (
    <>
      <div className="staff-head">
        <div className="spacer" />
        <span className={`badge ${data.restaurant.isOpen ? 'badge-open' : 'badge-closed'}`}>
          {data.restaurant.isOpen ? 'Accepting orders' : 'Closed'}
        </span>
        <button
          className={`switch ${data.restaurant.isOpen ? 'on' : ''}`}
          onClick={toggleOpen}
          aria-pressed={data.restaurant.isOpen}
          aria-label="Toggle open for orders"
        />
      </div>

      {!(data.restaurant.isListed && data.restaurant.isOpen) && (
        <LiveStrip
          restaurantId={data.restaurant.id}
          isListed={!!data.restaurant.isListed}
          isOpen={!!data.restaurant.isOpen}
          onOpen={toggleOpen}
        />
      )}

      <form className="card card-pad mb-2" onSubmit={addSection}>
        <div className="row row-wrap">
          <input
            className="input"
            style={{ maxWidth: 240 }}
            placeholder="New section, e.g. Starters"
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            aria-label="New menu section"
          />
          <button className="btn btn-secondary" disabled={!newSection.trim() || addingSection}>
            {addingSection ? <Spinner /> : 'Add section'}
          </button>
          {data.categories.length > 0 && (
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => {
                setFormError('')
                setDraft(emptyDraft(data.categories[0].id))
              }}
            >
              + Add dish
            </button>
          )}
          <input
            className="input"
            style={{ maxWidth: 220 }}
            type="search"
            placeholder="Find a dish…"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            aria-label="Find a dish on the menu"
          />
          <span className="spacer" style={{ flex: 1 }} />
          <span className="tiny muted">
            {needle
              ? `${foundCount} of ${itemCount} dish${itemCount === 1 ? '' : 'es'}`
              : `${itemCount} dish${itemCount === 1 ? '' : 'es'} in ${data.categories.length} section${data.categories.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </form>

      {data.categories.length === 0 && (
        <EmptyState
          emoji="📋"
          title="No menu yet"
          body="Add a section like “Coffee” or “Mains”, then start adding dishes to it."
        />
      )}

      {!!needle && sections.length === 0 && (
        <EmptyState
          emoji="🔍"
          title={`Nothing matching \u201c${find.trim()}\u201d`}
          body="Try another word, or clear the search to see the whole menu."
          action={
            <button className="btn btn-secondary" onClick={() => setFind('')}>
              Show everything
            </button>
          }
        />
      )}

      {sections.map((c, ci) => (
        <section key={c.id} className="card card-pad mt-3">
          <div className="row" style={{ marginBottom: 6 }}>
            <h2>{c.name}</h2>
            <span className="spacer" style={{ flex: 1 }} />
            {/* Hidden while a search is on: the arrows move a section within
                the whole menu, and next to a filtered list they would look
                like they move it within the results. */}
            {!needle && (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => move('categories', c.id, 'up')}
                  disabled={ci === 0}
                  aria-label={`Move ${c.name} up`}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => move('categories', c.id, 'down')}
                  disabled={ci === sections.length - 1}
                  aria-label={`Move ${c.name} down`}
                  title="Move down"
                >
                  ↓
                </button>
              </>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => renameSection(c)}>
              Rename
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => deleteSection(c)}>
              Delete
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setFormError('')
                setDraft(emptyDraft(c.id))
              }}
            >
              + Dish
            </button>
          </div>

          {c.items.length === 0 ? (
            <p className="tiny muted" style={{ padding: '10px 2px' }}>
              Nothing in this section yet.
            </p>
          ) : (
            c.items.map((item, ii) => (
              <div key={item.id} className="list-row">
                <Art
                  emoji={item.emoji}
                  hue={item.hue}
                  imageUrl={item.imageUrl}
                  className="cart-line-art"
                  rounded={12}
                  alt={item.name}
                />
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 14.5 }}>
                    {item.name}
                    {item.isSpecial && <span className="star" title="This month">★</span>}
                  </strong>
                  <p className="tiny muted">{money(item.priceCents)}</p>
                </div>
                <span className="spacer" />
                {!needle && (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => move('menu', item.id, 'up')}
                      disabled={ii === 0}
                      aria-label={`Move ${item.name} up`}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => move('menu', item.id, 'down')}
                      disabled={ii === c.items.length - 1}
                      aria-label={`Move ${item.name} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setFormError('')
                    setDraft({
                      id: item.id,
                      categoryId: item.categoryId ?? c.id,
                      name: item.name,
                      description: item.description,
                      price: (item.priceCents / 100).toString(),
                      emoji: item.emoji,
                      hue: item.hue,
                      isVeg: item.isVeg,
                      isAvailable: item.isAvailable,
                      isSpecial: item.isSpecial,
                      imageUrl: item.imageUrl,
                    })
                  }}
                >
                  Edit
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => deleteItem(item)}>
                  Delete
                </button>
                <span className={`badge ${item.isAvailable ? 'badge-open' : 'badge-closed'}`}>
                  {item.isAvailable ? 'Available' : 'Sold out'}
                </span>
                <button
                  className={`switch ${item.isAvailable ? 'on' : ''}`}
                  onClick={() => toggleItem(item)}
                  aria-pressed={item.isAvailable}
                  aria-label={`Toggle ${item.name}`}
                />
              </div>
            ))
          )}
        </section>
      ))}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit dish' : 'Add a dish'}
        wide
      >
        {draft && (
          <form onSubmit={saveDraft}>
            {formError && <div className="form-error">{formError}</div>}

            <div className="edit-grid-narrow">
              <div>
                <div className="field">
                  <label htmlFor="d-name">Name</label>
                  <input
                    id="d-name"
                    className="input"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Cold Coffee"
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label htmlFor="d-desc">Description</label>
                  <textarea
                    id="d-desc"
                    className="textarea"
                    style={{ minHeight: 62 }}
                    value={draft.description}
                    maxLength={200}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="Double shot, milk, ice, blended till frothy"
                  />
                </div>
                <div className="row row-wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div className="field" style={{ width: 130 }}>
                    <label htmlFor="d-price">Price (₹)</label>
                    <input
                      id="d-price"
                      className="input"
                      inputMode="decimal"
                      value={draft.price}
                      onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                      placeholder="220"
                    />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 150 }}>
                    <label htmlFor="d-section">Section</label>
                    <select
                      id="d-section"
                      className="select"
                      value={draft.categoryId}
                      onChange={(e) => setDraft({ ...draft, categoryId: Number(e.target.value) })}
                    >
                      {data.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="row row-wrap" style={{ gap: 18, margin: '4px 0 14px' }}>
                  <label className="row tiny" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className={`switch ${draft.isVeg ? 'on' : ''}`}
                      onClick={() => setDraft({ ...draft, isVeg: !draft.isVeg })}
                      aria-pressed={draft.isVeg}
                      aria-label="Vegetarian"
                    />
                    Vegetarian
                  </label>
                  <label className="row tiny" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className={`switch ${draft.isAvailable ? 'on' : ''}`}
                      onClick={() => setDraft({ ...draft, isAvailable: !draft.isAvailable })}
                      aria-pressed={draft.isAvailable}
                      aria-label="Available"
                    />
                    Available
                  </label>
                  <label className="row tiny" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className={`switch ${draft.isSpecial ? 'on' : ''}`}
                      onClick={() => setDraft({ ...draft, isSpecial: !draft.isSpecial })}
                      aria-pressed={draft.isSpecial}
                      aria-label="This month's special"
                    />
                    This month
                  </label>
                </div>
              </div>

              <div>
                <label className="tiny" style={{ fontWeight: 600 }}>
                  Photo
                </label>
                {draft.id ? (
                  <ImagePicker
                    imageUrl={draft.imageUrl}
                    emoji={draft.emoji}
                    hue={draft.hue}
                    uploadPath={`/staff/menu/${draft.id}/image`}
                    label={draft.name}
                    aspect="1 / 1"
                    onChange={(imageUrl) => {
                      setDraft({ ...draft, imageUrl })
                      load()
                    }}
                  />
                ) : (
                  <p className="tiny muted" style={{ margin: '6px 0 12px' }}>
                    Save the dish first, then add a photo.
                  </p>
                )}

                <label className="tiny" style={{ fontWeight: 600 }}>
                  Fallback artwork
                </label>
                <div className="emoji-grid" style={{ marginTop: 6 }}>
                  {EMOJI_CHOICES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={`emoji-btn ${draft.emoji === e ? 'selected' : ''}`}
                      onClick={() => setDraft({ ...draft, emoji: e })}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <input
                  className="hue-slider"
                  style={{ marginTop: 10 }}
                  type="range"
                  min={0}
                  max={360}
                  value={draft.hue}
                  onChange={(e) => setDraft({ ...draft, hue: Number(e.target.value) })}
                  aria-label="Artwork colour"
                />
              </div>
            </div>

            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-accent" disabled={saving}>
                {saving ? <Spinner /> : draft.id ? 'Save dish' : 'Add dish'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                {draft.id ? 'Done' : 'Cancel'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
