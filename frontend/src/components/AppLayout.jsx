import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Grid2x2, CalendarDays, UtensilsCrossed, QrCode, ChefHat, Settings, LogOut, ArrowLeftRight, ExternalLink, Receipt, Hourglass } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, id: "nav-dashboard" },
  { to: "/sala", label: "Sala", icon: Grid2x2, id: "nav-sala" },
  { to: "/cassa", label: "Cassa", icon: Receipt, id: "nav-cassa" },
  { to: "/prenotazioni", label: "Prenotazioni", icon: CalendarDays, id: "nav-prenotazioni" },
  { to: "/attesa", label: "Attesa", icon: Hourglass, id: "nav-attesa" },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed, id: "nav-menu" },
  { to: "/qr", label: "QR Tavoli", icon: QrCode, id: "nav-qr" },
  { to: "/impostazioni", label: "Impostazioni", icon: Settings, id: "nav-impostazioni" },
];

export function AppLayout({ children }) {
  const { user, logout, isSuper, tenant, setActAs } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#111827] flex">
      <aside className="hidden md:flex w-64 flex-col border-r border-gray-200 bg-white" data-testid="sidebar">
        <div className="px-6 py-6 border-b border-gray-200">
          <div className="font-display text-2xl font-extrabold tracking-tight">
            Risto<span className="text-[#E03131]">OS</span>
          </div>
          <div className="mt-2 text-sm text-gray-500 truncate" data-testid="sidebar-tenant-name">{tenant?.name}</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              data-testid={n.id}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  isActive ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              <n.icon size={18} /> {n.label}
            </NavLink>
          ))}
          <a
            href="/kds"
            target="_blank"
            rel="noreferrer"
            data-testid="nav-kds"
            className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors duration-200"
          >
            <ChefHat size={18} /> Schermo cucina (KDS) <ExternalLink size={14} className="ml-auto opacity-50" />
          </a>
        </nav>
        <div className="px-4 py-4 border-t border-gray-200 space-y-2">
          {isSuper && (
            <Button
              variant="outline"
              className="w-full justify-start"
              data-testid="switch-tenant-btn"
              onClick={() => {
                setActAs(null);
                navigate("/admin");
              }}
            >
              <ArrowLeftRight size={16} className="mr-2" /> Cambia ristorante
            </Button>
          )}
          <div className="text-xs text-gray-500 truncate px-1" data-testid="sidebar-user-email">{user?.email}</div>
          <Button variant="ghost" className="w-full justify-start text-gray-600" data-testid="logout-btn" onClick={logout}>
            <LogOut size={16} className="mr-2" /> Esci
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
          <div className="font-display text-xl font-extrabold tracking-tight">
            Risto<span className="text-[#E03131]">OS</span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} data-testid="logout-btn-mobile"><LogOut size={16} /></Button>
        </header>
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8">{children}</main>
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 grid grid-cols-8" data-testid="mobile-nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-2 text-[10px] gap-1 ${isActive ? "text-[#E03131]" : "text-gray-500"}`
              }
            >
              <n.icon size={20} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
