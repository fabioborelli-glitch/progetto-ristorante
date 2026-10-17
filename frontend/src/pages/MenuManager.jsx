import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { api, errMsg, fmtEur, ALLERGEN_LABELS } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY_ITEM = { category_id: "", name: "", name_en: "", description: "", price: "", allergens: [], variants: [], available: true, image_url: "" };

export default function MenuManager() {
  const { role } = useAuth();
  const canEdit = role === "owner" || role === "manager";
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCat, setActiveCat] = useState("all");
  const [itemOpen, setItemOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [editing, setEditing] = useState(null);
  const [catForm, setCatForm] = useState({ id: null, name: "", name_en: "" });

  const load = useCallback(async () => {
    try {
      const [c, i] = await Promise.all([api.get("/t/menu/categories"), api.get("/t/menu/items")]);
      setCats(c.data);
      setItems(i.data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNewItem = () => { setEditing(null); setForm({ ...EMPTY_ITEM, category_id: activeCat !== "all" ? activeCat : cats[0]?.id || "" }); setItemOpen(true); };
  const openEditItem = (it) => { setEditing(it); setForm({ ...it, price: it.price }); setItemOpen(true); };

  const saveItem = async (e) => {
    e.preventDefault();
    const payload = { ...form, price: parseFloat(form.price), variants: form.variants.filter((v) => v.name).map((v) => ({ name: v.name, price_delta: parseFloat(v.price_delta) || 0 })) };
    try {
      if (editing) await api.patch(`/t/menu/items/${editing.id}`, payload);
      else await api.post("/t/menu/items", payload);
      toast.success(editing ? "Piatto aggiornato" : "Piatto creato");
      setItemOpen(false);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const deleteItem = async (it) => {
    if (!window.confirm(`Eliminare "${it.name}"?`)) return;
    try { await api.delete(`/t/menu/items/${it.id}`); toast.success("Eliminato"); load(); } catch (err) { toast.error(errMsg(err)); }
  };

  const toggleAvail = async (it) => {
    try { await api.patch(`/t/menu/items/${it.id}`, { available: !it.available }); load(); } catch (err) { toast.error(errMsg(err)); }
  };

  const saveCat = async (e) => {
    e.preventDefault();
    try {
      if (catForm.id) await api.patch(`/t/menu/categories/${catForm.id}`, { name: catForm.name, name_en: catForm.name_en });
      else await api.post("/t/menu/categories", { name: catForm.name, name_en: catForm.name_en });
      toast.success("Categoria salvata");
      setCatOpen(false);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const deleteCat = async () => {
    if (!window.confirm("Eliminare la categoria?")) return;
    try { await api.delete(`/t/menu/categories/${catForm.id}`); setCatOpen(false); setActiveCat("all"); load(); } catch (err) { toast.error(errMsg(err)); }
  };

  const visible = activeCat === "all" ? items : items.filter((i) => i.category_id === activeCat);
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-8 max-w-6xl" data-testid="menu-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Menu</h1>
          <p className="text-gray-500 text-sm mt-1">{items.length} piatti in {cats.length} categorie</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" className="h-12" onClick={() => { setCatForm({ id: null, name: "", name_en: "" }); setCatOpen(true); }} data-testid="new-category-btn"><Plus size={16} className="mr-1" />Categoria</Button>
            <Button className="h-12 px-6 bg-[#E03131] hover:bg-[#c42727]" onClick={openNewItem} disabled={cats.length === 0} data-testid="new-item-btn"><Plus size={18} className="mr-2" />Nuovo piatto</Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2" data-testid="category-tabs">
        <CatTab active={activeCat === "all"} onClick={() => setActiveCat("all")} testid="cat-tab-all">Tutti</CatTab>
        {cats.map((c) => (
          <div key={c.id} className="flex items-center">
            <CatTab active={activeCat === c.id} onClick={() => setActiveCat(c.id)} testid={`cat-tab-${c.id}`}>{c.name}</CatTab>
            {canEdit && activeCat === c.id && (
              <button onClick={() => { setCatForm({ id: c.id, name: c.name, name_en: c.name_en || "" }); setCatOpen(true); }} className="ml-1 h-10 w-10 grid place-items-center rounded-full hover:bg-gray-100" data-testid={`edit-cat-${c.id}`}><Pencil size={14} /></button>
            )}
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="menu-items-grid">
        {visible.map((it) => (
          <div key={it.id} className={`bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col transition-transform duration-200 hover:-translate-y-1 ${!it.available ? "opacity-60" : ""}`} data-testid={`menu-item-card-${it.id}`}>
            {it.image_url && <img src={it.image_url} alt={it.name} className="h-36 w-full object-cover" />}
            <div className="p-5 flex-1 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg font-bold leading-tight">{it.name}</div>
                  <div className="text-xs text-gray-500">{cats.find((c) => c.id === it.category_id)?.name}</div>
                </div>
                <div className="font-display text-xl font-extrabold tabular-nums">{fmtEur(it.price)}</div>
              </div>
              {it.description && <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{it.description}</p>}
              {it.allergens?.length > 0 && (
                <div className="flex flex-wrap gap-1">{it.allergens.map((a) => <span key={a} className="text-[11px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full">{ALLERGEN_LABELS[a] || a}</span>)}</div>
              )}
              {it.variants?.length > 0 && <div className="text-xs text-gray-500">{it.variants.length} varianti</div>}
              {canEdit && (
                <div className="mt-auto pt-2 flex items-center justify-between border-t border-gray-100">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={it.available} onCheckedChange={() => toggleAvail(it)} data-testid={`avail-toggle-${it.id}`} />{it.available ? "Disponibile" : "Esaurito"}</label>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEditItem(it)} data-testid={`edit-item-${it.id}`}><Pencil size={16} /></Button>
                    <Button variant="ghost" size="icon" className="text-red-600" onClick={() => deleteItem(it)} data-testid={`delete-item-${it.id}`}><Trash2 size={16} /></Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && <div className="text-gray-500 col-span-full py-10 text-center">Nessun piatto in questa categoria.</div>}
      </div>

      <Sheet open={itemOpen} onOpenChange={setItemOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle className="font-display text-2xl">{editing ? "Modifica piatto" : "Nuovo piatto"}</SheetTitle></SheetHeader>
          <form onSubmit={saveItem} className="space-y-4 mt-6" data-testid="item-form">
            <div className="space-y-1"><Label>Categoria</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger className="h-11" data-testid="item-category-select"><SelectValue placeholder="Scegli" /></SelectTrigger>
                <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Nome (IT)</Label><Input className="h-11" value={form.name} onChange={f("name")} required data-testid="item-name-input" /></div>
              <div className="space-y-1"><Label>Nome (EN)</Label><Input className="h-11" value={form.name_en || ""} onChange={f("name_en")} data-testid="item-name-en-input" /></div>
            </div>
            <div className="space-y-1"><Label>Descrizione</Label><Textarea value={form.description || ""} onChange={f("description")} data-testid="item-description-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Prezzo (€)</Label><Input className="h-11" type="number" step="0.5" min={0} value={form.price} onChange={f("price")} required data-testid="item-price-input" /></div>
              <div className="space-y-1"><Label>URL immagine</Label><Input className="h-11" value={form.image_url || ""} onChange={f("image_url")} placeholder="https://…" data-testid="item-image-input" /></div>
            </div>
            <div className="space-y-2">
              <Label>Allergeni</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(ALLERGEN_LABELS).map(([k, l]) => {
                  const on = form.allergens.includes(k);
                  return <button type="button" key={k} onClick={() => setForm({ ...form, allergens: on ? form.allergens.filter((a) => a !== k) : [...form.allergens, k] })} data-testid={`allergen-${k}`}
                    className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${on ? "bg-amber-500 text-white border-amber-500" : "border-gray-200 hover:bg-gray-50"}`}>{l}</button>;
                })}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Varianti</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, variants: [...form.variants, { name: "", price_delta: 0 }] })} data-testid="add-variant-btn"><Plus size={14} className="mr-1" />Variante</Button>
              </div>
              {form.variants.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="h-10 flex-1" placeholder="Nome variante" value={v.name} onChange={(e) => setForm({ ...form, variants: form.variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} data-testid={`variant-name-${i}`} />
                  <Input className="h-10 w-24" type="number" step="0.5" placeholder="+€" value={v.price_delta} onChange={(e) => setForm({ ...form, variants: form.variants.map((x, j) => (j === i ? { ...x, price_delta: e.target.value } : x)) })} data-testid={`variant-price-${i}`} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setForm({ ...form, variants: form.variants.filter((_, j) => j !== i) })}><X size={14} /></Button>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.available} onCheckedChange={(v) => setForm({ ...form, available: v })} data-testid="item-available-switch" />Disponibile</label>
            <Button type="submit" className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" data-testid="item-submit-btn">{editing ? "Salva" : "Crea piatto"}</Button>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={catOpen} onOpenChange={setCatOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle className="font-display text-2xl">{catForm.id ? "Modifica categoria" : "Nuova categoria"}</SheetTitle></SheetHeader>
          <form onSubmit={saveCat} className="space-y-4 mt-6" data-testid="category-form">
            <div className="space-y-1"><Label>Nome (IT)</Label><Input className="h-11" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} required data-testid="cat-name-input" /></div>
            <div className="space-y-1"><Label>Nome (EN)</Label><Input className="h-11" value={catForm.name_en} onChange={(e) => setCatForm({ ...catForm, name_en: e.target.value })} data-testid="cat-name-en-input" /></div>
            <Button type="submit" className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" data-testid="cat-submit-btn">Salva</Button>
            {catForm.id && <Button type="button" variant="outline" className="w-full h-11 text-red-600 border-red-200" onClick={deleteCat} data-testid="cat-delete-btn">Elimina categoria</Button>}
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CatTab({ active, onClick, children, testid }) {
  return (
    <button onClick={onClick} data-testid={testid} className={`px-4 h-10 rounded-full text-sm font-medium border transition-colors duration-200 ${active ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"}`}>{children}</button>
  );
}
