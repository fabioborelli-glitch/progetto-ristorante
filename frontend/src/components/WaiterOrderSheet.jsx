import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Send, Minus, Plus, X } from "lucide-react";
import { api, errMsg, fmtEur } from "@/lib/api";
import { newClientId } from "@/lib/offline";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function WaiterOrderSheet({ open, onClose, table, onSent }) {
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState([]);
  const [notes, setNotes] = useState("");
  const [picking, setPicking] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCart([]); setNotes(""); setQ(""); setCat("all");
    Promise.all([api.get("/t/menu/categories"), api.get("/t/menu/items")])
      .then(([c, i]) => { setCats(c.data); setItems(i.data.filter((x) => x.available)); })
      .catch((e) => toast.error(errMsg(e)));
  }, [open]);

  const add = (item, variant) => {
    const key = `${item.id}|${variant?.name || ""}`;
    setCart((c) => c.some((l) => l.key === key)
      ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
      : [...c, { key, item_id: item.id, name: item.name, variant: variant?.name || null, price: item.price + (variant?.price_delta || 0), qty: 1, notes: "" }]);
    setPicking(null);
  };
  const change = (key, d) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));
  const setLineNote = (key, v) => setCart((c) => c.map((l) => (l.key === key ? { ...l, notes: v } : l)));
  const total = useMemo(() => cart.reduce((a, l) => a + l.qty * l.price, 0), [cart]);

  const send = async () => {
    setSending(true);
    try {
      const res = await api.post("/t/orders", { table_id: table.id, notes, client_id: newClientId(), lines: cart.map((l) => ({ item_id: l.item_id, qty: l.qty, variant: l.variant, notes: l.notes })) });
      toast.success(res.queued ? `Comanda salvata offline · Tavolo ${table.name}` : `Comanda inviata in cucina · Tavolo ${table.name}`);
      onSent?.(res.data);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSending(false);
    }
  };

  const visible = items.filter((i) => (cat === "all" || i.category_id === cat) && i.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-3xl w-full p-0 flex flex-col" data-testid="waiter-order-sheet">
        <SheetHeader className="px-6 pt-6"><SheetTitle className="font-display text-2xl">Comanda · Tavolo {table?.name}</SheetTitle></SheetHeader>
        <div className="flex-1 min-h-0 grid md:grid-cols-[1fr_300px]">
          <div className="min-h-0 flex flex-col px-6 pb-4 gap-3">
            <div className="relative"><Search size={16} className="absolute left-3 top-3.5 text-gray-400" /><Input className="h-11 pl-9" placeholder="Cerca piatto…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="waiter-search" /></div>
            <div className="flex gap-2 overflow-x-auto pb-1 shrink-0">
              <Tab active={cat === "all"} onClick={() => setCat("all")}>Tutti</Tab>
              {cats.map((c) => <Tab key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</Tab>)}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-y-auto">
              {visible.map((it) => (
                <button key={it.id} onClick={() => (it.variants?.length ? setPicking(it) : add(it, null))} data-testid={`waiter-add-${it.id}`}
                  className="min-h-[72px] rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-gray-900 active:scale-95 transition-transform flex flex-col justify-between">
                  <div className="text-sm font-semibold leading-tight line-clamp-2">{it.name}</div>
                  <div className="text-sm text-gray-500 tabular-nums mt-1">{fmtEur(it.price)}{it.variants?.length ? " · varianti" : ""}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="border-t md:border-t-0 md:border-l border-gray-200 bg-gray-50 flex flex-col min-h-0" data-testid="waiter-cart">
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {cart.length === 0 && <div className="text-sm text-gray-400 text-center py-8">Tocca i piatti per aggiungerli</div>}
              {cart.map((l) => (
                <div key={l.key} className="bg-white border border-gray-200 rounded-lg p-2.5 space-y-1.5" data-testid={`waiter-line-${l.item_id}`}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{l.name}</div>{l.variant && <div className="text-xs text-amber-700">{l.variant}</div>}</div>
                    <div className="flex items-center bg-gray-100 rounded-full">
                      <button onClick={() => change(l.key, -1)} className="h-9 w-9 grid place-items-center" data-testid={`waiter-minus-${l.item_id}`}><Minus size={14} /></button>
                      <span className="w-6 text-center font-bold tabular-nums">{l.qty}</span>
                      <button onClick={() => change(l.key, 1)} className="h-9 w-9 grid place-items-center" data-testid={`waiter-plus-${l.item_id}`}><Plus size={14} /></button>
                    </div>
                  </div>
                  <Input className="h-8 text-xs" placeholder="Nota (es. senza cipolla)" value={l.notes} onChange={(e) => setLineNote(l.key, e.target.value)} data-testid={`waiter-note-${l.item_id}`} />
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-gray-200 space-y-3">
              <Textarea placeholder="Nota per la cucina" className="bg-white text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="waiter-notes" />
              <Button className="w-full h-14 text-base font-bold bg-[#E03131] hover:bg-[#c42727] active:scale-[0.98] transition-transform" disabled={cart.length === 0 || sending} onClick={send} data-testid="waiter-send-btn">
                <Send size={18} className="mr-2" />{sending ? "Invio…" : `Invia in cucina · ${fmtEur(total)}`}
              </Button>
            </div>
          </div>
        </div>
        {picking && (
          <div className="absolute inset-0 z-50 bg-black/40 grid place-items-center p-6" onClick={() => setPicking(null)}>
            <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-2" onClick={(e) => e.stopPropagation()} data-testid="waiter-variant-picker">
              <div className="flex items-center justify-between mb-2"><div className="font-display text-xl font-bold">{picking.name}</div><button onClick={() => setPicking(null)}><X size={18} /></button></div>
              <button onClick={() => add(picking, null)} className="w-full h-12 rounded-lg border border-gray-200 px-4 flex justify-between items-center font-medium hover:bg-gray-50" data-testid="waiter-variant-base">Classico <span>{fmtEur(picking.price)}</span></button>
              {picking.variants.map((v) => (
                <button key={v.name} onClick={() => add(picking, v)} className="w-full h-12 rounded-lg border border-gray-200 px-4 flex justify-between items-center font-medium hover:bg-gray-50" data-testid={`waiter-variant-${v.name}`}>{v.name} <span>{fmtEur(picking.price + v.price_delta)}</span></button>
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Tab({ active, onClick, children }) {
  return <button onClick={onClick} className={`whitespace-nowrap px-3 h-9 rounded-full text-xs font-medium border ${active ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 bg-white"}`}>{children}</button>;
}
