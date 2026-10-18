import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import Login from "@/pages/Login";
import Tenants from "@/pages/admin/Tenants";
import Dashboard from "@/pages/Dashboard";
import FloorPlan from "@/pages/FloorPlan";
import Reservations from "@/pages/Reservations";
import MenuManager from "@/pages/MenuManager";
import QrTables from "@/pages/QrTables";
import Kds from "@/pages/Kds";
import Settings from "@/pages/Settings";
import Booking from "@/pages/guest/Booking";
import CustomerMenu from "@/pages/guest/CustomerMenu";
import OrderStatus from "@/pages/guest/OrderStatus";
import AcceptInvite from "@/pages/guest/AcceptInvite";
import WaitStatus from "@/pages/guest/WaitStatus";
import Pos from "@/pages/Pos";
import Waitlist from "@/pages/Waitlist";
import Inventory from "@/pages/Inventory";

function Loading() {
  return (
    <div className="min-h-screen grid place-items-center bg-[#FAFAFA]" data-testid="app-loading">
      <div className="h-10 w-10 rounded-full border-4 border-gray-200 border-t-[#E03131] animate-spin" />
    </div>
  );
}

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (user === false) return <Navigate to="/login" replace />;
  return children;
}

function TenantRoute({ children }) {
  const { tenant, isSuper } = useAuth();
  if (!tenant) return <Navigate to={isSuper ? "/admin" : "/login"} replace />;
  return <AppLayout>{children}</AppLayout>;
}

function HomeRedirect() {
  const { user, isSuper, tenant } = useAuth();
  if (user === null) return <Loading />;
  if (user === false) return <Navigate to="/login" replace />;
  if (isSuper && !tenant) return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/r/:slug/prenota" element={<Booking />} />
          <Route path="/r/:slug/menu" element={<CustomerMenu />} />
          <Route path="/r/:slug/ordine/:orderId" element={<OrderStatus />} />
          <Route path="/invito/:token" element={<AcceptInvite />} />
          <Route path="/r/:slug/attesa/:code" element={<WaitStatus />} />
          <Route path="/attesa" element={<Protected><TenantRoute><Waitlist /></TenantRoute></Protected>} />
          <Route path="/admin" element={<Protected><Tenants /></Protected>} />
          <Route path="/cassa" element={<Protected><TenantRoute><Pos /></TenantRoute></Protected>} />
          <Route path="/dashboard" element={<Protected><TenantRoute><Dashboard /></TenantRoute></Protected>} />
          <Route path="/sala" element={<Protected><TenantRoute><FloorPlan /></TenantRoute></Protected>} />
          <Route path="/prenotazioni" element={<Protected><TenantRoute><Reservations /></TenantRoute></Protected>} />
          <Route path="/menu" element={<Protected><TenantRoute><MenuManager /></TenantRoute></Protected>} />
          <Route path="/magazzino" element={<Protected><TenantRoute><Inventory /></TenantRoute></Protected>} />
          <Route path="/qr" element={<Protected><TenantRoute><QrTables /></TenantRoute></Protected>} />
          <Route path="/impostazioni" element={<Protected><TenantRoute><Settings /></TenantRoute></Protected>} />
          <Route path="/kds" element={<Protected><Kds /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}

export default App;
