import { useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useSession } from './lib/session'
import { LoadingBlock } from './components/ui'
import Splash from './components/Splash'

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
import CarEntry from './pages/CarEntry'
import ZoneEntry from './pages/ZoneEntry'
import StaffOps from './pages/staff/StaffOps'
import StaffPos from './pages/staff/StaffPos'
import StaffRuns from './pages/staff/StaffRuns'
import StaffZones from './pages/staff/StaffZones'
import GroupJoin from './pages/GroupJoin'
import Profile from './pages/Profile'
import GroupSession from './pages/GroupSession'

import StaffLayout from './pages/staff/StaffLayout'
import StaffOrders from './pages/staff/StaffOrders'
import StaffProfile from './pages/staff/StaffProfile'
import StaffPayments from './pages/staff/StaffPayments'
import StaffPhotos from './pages/staff/StaffPhotos'
import StaffTable from './pages/staff/StaffTable'
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
  // The title sequence covers the app for its first couple of seconds.
  const [intro, setIntro] = useState(true)

  return (
    <>
      {intro && <Splash onDone={() => setIntro(false)} />}
      <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/restaurants" element={<Navigate to="/" replace />} />
      <Route path="/r/:id" element={<Restaurant />} />
      <Route path="/t/:token" element={<TableEntry />} />
      <Route path="/r/:id/car" element={<CarEntry />} />
      <Route path="/z/:token" element={<ZoneEntry />} />
      <Route path="/g/:code" element={<GroupJoin />} />
      <Route path="/profile" element={<Profile />} />
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
        <Route path="till" element={<StaffPos />} />
        <Route path="floor" element={<StaffOps />} />
        <Route path="runs" element={<StaffRuns />} />
        <Route path="zones" element={<StaffZones />} />
        <Route path="orders" element={<StaffOrders />} />
        <Route path="profile" element={<StaffProfile />} />
        <Route path="payments" element={<StaffPayments />} />
        <Route path="codes" element={<StaffCodes />} />
        <Route path="tables" element={<StaffTables />} />
        <Route path="menu" element={<StaffMenu />} />
        <Route path="photos" element={<StaffPhotos />} />
        <Route path="table/:id" element={<StaffTable />} />
        <Route path="verify" element={<StaffVerify />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
