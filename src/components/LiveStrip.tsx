import { Link } from 'react-router-dom'

type Props = {
  restaurantId: number
  /** Has a dish a customer could order — the only thing the browse list asks for. */
  isListed: boolean
  isOpen: boolean
  onOpen: () => void
}

/**
 * Where the restaurant stands with customers right now, and the one control
 * that moves it forward. Shown on both screens an owner sets up from.
 */
export default function LiveStrip({ restaurantId, isListed, isOpen, onOpen }: Props) {
  if (!isListed) {
    return (
      <div className="live-strip">
        <span>Not on the app yet</span>
        <Link className="btn btn-secondary btn-sm" to="/staff/menu">
          Add a dish
        </Link>
      </div>
    )
  }

  if (!isOpen) {
    return (
      <div className="live-strip">
        <span>On the app, closed</span>
        <button className="btn btn-secondary btn-sm" onClick={onOpen}>
          Open
        </button>
      </div>
    )
  }

  return (
    <div className="live-strip">
      <span>Taking orders</span>
      <Link className="btn btn-secondary btn-sm" to={`/r/${restaurantId}`}>
        See your page
      </Link>
    </div>
  )
}
