import type { Response } from 'express'

type Client = { id: number; restaurantId: number | null; userId: number | null; res: Response }

let nextId = 1
const clients = new Set<Client>()

export function addClient(res: Response, opts: { restaurantId?: number | null; userId?: number | null }): Client {
  const client: Client = {
    id: nextId++,
    restaurantId: opts.restaurantId ?? null,
    userId: opts.userId ?? null,
    res,
  }
  clients.add(client)
  return client
}

export function removeClient(client: Client) {
  clients.delete(client)
}

function send(client: Client, event: string, data: unknown) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch {
    clients.delete(client)
  }
}

/** Nudges every listener of a restaurant (staff board) plus the ordering customer. */
export function publish(event: string, payload: { restaurantId?: number | null; userId?: number | null } & Record<string, unknown>) {
  for (const client of clients) {
    const matchRestaurant =
      client.restaurantId != null && payload.restaurantId != null && client.restaurantId === payload.restaurantId
    const matchUser = client.userId != null && payload.userId != null && client.userId === payload.userId
    if (matchRestaurant || matchUser) send(client, event, payload)
  }
}

export function heartbeat() {
  for (const client of clients) {
    try {
      client.res.write(': ping\n\n')
    } catch {
      clients.delete(client)
    }
  }
}

export function clientCount() {
  return clients.size
}
