import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { api, errMsg, fmtEur } from "@/lib/api";

export default function FoodCost() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [sort, setSort] = useState("pct");

  useEffect(() => {
    api.get("/t/food-cost").then((r) => setData(r.data)).catch((e) => { setErr(true); toast.error(errMsg(e)); });
  }, []);

  if (err) return <div className="text-gray-500 py-10" data-testid="foodcost-error">Impossibile caricare il food cost. Riprova.</div>;
  if (!data) return <div className="text-gray-500 py-10" data-testid="foodcost-loading">Caricamento…</div>;

  const pctColor = (p) => p == null ? "text-gray-400" : p <= 30 ? "text-emerald-600" : p <= 40 ? "text-amber-600" : "text-red-600";
  const items = [...data.items].sort((a, b) => {
    if (sort === "pct") return (b.food_cost_pct ?? -1) - (a.food_cost_pct ?? -1);
    if (sort === "margin") {
      if (a.has_recipe !== b.has_recipe) return a.has_recipe ? -1 : 1;
      return (b.margin ?? -999) - (a.margin ?? -999);
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-6 max-w-5xl" data-testid="foodcost-page">
      <div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Food Cost</h1>
        <p className="text-gray-500 text-sm mt-1">Costo ingredienti, margine e incidenza per piatto. Collega le ricette nel Menu per il calcolo.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="foodcost-summary">
        <Card label="Piatti" value={data.summary.total} />
        <Card label="Con ricetta" value={data.summary.with_recipe} tone="emerald" />
        <Card label="Senza ricetta" value={data.summary.without_recipe} tone="amber" />
        <Card label="Food cost medio" value={data.summary.avg_food_cost_pct != null ? `${data.summary.avg_food_cost_pct}%` : "—"} tone="gray" />
      </div>

      <div className="flex gap-2">
        {[["pct", "Food cost %"], ["margin", "Margine"], ["name", "Nome"]].map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)} data-testid={`sort-${k}`}
            className={`px-3 h-9 rounded-full text-sm font-medium border transition-colors ${sort === k ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"}`}>{l}</button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid="foodcost-table">
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-gray-500 border-b border-gray-100">
          <div>Piatto</div><div className="text-right w-20">Prezzo</div><div className="text-right w-20">Costo</div><div className="text-right w-20">Margine</div><div className="text-right w-16">FC%</div>
        </div>
        {items.map((it) => (
          <div key={it.item_id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-3 items-center border-b border-gray-50 last:border-0" data-testid={`foodcost-row-${it.item_id}`}>
            <div className="min-w-0">
              <div className="font-medium truncate flex items-center gap-2">{it.name}{!it.has_recipe && <span className="text-amber-500" title="Nessuna ricetta"><AlertCircle size={14} /></span>}</div>
              <div className="text-xs text-gray-500 truncate">{it.category}</div>
            </div>
            <div className="text-right w-20 tabular-nums">{fmtEur(it.price)}</div>
            <div className="text-right w-20 tabular-nums text-gray-600">{it.has_recipe ? fmtEur(it.cost) : "—"}</div>
            <div className="text-right w-20 tabular-nums">{it.has_recipe ? fmtEur(it.margin) : "—"}</div>
            <div className={`text-right w-16 tabular-nums font-bold ${pctColor(it.food_cost_pct)}`}>{it.food_cost_pct != null ? `${it.food_cost_pct}%` : "—"}</div>
          </div>
        ))}
        {items.length === 0 && <div className="text-gray-500 py-10 text-center text-sm">Nessun piatto.</div>}
      </div>
    </div>
  );
}

function Card({ label, value, tone }) {
  const tones = { emerald: "border-emerald-200 bg-emerald-50", amber: "border-amber-200 bg-amber-50", gray: "border-gray-200 bg-gray-50" };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || "border-gray-200 bg-white"}`}>
      <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">{label}</div>
      <div className="font-display text-2xl font-extrabold mt-1 tabular-nums">{value}</div>
    </div>
  );
}
