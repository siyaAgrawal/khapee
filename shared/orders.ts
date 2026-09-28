export type OrderType = 'dine_in' | 'pickup'

/**
 * Where the customer is, which is the thing that decides how the order ends.
 * `car` is someone parked on the road outside — the food has to be carried to
 * them, so that flow has a delivery leg the others do not.
 */
export type ServiceType = 'dine_in' | 'car' | 'takeaway' | 'pickup' | 'delivery' | 'precinct'

/**
 * Two things happen to an order, and the app says both.
 *
 * There were five steps: new, preparing, ready, and a handover at the end. A
 * kitchen pressed four buttons per order and a customer watched a bar creep
 * along, and none of it told either of them anything they did not already
 * know — the food is obviously being cooked between "yes" and "ready", and
 * everybody in the room can see it has been handed over.
 *
 * So there are two: the restaurant has taken it, and the food is ready. The
 * second is the end of the order. Every button that existed only to admit
 * that cooking was happening is gone, and so is the one that said a plate had
 * travelled a metre.
 *
 * The statuses themselves are kept in the type below rather than deleted:
 * orders placed before this change still carry PREPARING or COMPLETED, and a
 * database full of rows nothing can read is a worse problem than a longer
 * union.
 */
export const DINE_IN_FLOW = ['NEW', 'ACCEPTED', 'READY'] as const
export const PICKUP_FLOW = ['NEW', 'ACCEPTED', 'READY_FOR_PICKUP'] as const
export const CAR_FLOW = ['NEW', 'ACCEPTED', 'READY'] as const

/**
 * Delivery opens at REQUESTED rather than NEW, because here "accepted" is a
 * real decision and not a formality. A small kitchen taking phone orders says
 * no when it is full, and the app has to be able to say no too — so the order
 * waits for an answer before the customer is told anything is happening.
 */
export const DELIVERY_FLOW = ['REQUESTED', 'ACCEPTED', 'READY'] as const

/**
 * Statuses no flow offers any more, kept so orders placed before the app was
 * cut to two steps still read, and so a POS that reports one is understood.
 */
export type RetiredStatus = 'PREPARING' | 'COMPLETED' | 'PICKED_UP' | 'DELIVERING' | 'OUT_FOR_DELIVERY' | 'DELIVERED'

export type OrderStatus =
  | RetiredStatus
  | (typeof DINE_IN_FLOW)[number]
  | (typeof PICKUP_FLOW)[number]
  | (typeof CAR_FLOW)[number]
  | (typeof DELIVERY_FLOW)[number]
  | 'DECLINED'
  | 'CANCELLED'

/** Anything handed over at the counter shares the pickup flow. */
export function flowFor(type: OrderType | ServiceType): readonly OrderStatus[] {
  // An order carried out into a precinct is a delivery in every way that
  // matters to the kitchen: it has to be agreed to before it is cooked, and
  // somebody has to walk it out. Only the distance is different.
  if (type === 'delivery' || type === 'precinct') return DELIVERY_FLOW
  if (type === 'car') return CAR_FLOW
  return type === 'dine_in' ? DINE_IN_FLOW : PICKUP_FLOW
}

export const SERVICE_LABEL: Record<ServiceType, string> = {
  dine_in: 'Dine in',
  car: 'Roadside',
  delivery: 'Delivery',
  takeaway: 'Takeaway',
  pickup: 'Pickup',
  precinct: 'Nearby',
}

/**
 * How the order was placed, in the three words an owner asked for: from the
 * car, takeaway, or at the restaurant (plus delivery and nearby, which are
 * their own things). Takeaway covers both carrying out and collecting later.
 * One definition, so the board, the history and insights all say the same.
 */
export type HowOrdered = { key: 'car' | 'takeaway' | 'restaurant' | 'delivery' | 'nearby'; icon: string; label: string }
export function howOrdered(serviceType: ServiceType | string | null | undefined): HowOrdered {
  switch (serviceType) {
    case 'car':
      return { key: 'car', icon: '🚗', label: 'Car' }
    case 'takeaway':
    case 'pickup':
      return { key: 'takeaway', icon: '🥡', label: 'Takeaway' }
    case 'delivery':
      return { key: 'delivery', icon: '🛵', label: 'Delivery' }
    case 'precinct':
      return { key: 'nearby', icon: '📍', label: 'Nearby' }
    default:
      return { key: 'restaurant', icon: '🍽️', label: 'At the restaurant' }
  }
}

/**
 * An order nobody has paid for yet waits at REQUESTED whatever the mode.
 *
 * Money is the reason. A restaurant that has been paid can start cooking; one
 * that has not is being asked to make food on the promise that somebody turns
 * up with cash, and that is a decision, not a formality. Saying yes drops it
 * into its own mode's flow at ACCEPTED, so nothing downstream changes.
 */
export function nextStatus(type: OrderType | ServiceType, current: OrderStatus): OrderStatus | null {
  if (current === 'REQUESTED') return 'ACCEPTED'
  const flow = flowFor(type)
  const i = flow.indexOf(current)
  if (i === -1 || i === flow.length - 1) return null
  return flow[i + 1]
}

/**
 * Whether the restaurant has actually said yes to this order.
 *
 * The customer's tick hangs on this and nothing else. Placing an order is
 * something the customer did; being accepted is something the restaurant did,
 * and only the second one is a promise that food is coming. Drawing a tick for
 * the first — which is what a confirmation screen naturally does — tells
 * somebody their order is confirmed while it is still sitting on a board that
 * nobody has looked at, and a kitchen that then turns it down is breaking a
 * promise the kitchen never made.
 *
 * NEW counts as not yet accepted. An order paid for in the app skips straight
 * past REQUESTED, but paying is not the kitchen agreeing to cook.
 */
export function isAccepted(status: OrderStatus): boolean {
  return !['REQUESTED', 'NEW', 'DECLINED', 'CANCELLED'].includes(status)
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
  // Waiting on a yes or no: the only answers are yes, no, and never mind.
  if (from === 'REQUESTED') return to === 'ACCEPTED'
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

/** Every place a session can put someone. */
export const SERVICE_MODES = ['dine_in', 'car', 'takeaway', 'pickup', 'delivery', 'precinct'] as const
export type ServiceMode = (typeof SERVICE_MODES)[number]

/** What a customer sees for where they are, in their own words. */
export const MODE_LABEL: Record<ServiceMode, string> = {
  dine_in: 'At a table',
  car: 'In my car',
  takeaway: 'Takeaway',
  pickup: 'Pickup',
  delivery: 'To my address',
  precinct: 'Somewhere nearby',
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
