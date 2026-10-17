import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { ShoppingBag, Plus, Minus, X, Info } from "lucide-react";
import { api, errMsg, fmtEur, ALLERGEN_LABELS } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

export default function CustomerMenu() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const tableCode = params.get("t");
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [activeCat, setActiveCat] = useState(null);
  const [picking, setPicking] = useState(null);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get(`/public/${slug}/menu`, { params: tableCode ? { table: tableCode } : {} })
      .then((r) => { setData(r.data); setActiveCat(r.data.categories[0]?.id); })
      .catch((e) => setError(errMsg(e)));
  }, [slug, tableCode]);

  const total = useMemo(() => cart.reduce((a, l) => a + l.price * l.qty, 0), [cart]);
  const count = cart.reduce((a, l) => a + l.qty, 0);

  const addLine = (item, variant, lineNotes) => {
    const price = item.price + (variant?.price_delta || 0);
    const key = `${item.id}|${variant?.name || ""}|${lineNotes || ""}`;
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      if (ex) return c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key, item_id: item.id, name: item.name, variant: variant?.name || null, notes: lineNotes || "", price, qty: 1 }];
    });
    setPicking(null);
  };

  const changeQty = (key, d) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));

  const send = async () => {
    setSending(true);
    try {
      const { data: order } = await api.post(`/public/${slug}/orders`, {
        table_code: tableCode, customer_name: name, notes,
        lines: cart.map((l) => ({ item_id: l.item_id, qty: l.qty, variant: l.variant, notes: l.notes })),
      });
      setCart([]);
      navigate(`/r/${slug}/ordine/${order.id}?t=${tableCode}`);
    } catch (e) {
      setError(errMsg(e));
      setSending(false);
    }
  };

  if (error && !data) return <div className="min-h-screen grid place-items-center bg-[#FDFBF7] text-[#292524] p-6 text-center" data-testid="menu-error">{error}</div>;
  if (!data) return <div className="min-h-screen bg-[#FDFBF7]" />;

  const scrollTo = (id) => { setActiveCat(id); document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#292524] pb-28" data-testid="customer-menu-page">
      <header className="px-5 pt-8 pb-4 max-w-2xl mx-auto">
        <div className="text-xs uppercase tracking-widest text-[#D97706] font-bold">Menu digitale</div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight leading-none mt-1" data-testid="menu-restaurant-name">{data.restaurant.name}</h1>
        {data.table ? (
          <div className="mt-3 inline-flex items-center gap-2 bg-[#292524] text-white text-sm px-3 py-1.5 rounded-full" data-testid="menu-table-badge">Tavolo {data.table.name}</div>
        ) : (
          <div className="mt-3 text-sm text-[#78716c] inline-flex items-center gap-1.5" data-testid="menu-no-table"><Info size={14} />Solo consultazione — inquadra il QR sul tavolo per ordinare.</div>
        )}
      </header>

      <nav className="sticky top-0 z-10 bg-[#FDFBF7]/95 backdrop-blur border-b border-[#e7e0d3]">
        <div className="max-w-2xl mx-auto flex gap-2 overflow-x-auto px-5 py-3 no-scrollbar" data-testid="menu-category-nav">
          {data.categories.map((c) => (
            <button key={c.id} onClick={() => scrollTo(c.id)} data-testid={`menu-cat-${c.id}`}
              className={`whitespace-nowrap h-10 px-4 rounded-full text-sm font-semibold border transition-colors duration-200 ${activeCat === c.id ? "bg-[#292524] text-white border-[#292524]" : "bg-white border-[#e7e0d3]"}`}>
              {c.name}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-10">
        {data.categories.map((c) => {
          const items = data.items.filter((i) => i.category_id === c.id);
          if (items.length === 0) return null;
          return (
            <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-20">
              <h2 className="font-display text-2xl font-extrabold mb-4">{c.name}</h2>
              <div className="space-y-3">
                {items.map((it) => (
                  <div key={it.id} className="bg-white border border-[#e7e0d3] rounded-2xl p-4 flex gap-4" data-testid={`menu-item-${it.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-lg leading-tight">{it.name}</div>
                      {it.description && <p className="text-sm text-[#78716c] mt-1 leading-relaxed">{it.description}</p>}
                      {it.allergens?.length > 0 && <div className="text-[11px] text-[#a8a29e] mt-2">Allergeni: {it.allergens.map((a) => ALLERGEN_LABELS[a] || a).join(", ")}</div>}
                      <div className="mt-3 flex items-center justify-between">
                        <div className="font-display text-xl font-extrabold tabular-nums">{fmtEur(it.price)}</div>
                        {data.table && (
                          <button onClick={() => (it.variants?.length ? setPicking(it) : addLine(it, null, ""))} data-testid={`add-item-${it.id}`}
                            className="h-11 px-5 rounded-full bg-[#D97706] text-white font-semibold inline-flex items-center gap-1.5 active:scale-95 transition-transform"><Plus size={16} />Aggiungi</button>
                        )}
                      </div>
                    </div>
                    {it.image_url && <img src={it.image_url} alt={it.name} className="h-24 w-24 rounded-xl object-cover shrink-0" />}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </main>

      {data.table && count > 0 && (
        <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-[#FDFBF7] via-[#FDFBF7] to-transparent">
          <button onClick={() => setCartOpen(true)} data-testid="open-cart-btn"
            className="max-w-2xl mx-auto w-full h-16 rounded-2xl bg-[#292524] text-white flex items-center justify-between px-6 shadow-xl active:scale-[0.98] transition-transform">
            <span className="inline-flex items-center gap-3 font-semibold"><span className="h-8 w-8 rounded-full bg-[#D97706] grid place-items-center text-sm font-bold">{count}</span>Vedi carrello</span>
            <span className="font-display text-xl font-extrabold tabular-nums">{fmtEur(total)}</span>
          </button>
        </div>
      )}

      <Drawer open={!!picking} onOpenChange={(o) => !o && setPicking(null)}>
        <DrawerContent className="bg-[#FDFBF7]">
          {picking && (
            <div className="max-w-2xl mx-auto w-full p-6 space-y-4" data-testid="variant-picker">
              <DrawerHeader className="p-0"><DrawerTitle className="font-display text-2xl">{picking.name}</DrawerTitle></DrawerHeader>
              <p className="text-sm text-[#78716c]">Scegli una variante</p>
              <div className="space-y-2">
                <button onClick={() => addLine(picking, null, "")} className="w-full h-14 rounded-xl bg-white border border-[#e7e0d3] px-4 flex justify-between items-center font-medium" data-testid="variant-base">Classico <span>{fmtEur(picking.price)}</span></button>
                {picking.variants.map((v) => (
                  <button key={v.name} onClick={() => addLine(picking, v, "")} className="w-full h-14 rounded-xl bg-white border border-[#e7e0d3] px-4 flex justify-between items-center font-medium" data-testid={`variant-${v.name}`}>
                    {v.name} <span>{fmtEur(picking.price + v.price_delta)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <Drawer open={cartOpen} onOpenChange={setCartOpen}>
        <DrawerContent className="bg-[#FDFBF7] max-h-[92vh]">
          <div className="max-w-2xl mx-auto w-full p-6 space-y-5 overflow-y-auto" data-testid="cart-drawer">
            <DrawerHeader className="p-0 flex-row items-center justify-between">
              <DrawerTitle className="font-display text-2xl flex items-center gap-2"><ShoppingBag size={20} />Il tuo ordine · Tavolo {data.table?.name}</DrawerTitle>
              <button onClick={() => setCartOpen(false)} className="h-10 w-10 grid place-items-center rounded-full bg-white border border-[#e7e0d3]"><X size={18} /></button>
            </DrawerHeader>
            <div className="space-y-3">
              {cart.map((l) => (
                <div key={l.key} className="bg-white border border-[#e7e0d3] rounded-xl p-3 flex items-center gap-3" data-testid={`cart-line-${l.item_id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{l.name}</div>
                    {l.variant && <div className="text-xs text-[#D97706]">{l.variant}</div>}
                    <div className="text-sm text-[#78716c]">{fmtEur(l.price)}</div>
                  </div>
                  <div className="flex items-center gap-1 bg-[#f5f0e6] rounded-full">
                    <button onClick={() => changeQty(l.key, -1)} className="h-10 w-10 grid place-items-center" data-testid={`cart-minus-${l.item_id}`}><Minus size={16} /></button>
                    <span className="w-6 text-center font-bold tabular-nums">{l.qty}</span>
                    <button onClick={() => changeQty(l.key, 1)} className="h-10 w-10 grid place-items-center" data-testid={`cart-plus-${l.item_id}`}><Plus size={16} /></button>
                  </div>
                </div>
              ))}
              {cart.length === 0 && <div className="text-center text-[#78716c] py-6">Il carrello è vuoto.</div>}
            </div>
            <Input placeholder="Il tuo nome (opzionale)" className="h-12 bg-white" value={name} onChange={(e) => setName(e.target.value)} data-testid="cart-name" />
            <Textarea placeholder="Note per la cucina (allergie, cotture…)" className="bg-white" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="cart-notes" />
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="cart-error">{error}</div>}
            <Button onClick={send} disabled={sending || cart.length === 0} className="w-full h-14 text-lg bg-[#D97706] hover:bg-[#b45309]" data-testid="send-order-btn">
              {sending ? "Invio…" : `Invia ordine · ${fmtEur(total)}`}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
