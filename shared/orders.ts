export type OrderType = 'dine_in' | 'pickup'

/** What the customer actually gets: at a table, carried out, or collected later. */
export type ServiceType = 'dine_in' | 'takeaway' | 'pickup'

export const DINE_IN_FLOW = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'] as const
export const PICKUP_FLOW = ['NEW', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP'] as const

export type OrderStatus = (typeof DINE_IN_FLOW)[number] | (typeof PICKUP_FLOW)[number] | 'CANCELLED'

/** Anything handed over at the counter shares the pickup flow. */
export function flowFor(type: OrderType | ServiceType): readonly OrderStatus[] {
  return type === 'dine_in' ? DINE_IN_FLOW : PICKUP_FLOW
}

export const SERVICE_LABEL: Record<ServiceType, string> = {
  dine_in: 'Dine in',
  takeaway: 'Takeaway',
  pickup: 'Pickup',
}

export function nextStatus(type: OrderType | ServiceType, current: OrderStatus): OrderStatus | null {
  const flow = flowFor(type)
  const i = flow.indexOf(current)
  if (i === -1 || i === flow.length - 1) return null
  return flow[i + 1]
}

export function isTerminal(type: OrderType | ServiceType, status: OrderStatus): boolean {
  if (status === 'CANCELLED') return true
  const flow = flowFor(type)
  return flow[flow.length - 1] === status
}

export function canTransition(type: OrderType | ServiceType, from: OrderStatus, to: OrderStatus): boolean {
  if (to === 'CANCELLED') return !isTerminal(type, from)
  const flow = flowFor(type)
  const a = flow.indexOf(from)
  const b = flow.indexOf(to)
  // Forward one step, or back one step to undo a mis-tap. No skipping ahead.
  return a !== -1 && b !== -1 && (b === a + 1 || b === a - 1)
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: 'New',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  READY_FOR_PICKUP: 'Ready for pickup',
  COMPLETED: 'Completed',
  PICKED_UP: 'Picked up',
  CANCELLED: 'Cancelled',
}

export function money(cents: number): string {
  return '₹' + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}
