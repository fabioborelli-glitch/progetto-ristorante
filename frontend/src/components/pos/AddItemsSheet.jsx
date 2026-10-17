import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { api, errMsg, fmtEur } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export function AddItemsSheet({ open, onClose, bill, onChanged }) {
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [kitchen, setKitchen] = useState(true);
  const [picking, setPicking] = useState(null);

  useEffect(() => {
    if (!open) return;
    Promise.all([api.get("/t/menu/categories"), api.get("/t/menu/items")]).then(([c, i]) => {
      setCats(c.data);
      setItems(i.data.filter((x) => x.available));
    });
  }, [open]);

  const add = async (item, variant) => {
    try {
      const { data } = await api.post(`/t/bills/${bill.id}/items`, { item_id: item.id, qty: 1, variant: variant?.name || null, send_to_kitchen: kitchen });
      onChanged(data);
      toast.success(`${item.name} aggiunto`);
      setPicking(null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const visible = items.filter((i) => (cat === "all" || i.category_id === cat) && i.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl w-full overflow-y-auto" data-testid="add-items-sheet">
        <SheetHeader><SheetTitle className="font-display text-2xl">Aggiungi al conto · Tavolo {bill.table_name}</SheetTitle></SheetHeader>
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1"><Search size={16} className="absolute left-3 top-3.5 text-gray-400" /><Input className="h-11 pl-9" placeholder="Cerca piatto…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="add-items-search" /></div>
            <label className="flex items-center gap-2 text-sm whitespace-nowrap"><Switch checked={kitchen} onCheckedChange={setKitchen} data-testid="add-items-kitchen-switch" />Invia in cucina</label>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Tab active={cat === "all"} onClick={() => setCat("all")}>Tutti</Tab>
            {cats.map((c) => <Tab key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</Tab>)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {visible.map((it) => (
              <button key={it.id} onClick={() => (it.variants?.length ? setPicking(it) : add(it, null))} data-testid={`pos-add-item-${it.id}`}
                className="min-h-[72px] rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-gray-900 active:scale-95 transition-transform flex flex-col justify-between">
                <div className="text-sm font-semibold leading-tight line-clamp-2">{it.name}</div>
                <div className="text-sm text-gray-500 tabular-nums mt-1">{fmtEur(it.price)}{it.variants?.length ? " · varianti" : ""}</div>
              </button>
            ))}
          </div>
          {picking && (
            <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-6" onClick={() => setPicking(null)}>
              <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-2" onClick={(e) => e.stopPropagation()} data-testid="pos-variant-picker">
                <div className="font-display text-xl font-bold mb-3">{picking.name}</div>
                <button onClick={() => add(picking, null)} className="w-full h-12 rounded-lg border border-gray-200 px-4 flex justify-between items-center font-medium hover:bg-gray-50" data-testid="pos-variant-base">Classico <span>{fmtEur(picking.price)}</span></button>
                {picking.variants.map((v) => (
                  <button key={v.name} onClick={() => add(picking, v)} className="w-full h-12 rounded-lg border border-gray-200 px-4 flex justify-between items-center font-medium hover:bg-gray-50" data-testid={`pos-variant-${v.name}`}>{v.name} <span>{fmtEur(picking.price + v.price_delta)}</span></button>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Tab({ active, onClick, children }) {
  return <button onClick={onClick} className={`whitespace-nowrap px-3 h-9 rounded-full text-xs font-medium border ${active ? "bg-gray-900 text-white border-gray-900" : "border-gray-200"}`}>{children}</button>;
}
