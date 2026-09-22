/**
 * The last few things that went wrong, so somebody can be told what broke.
 *
 * A reference code turned "it is not working" into a code that could be read
 * down a phone — and then the code had to be looked up in a log file on a
 * host nobody running a restaurant can reach. Which is most of a solution
 * and none of an answer.
 *
 * So the faults are kept here as well, in memory, and shown on the dashboard.
 * Whoever hits the error can read what it actually was, and say so, without
 * anybody deploying anything to find out.
 *
 * In memory on purpose. These are worth having for the hour after something
 * breaks and worth nothing a week later, they must never be the reason a
 * write fails, and a restart clearing them is the correct behaviour rather
 * than a loss. The database is for things that happened to a restaurant; this
 * is for things that happened to the software.
 */
export type Fault = {
  reference: string
  at: string
  method: string
  route: string
  /** The exception's own words. Shown to staff, never to a customer. */
  message: string
  restaurantId: number | null
}

const KEEP = 50
const faults: Fault[] = []

export function recordFault(f: Fault): void {
  faults.unshift(f)
  if (faults.length > KEEP) faults.length = KEEP
}

/**
 * What this restaurant should be shown.
 *
 * Scoped to whoever was signed in when it happened, plus anything that broke
 * before we knew who that was — a fault in the middle of signing in belongs
 * to the person staring at it. One restaurant has no business reading the
 * failures of another, which would name their routes and their data.
 */
export function faultsFor(restaurantId: number | null): Fault[] {
  return faults.filter((f) => f.restaurantId === null || f.restaurantId === restaurantId)
}
