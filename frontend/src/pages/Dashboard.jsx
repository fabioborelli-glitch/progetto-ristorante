import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarDays, Users, Receipt, Euro, ArrowUpRight } from "lucide-react";
import { api, errMsg, fmtEur, RES_STATUS, TABLE_STATUS } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function Dashboard() {
  const { tenant } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    const load = () => api.get("/t/dashboard").then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e)));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="text-gray-500" data-testid="dashboard-loading">Caricamento…</div>;

  return (
    <div className="space-y-10 max-w-6xl" data-testid="dashboard-page">
      <div>
        <div className="text-sm text-gray-500">{new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight mt-1">{tenant?.name}</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={CalendarDays} label="Prenotazioni oggi" value={data.reservations_today} testid="kpi-reservations" />
        <Kpi icon={Users} label="Coperti prenotati" value={data.covers_today} testid="kpi-covers" />
        <Kpi icon={Receipt} label="Ordini aperti" value={data.open_orders} sub={`${data.orders_today} totali oggi`} testid="kpi-open-orders" />
        <Kpi icon={Euro} label="Incasso oggi" value={fmtEur(data.revenue_today)} testid="kpi-revenue" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="bg-white border border-gray-200 rounded-xl p-6 lg:col-span-2" data-testid="upcoming-reservations">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-lg font-bold">Prossime prenotazioni</h2>
            <Link to="/prenotazioni" className="text-sm text-[#E03131] font-medium inline-flex items-center gap-1 hover:underline">Tutte <ArrowUpRight size={14} /></Link>
          </div>
          {data.upcoming.length === 0 ? (
            <div className="text-gray-500 text-sm">Nessuna prenotazione per oggi.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {data.upcoming.map((r) => (
                <div key={r.id} className="flex items-center gap-4 py-3">
                  <div className="font-display text-xl font-bold w-16 tabular-nums">{r.time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-xs text-gray-500">{r.guests} coperti · {r.phone || "—"}</div>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${RES_STATUS[r.status]?.cls}`}>{RES_STATUS[r.status]?.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="bg-white border border-gray-200 rounded-xl p-6" data-testid="tables-status">
            <h2 className="font-display text-lg font-bold mb-4">Stato tavoli</h2>
            <div className="space-y-3">
              {Object.entries(TABLE_STATUS).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${v.color}`} />{v.label}</div>
                  <div className="font-display text-xl font-bold tabular-nums">{data.tables[k] || 0}</div>
                </div>
              ))}
            </div>
            <Link to="/sala" className="mt-5 block text-center text-sm font-medium rounded-lg border border-gray-200 py-2.5 hover:bg-gray-50 transition-colors">Apri la sala</Link>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-6" data-testid="top-items">
            <h2 className="font-display text-lg font-bold mb-4">Piatti top oggi</h2>
            {data.top_items.length === 0 ? (
              <div className="text-gray-500 text-sm">Nessun ordine ancora.</div>
            ) : (
              <ol className="space-y-2">
                {data.top_items.map((it, i) => (
                  <li key={it.name} className="flex items-center gap-3 text-sm">
                    <span className="text-gray-400 w-4">{i + 1}</span>
                    <span className="flex-1 truncate">{it.name}</span>
                    <span className="font-bold tabular-nums">×{it.qty}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, testid }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5" data-testid={testid}>
      <div className="flex items-center gap-2 text-gray-500 text-sm"><Icon size={16} />{label}</div>
      <div className="font-display text-3xl lg:text-4xl font-extrabold tracking-tight mt-3 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
