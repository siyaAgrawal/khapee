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
import DeliveryEntry from './pages/DeliveryEntry'
import PrecinctEntry from './pages/PrecinctEntry'
import NearbyEntry from './pages/NearbyEntry'
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
import StaffAlerts from './pages/staff/StaffAlerts'
import StaffBilling from './pages/staff/StaffBilling'
import AlertInvite from './pages/AlertInvite'
import Thank from './pages/Thank'
import StaffPayments from './pages/staff/StaffPayments'
import StaffPhotos from './pages/staff/StaffPhotos'
import StaffTable from './pages/staff/StaffTable'
import StaffCodes from './pages/staff/StaffCodes'
import StaffTables from './pages/staff/StaffTables'
import StaffMenu from './pages/staff/StaffMenu'
import StaffVerify from './pages/staff/StaffVerify'
import StaffPrecincts from './pages/staff/StaffPrecincts'
import StaffFloor from './pages/staff/StaffFloor'
import StaffHistory from './pages/staff/StaffHistory'
import StaffTakings from './pages/staff/StaffTakings'
import Insights from './pages/Insights'
import Forgot from './pages/Forgot'
import Reset from './pages/Reset'
import { MenuSection, OrdersSection, SettingsSection, TillSection } from './pages/staff/Sections'

/**
 * The first screen, which for somebody who runs a restaurant is its dashboard.
 *
 * Opening the installed app, or khapee.com with a session already saved, lands
 * on / — and an owner opening Khapee is opening it to see orders. Only the
 * first screen of a visit is sent on: following a link back to the restaurant
 * list from inside the app still shows it.
 */
function Start() {
  const { user, loading } = useSession()
  const location = useLocation()
  const firstScreen = location.key === 'default'
  if (firstScreen && loading) return <LoadingBlock label="Opening Khapee…" />
  if (firstScreen && user?.restaurants?.length && user.restaurantId) return <Navigate to="/staff" replace />
  return <Home />
}

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
  /*
   * The title card plays on the front door, and nowhere else.
   *
   * It was shown on every page load, covering whatever had been opened for
   * two and a half seconds — including a menu somebody had just reached by
   * scanning the QR on their table. They would tap Add, the tap would land on
   * the splash instead and only dismiss it, and the dish would not go in the
   * basket. Reported exactly that way: the first Add does nothing.
   *
   * Anybody who arrived somewhere specific — a menu, a receipt, a dashboard —
   * asked for that thing, not for a title sequence over the top of it.
   */
  const [intro, setIntro] = useState(
    () => typeof window === 'undefined' || window.location.pathname === '/',
  )

  return (
    <>
      {intro && <Splash onDone={() => setIntro(false)} />}
      <Routes>
      <Route path="/" element={<Start />} />
      <Route path="/restaurants" element={<Navigate to="/" replace />} />
      <Route path="/r/:id" element={<Restaurant />} />
      <Route path="/t/:token" element={<TableEntry />} />
      <Route path="/r/:id/car" element={<CarEntry />} />
      <Route path="/r/:id/delivery" element={<DeliveryEntry />} />
      {/* A street, not a restaurant: everyone here who will walk an order out. */}
      <Route path="/p/:slug" element={<PrecinctEntry />} />
      <Route path="/r/:id/nearby/:slug" element={<NearbyEntry />} />
      <Route path="/z/:token" element={<ZoneEntry />} />
      <Route path="/g/:code" element={<GroupJoin />} />
      <Route path="/profile" element={<Profile />} />
      {/* One phone, one capability, no account. See src/pages/AlertInvite.tsx */}
      {/* Where the "thank them" notification lands — see src/pages/Thank.tsx */}
      <Route path="/thank" element={<Thank />} />
      <Route path="/alerts" element={<AlertInvite />} />
      {/* Khapee's own numbers, for whoever runs Khapee. See server/insights.ts. */}
      <Route path="/insights" element={<Insights />} />
      <Route path="/alerts/:token" element={<AlertInvite />} />
      <Route path="/group" element={<GroupSession />} />
      <Route path="/cart" element={<Cart />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/order/:orderNumber" element={<OrderTrack />} />
      <Route path="/orders" element={<MyOrders />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<Reset />} />
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

        {/* Four sections, each holding the views for one job. */}
        <Route path="orders" element={<OrdersSection />}>
          <Route index element={<StaffOrders />} />
          <Route path="tables" element={<StaffFloor />} />
          <Route path="history" element={<StaffHistory />} />
          <Route path="floor" element={<StaffOps />} />
          <Route path="deliveries" element={<StaffRuns />} />
          <Route path="check" element={<StaffVerify />} />
        </Route>
        <Route path="till" element={<TillSection />}>
          <Route index element={<StaffPos />} />
          <Route path="takings" element={<StaffTakings />} />
          <Route path="payments" element={<StaffPayments />} />
        </Route>
        <Route path="menu" element={<MenuSection />}>
          <Route index element={<StaffMenu />} />
          <Route path="photos" element={<StaffPhotos />} />
        </Route>
        <Route path="settings" element={<SettingsSection />}>
          <Route index element={<StaffProfile />} />
          <Route path="alerts" element={<StaffAlerts />} />
          <Route path="billing" element={<StaffBilling />} />
          <Route path="tables" element={<StaffTables />} />
          <Route path="codes" element={<StaffCodes />} />
          <Route path="zones" element={<StaffZones />} />
          <Route path="nearby" element={<StaffPrecincts />} />
        </Route>

        <Route path="table/:id" element={<StaffTable />} />

        {/* Where those views used to live. Bookmarks and anything already open
            keep working rather than dropping someone on the front page. */}
        <Route path="floor" element={<Navigate to="/staff/orders/floor" replace />} />
        <Route path="runs" element={<Navigate to="/staff/orders/deliveries" replace />} />
        <Route path="verify" element={<Navigate to="/staff/orders/check" replace />} />
        <Route path="payments" element={<Navigate to="/staff/till/payments" replace />} />
        <Route path="photos" element={<Navigate to="/staff/menu/photos" replace />} />
        <Route path="profile" element={<Navigate to="/staff/settings" replace />} />
        <Route path="tables" element={<Navigate to="/staff/settings/tables" replace />} />
        <Route path="codes" element={<Navigate to="/staff/settings/codes" replace />} />
        <Route path="zones" element={<Navigate to="/staff/settings/zones" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
