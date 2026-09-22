import { useEffect, useState } from 'react'
import { api } from './api'

const KEY = 'tablo.group'

export type GroupHandle = { token: string; code: string; restaurantId: number }

/** The membership token for the group session on this device. */
export function saveGroup(handle: GroupHandle) {
  try {
    localStorage.setItem(KEY, JSON.stringify(handle))
  } catch {
    /* ignore */
  }
}

export function readGroup(): GroupHandle | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as GroupHandle) : null
  } catch {
    return null
  }
}

export function clearGroup() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}


/**
 * Whether the group on this phone is still a group.
 *
 * Nothing ever checked. A membership token was written to this device when
 * somebody joined a table and then believed forever — so a phone that once
 * shared a table showed "You're at table GSRCQ — add to it" on every visit
 * afterwards, and the cart became a staging area for a session that no
 * longer existed. Placing an ordinary order was then impossible: every route
 * out of the cart led to a dead token.
 *
 * And it did not take a long meal to get there. Group sessions live in the
 * database, the database is rebuilt from the published copy whenever the
 * service restarts, and on the free plan that is often — so every phone that
 * had ever joined a table was stuck the next morning, with no way out that
 * anybody could find.
 *
 * So the handle is confirmed before it is believed, and thrown away the
 * moment the server does not recognise it. Silent on purpose: somebody
 * ordering a coffee should not be told about a table they have already left.
 */
export function useGroup(): { group: GroupHandle | null; checked: boolean; leave: () => void } {
  const [group, setGroup] = useState<GroupHandle | null>(() => readGroup())
  const [checked, setChecked] = useState(() => !readGroup())

  useEffect(() => {
    const handle = readGroup()
    if (!handle) {
      setChecked(true)
      return
    }
    let alive = true
    api<{ session?: { status?: string } }>(`/groups/session/state?groupToken=${encodeURIComponent(handle.token)}`)
      .then((r) => {
        if (!alive) return
        // Closed counts as gone: there is nothing left to add to.
        if (!r?.session || r.session.status === 'CLOSED') {
          clearGroup()
          setGroup(null)
        }
      })
      .catch(() => {
        // The server does not know this token. Whatever the reason, this
        // phone is not in a group, and pretending otherwise is what traps it.
        if (!alive) return
        clearGroup()
        setGroup(null)
      })
      .finally(() => alive && setChecked(true))
    return () => {
      alive = false
    }
  }, [])

  return {
    group,
    checked,
    leave: () => {
      clearGroup()
      setGroup(null)
    },
  }
}
