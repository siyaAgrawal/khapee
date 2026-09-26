import type { Response } from 'express'

type Client = {
  id: number
  restaurantId: number | null
  userId: number | null
  /**
   * One order, for the person waiting on it.
   *
   * Almost nobody ordering a coffee makes an account, so a customer has no
   * userId to match on and heard nothing from this bus at all — their
   * tracking page found out the kitchen had refused their order on the next
   * six-second poll, if they were still looking. The receipt token they are
   * already holding is proof the order is theirs, so it can carry a
   * subscription to that one order and nothing else.
   */
  orderId: number | null
  res: Response
}

let nextId = 1
const clients = new Set<Client>()

export function addClient(
  res: Response,
  opts: { restaurantId?: number | null; userId?: number | null; orderId?: number | null },
): Client {
  const client: Client = {
    id: nextId++,
    restaurantId: opts.restaurantId ?? null,
    userId: opts.userId ?? null,
    orderId: opts.orderId ?? null,
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
export function publish(
  event: string,
  payload: { restaurantId?: number | null; userId?: number | null; orderId?: number | null } & Record<string, unknown>,
) {
  for (const client of clients) {
    const matchRestaurant =
      client.restaurantId != null && payload.restaurantId != null && client.restaurantId === payload.restaurantId
    const matchUser = client.userId != null && payload.userId != null && client.userId === payload.userId
    const matchOrder = client.orderId != null && payload.orderId != null && client.orderId === payload.orderId
    if (matchRestaurant || matchUser || matchOrder) send(client, event, payload)
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
