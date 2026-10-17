import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Check, ChefHat, Bell, Utensils } from "lucide-react";
import { api, fmtEur } from "@/lib/api";

const STEPS = [
  { key: "nuovo", label: "Ricevuto", icon: Check },
  { key: "in_preparazione", label: "In preparazione", icon: ChefHat },
  { key: "pronto", label: "Pronto", icon: Bell },
  { key: "servito", label: "Servito", icon: Utensils },
];

export default function OrderStatus() {
  const { slug, orderId } = useParams();
  const [order, setOrder] = useState(null);

  useEffect(() => {
    const load = () => api.get(`/public/${slug}/orders/${orderId}`).then((r) => setOrder(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [slug, orderId]);

  if (!order) return <div className="min-h-screen bg-[#FDFBF7]" />;
  const idx = STEPS.findIndex((s) => s.key === order.status);
  const tableCode = new URLSearchParams(window.location.search).get("t");

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#292524] p-6" data-testid="order-status-page">
      <div className="max-w-md mx-auto space-y-8 pt-8">
        <div className="text-center">
          <div className="h-16 w-16 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center mx-auto fade-up"><Check size={32} /></div>
          <h1 className="font-display text-3xl font-extrabold mt-4">Ordine inviato!</h1>
          <p className="text-[#78716c] mt-1">Tavolo {order.table_name} · la cucina lo sta ricevendo</p>
        </div>

        {order.status === "annullato" ? (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-center" data-testid="order-cancelled">Ordine annullato dal ristorante. Chiedi al personale.</div>
        ) : (
          <ol className="bg-white border border-[#e7e0d3] rounded-2xl p-5 space-y-4" data-testid="order-steps">
            {STEPS.map((s, i) => {
              const done = i <= idx;
              const current = i === idx;
              return (
                <li key={s.key} className="flex items-center gap-4" data-testid={`step-${s.key}`}>
                  <div className={`h-10 w-10 rounded-full grid place-items-center transition-colors duration-300 ${done ? "bg-[#D97706] text-white" : "bg-[#f5f0e6] text-[#a8a29e]"} ${current ? "ring-4 ring-[#D97706]/20" : ""}`}><s.icon size={18} /></div>
                  <div className={`font-semibold ${done ? "" : "text-[#a8a29e]"}`}>{s.label}</div>
                  {current && <span className="ml-auto text-xs font-bold uppercase tracking-wide text-[#D97706]">In corso</span>}
                </li>
              );
            })}
          </ol>
        )}

        <div className="bg-white border border-[#e7e0d3] rounded-2xl p-5" data-testid="order-recap">
          <div className="font-display text-lg font-bold mb-3">Riepilogo</div>
          <ul className="divide-y divide-[#f0ebe0]">
            {order.items.map((it, i) => (
              <li key={i} className="flex justify-between py-2 text-sm">
                <span>{it.qty}× {it.name}{it.variant ? <span className="text-[#D97706]"> · {it.variant}</span> : ""}</span>
                <span className="tabular-nums">{fmtEur(it.price * it.qty)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between pt-3 mt-1 border-t border-[#e7e0d3] font-display text-xl font-extrabold">
            <span>Totale</span><span className="tabular-nums" data-testid="order-total">{fmtEur(order.total)}</span>
          </div>
          <p className="text-xs text-[#a8a29e] mt-3">Il conto si paga in cassa o al tavolo con il personale.</p>
        </div>

        <Link to={`/r/${slug}/menu${tableCode ? `?t=${tableCode}` : ""}`} className="block text-center h-12 leading-[48px] rounded-xl border border-[#e7e0d3] bg-white font-semibold" data-testid="back-to-menu-link">Torna al menu</Link>
      </div>
    </div>
  );
}
