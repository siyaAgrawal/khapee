export type OrderType = 'dine_in' | 'pickup'

/**
 * Where the customer is, which is the thing that decides how the order ends.
 * `car` is someone parked on the road outside — the food has to be carried to
 * them, so that flow has a delivery leg the others do not.
 */
export type ServiceType = 'dine_in' | 'car' | 'takeaway' | 'pickup' | 'delivery'

export const DINE_IN_FLOW = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'] as const
export const PICKUP_FLOW = ['NEW', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP'] as const
export const CAR_FLOW = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'DELIVERED'] as const

/**
 * Delivery opens at REQUESTED rather than NEW, because here "accepted" is a
 * real decision and not a formality. A small kitchen taking phone orders says
 * no when it is full, and the app has to be able to say no too — so the order
 * waits for an answer before the customer is told anything is happening.
 */
export const DELIVERY_FLOW = [
  'REQUESTED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const

export type OrderStatus =
  | (typeof DINE_IN_FLOW)[number]
  | (typeof PICKUP_FLOW)[number]
  | (typeof CAR_FLOW)[number]
  | (typeof DELIVERY_FLOW)[number]
  | 'DECLINED'
  | 'CANCELLED'

/** Anything handed over at the counter shares the pickup flow. */
export function flowFor(type: OrderType | ServiceType): readonly OrderStatus[] {
  if (type === 'delivery') return DELIVERY_FLOW
  if (type === 'car') return CAR_FLOW
  return type === 'dine_in' ? DINE_IN_FLOW : PICKUP_FLOW
}

export const SERVICE_LABEL: Record<ServiceType, string> = {
  dine_in: 'Dine in',
  car: 'Roadside',
  delivery: 'Delivery',
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
  if (status === 'CANCELLED' || status === 'DECLINED') return true
  const flow = flowFor(type)
  return flow[flow.length - 1] === status
}

export function canTransition(type: OrderType | ServiceType, from: OrderStatus, to: OrderStatus): boolean {
  // Declining is only ever an answer to a request that is still waiting.
  if (to === 'DECLINED') return from === 'REQUESTED'
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
  DELIVERING: 'On its way',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  REQUESTED: 'Waiting to be accepted',
  DECLINED: 'Could not be taken',
  CANCELLED: 'Cancelled',
}

export const SERVICE_MODES = ['dine_in', 'car', 'takeaway', 'pickup'] as const
export type ServiceMode = (typeof SERVICE_MODES)[number]

/** What a customer sees for where they are, in their own words. */
export const MODE_LABEL: Record<ServiceMode, string> = {
  dine_in: 'At a table',
  car: 'In my car',
  takeaway: 'Takeaway',
  pickup: 'Pickup',
}

/**
 * The line a customer reads while they wait. Written for someone sitting in a
 * car who wants to know whether to keep waiting, not for a kitchen display.
 */
export const CUSTOMER_STATUS_LINE: Partial<Record<OrderStatus, string>> = {
  REQUESTED: 'Sent to the kitchen — waiting for them to accept',
  DECLINED: 'The kitchen could not take this one',
  OUT_FOR_DELIVERY: 'On its way to you',
  NEW: 'Order received',
  ACCEPTED: 'Confirmed by the kitchen',
  PREPARING: 'Being made now',
  READY: 'Ready — someone is bringing it out',
  READY_FOR_PICKUP: 'Ready at the counter',
  DELIVERING: 'On its way to you',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  PICKED_UP: 'Picked up',
  CANCELLED: 'Cancelled',
}

export function money(cents: number): string {
  return '₹' + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}
