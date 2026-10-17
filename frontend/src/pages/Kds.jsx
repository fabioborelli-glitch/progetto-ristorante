import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChefHat, Volume2, VolumeX, ArrowLeft, Wifi, WifiOff } from "lucide-react";
import { api, errMsg, ORDER_STATUS } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTenantSocket } from "@/hooks/useTenantSocket";

const NEXT = { nuovo: ["in_preparazione", "Inizia"], in_preparazione: ["pronto", "Pronto"], pronto: ["servito", "Servito"] };

function elapsed(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "adesso" : `${m} min`;
}

export default function Kds() {
  const { tenant, user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("all");
  const [station, setStation] = useState(() => localStorage.getItem("ristoos_kds_station") || "all");
  const [sound, setSound] = useState(true);
  const [, tick] = useState(0);
  const known = useRef(new Set());
  const first = useRef(true);
  const stations = tenant?.stations || [];
  const stationById = Object.fromEntries(stations.map((s) => [s.id, s]));

  const pickStation = (id) => { setStation(id); localStorage.setItem("ristoos_kds_station", id); };

  const view = (o) => {
    if (station === "all") return { ...o, effStatus: o.status, shownItems: o.items, others: 0 };
    const shownItems = o.items.filter((it) => !it.station_id || it.station_id === station);
    return { ...o, effStatus: o.stations?.[station] ?? o.status, shownItems, others: o.items.length - shownItems.length };
  };

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/t/orders");
      if (!first.current && sound) {
        const fresh = data.some((o) => !known.current.has(o.id));
        if (fresh) beep();
      }
      known.current = new Set(data.map((o) => o.id));
      first.current = false;
      setOrders(data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [sound]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    const tk = setInterval(() => tick((x) => x + 1), 30000);
    return () => { clearInterval(t); clearInterval(tk); };
  }, [load]);

  const connected = useTenantSocket((event) => {
    if (event === "orders_changed") load();
  });

  const bump = async (o) => {
    const [status] = NEXT[o.effStatus];
    try {
      await api.patch(`/t/orders/${o.id}/status`, { status, station_id: station === "all" ? null : station });
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const cancel = async (o) => {
    if (!window.confirm("Annullare questo ordine?")) return;
    await api.patch(`/t/orders/${o.id}/status`, { status: "annullato" }).catch((e) => toast.error(errMsg(e)));
    load();
  };

  const scoped = orders.map(view).filter((o) => o.shownItems.length > 0 && NEXT[o.effStatus]);
  const visible = filter === "all" ? scoped : scoped.filter((o) => o.effStatus === filter);
  const stationName = station === "all" ? "Cucina" : stationById[station]?.name || "Reparto";

  return (
    <div className="dark min-h-screen bg-[#0A0A0A] text-[#F8FAFC]" data-testid="kds-page">
      <header className="sticky top-0 z-10 bg-[#0A0A0A]/90 backdrop-blur border-b border-[#334155] px-5 py-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <ChefHat className="text-[#FF3B30]" />
          <div>
            <div className="font-display text-xl font-extrabold leading-none" data-testid="kds-station-title">{stationName}</div>
            <div className="text-xs text-gray-400">{tenant?.name || user?.email}</div>
          </div>
        </div>
        {stations.length > 0 && (
          <div className="flex gap-1.5 ml-2 bg-[#171717] rounded-full p-1" data-testid="kds-stations">
            <button onClick={() => pickStation("all")} data-testid="kds-station-all" className={`h-9 px-3 rounded-full text-xs font-semibold ${station === "all" ? "bg-[#F8FAFC] text-[#0A0A0A]" : "text-gray-300"}`}>Tutti</button>
            {stations.map((s) => (
              <button key={s.id} onClick={() => pickStation(s.id)} data-testid={`kds-station-${s.id}`} className={`h-9 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${station === s.id ? "bg-[#F8FAFC] text-[#0A0A0A]" : "text-gray-300"}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 ml-2">
          {[["all", "Tutti"], ["nuovo", "Nuovi"], ["in_preparazione", "In preparazione"], ["pronto", "Pronti"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} data-testid={`kds-filter-${k}`}
              className={`h-11 px-4 rounded-full text-sm font-semibold transition-colors duration-200 ${filter === k ? "bg-[#F8FAFC] text-[#0A0A0A]" : "bg-[#171717] text-gray-300 hover:bg-[#262626]"}`}>
              {l} {k !== "all" && <span className="ml-1 opacity-60">{scoped.filter((o) => o.effStatus === k).length}</span>}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs px-3 h-11 rounded-full ${connected ? "bg-emerald-500/15 text-emerald-300" : "bg-[#171717] text-gray-500"}`} data-testid="kds-ws-status">{connected ? <Wifi size={14} /> : <WifiOff size={14} />}{connected ? "Live" : "Riconnessione…"}</span>
          <button onClick={() => setSound(!sound)} className="h-11 w-11 grid place-items-center rounded-full bg-[#171717] hover:bg-[#262626]" data-testid="kds-sound-toggle">{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
          {tenant && <Link to="/dashboard" className="h-11 px-4 inline-flex items-center gap-2 rounded-full bg-[#171717] hover:bg-[#262626] text-sm" data-testid="kds-back-link"><ArrowLeft size={16} />Gestionale</Link>}
        </div>
      </header>

      <main className="p-5">
        {visible.length === 0 ? (
          <div className="h-[60vh] grid place-items-center text-gray-500 text-lg" data-testid="kds-empty">Nessun ordine attivo. Attendo…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4" data-testid="kds-grid">
            {visible.map((o, i) => {
              const st = ORDER_STATUS[o.effStatus];
              const [, label] = NEXT[o.effStatus] || [];
              return (
                <article key={o.id} style={{ animationDelay: `${i * 40}ms` }} className={`fade-up bg-[#171717] rounded-xl border-t-4 ${st.color} ${o.effStatus === "nuovo" ? "pulse-new" : ""} flex flex-col`} data-testid={`kds-ticket-${o.id}`}>
                  <div className="px-5 pt-4 pb-3 flex items-start justify-between border-b border-[#262626]">
                    <div>
                      <div className="font-display text-3xl font-extrabold leading-none kds-ticket-number">Tav. {o.table_name}</div>
                      <div className="text-xs text-gray-400 mt-1.5">{o.customer_name || "Cliente"} · {new Date(o.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                    <div className="text-right">
                      <span className={`inline-block text-[11px] font-bold uppercase tracking-wide text-white px-2 py-1 rounded ${st.badge}`} data-testid={`kds-ticket-status-${o.id}`}>{st.label}</span>
                      <div className="text-sm text-gray-300 mt-1.5 tabular-nums" data-testid={`kds-elapsed-${o.id}`}>{elapsed(o.created_at)}</div>
                    </div>
                  </div>
                  <ul className="px-5 py-4 space-y-2.5 flex-1">
                    {o.shownItems.map((it, j) => {
                      const s = stationById[it.station_id];
                      return (
                        <li key={j} className="flex gap-3">
                          <span className="font-display text-2xl font-extrabold w-9 tabular-nums text-[#FF3B30]">{it.qty}</span>
                          <div className="flex-1">
                            <div className="text-lg font-semibold leading-tight">{it.name}</div>
                            {it.variant && <div className="text-sm text-amber-300">{it.variant}</div>}
                            {it.notes && <div className="text-sm text-gray-400 italic">“{it.notes}”</div>}
                            {station === "all" && s && <div className="text-[11px] mt-0.5 inline-flex items-center gap-1 text-gray-400"><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.name}{o.stations?.[s.id] && o.stations[s.id] !== o.status ? ` · ${ORDER_STATUS[o.stations[s.id]]?.label}` : ""}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {o.others > 0 && <div className="mx-5 mb-3 text-xs text-gray-500" data-testid={`kds-others-${o.id}`}>+{o.others} {o.others === 1 ? "piatto" : "piatti"} in altri reparti</div>}
                  {o.notes && <div className="mx-5 mb-3 text-sm bg-amber-500/10 text-amber-200 border border-amber-500/30 rounded-lg px-3 py-2">Nota: {o.notes}</div>}
                  <div className="p-3 pt-0 flex gap-2">
                    <button onClick={() => bump(o)} data-testid={`kds-bump-${o.id}`}
                      className={`flex-1 min-h-[64px] rounded-lg font-display text-xl font-extrabold text-white active:scale-95 transition-transform ${o.effStatus === "nuovo" ? "bg-amber-500 hover:bg-amber-400" : o.effStatus === "in_preparazione" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-gray-600 hover:bg-gray-500"}`}>
                      {label}
                    </button>
                    {station === "all" && <button onClick={() => cancel(o)} className="min-h-[64px] px-4 rounded-lg bg-[#262626] text-gray-400 hover:text-red-400 text-sm" data-testid={`kds-cancel-${o.id}`}>Annulla</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {}
}
