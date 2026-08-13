import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useSession } from './lib/session'
import { LoadingBlock } from './components/ui'

import Landing from './pages/Landing'
import Home from './pages/Home'
import Restaurant from './pages/Restaurant'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import OrderTrack from './pages/OrderTrack'
import MyOrders from './pages/MyOrders'
import Login from './pages/Login'
import Register from './pages/Register'
import RegisterRestaurant from './pages/RegisterRestaurant'
import TableEntry from './pages/TableEntry'
import GroupJoin from './pages/GroupJoin'
import GroupSession from './pages/GroupSession'

import StaffLayout from './pages/staff/StaffLayout'
import StaffOrders from './pages/staff/StaffOrders'
import StaffProfile from './pages/staff/StaffProfile'
import StaffPayments from './pages/staff/StaffPayments'
import StaffCodes from './pages/staff/StaffCodes'
import StaffTables from './pages/staff/StaffTables'
import StaffMenu from './pages/staff/StaffMenu'
import StaffVerify from './pages/staff/StaffVerify'

function StaffGate({ children }: { children: JSX.Element }) {
  const { user, loading } = useSession()
  const location = useLocation()
  if (loading) return <LoadingBlock label="Checking your session…" />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname, staff: true }} replace />
  if (!user.restaurants?.length || !user.restaurantId) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/restaurants" element={<Home />} />
      <Route path="/r/:id" element={<Restaurant />} />
      <Route path="/t/:token" element={<TableEntry />} />
      <Route path="/g/:code" element={<GroupJoin />} />
      <Route path="/group" element={<GroupSession />} />
      <Route path="/cart" element={<Cart />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/order/:orderNumber" element={<OrderTrack />} />
      <Route path="/orders" element={<MyOrders />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/for-restaurants" element={<RegisterRestaurant />} />

      <Route
        path="/staff"
        element={
          <StaffGate>
            <StaffLayout />
          </StaffGate>
        }
      >
        <Route index element={<Navigate to="/staff/orders" replace />} />
        <Route path="orders" element={<StaffOrders />} />
        <Route path="profile" element={<StaffProfile />} />
        <Route path="payments" element={<StaffPayments />} />
        <Route path="codes" element={<StaffCodes />} />
        <Route path="tables" element={<StaffTables />} />
        <Route path="menu" element={<StaffMenu />} />
        <Route path="verify" element={<StaffVerify />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
