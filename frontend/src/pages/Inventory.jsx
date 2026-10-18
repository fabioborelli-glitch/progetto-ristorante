import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Search, Truck, ClipboardList, Pencil, Trash2, PackagePlus, PackageMinus, AlertTriangle, Users, FileText, Loader2 } from "lucide-react";
import { api, errMsg, fmtEur } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY = { name: "", category: "Altro", unit: "pz", cost_per_unit: "", quantity: "", min_stock: "", par_stock: "", barcode: "", supplier_id: null, not_in_pos: false };
const MOV_LABEL = { carico: "Carico", scarico: "Scarico", spreco: "Spreco", rettifica: "Rettifica", vendita: "Vendita", reso: "Reso" };

export default function Inventory() {
  const { role } = useAuth();
  const canEdit = role === "owner" || role === "manager";
  const [cats, setCats] = useState([]);
  const [units, setUnits] = useState(["pz", "kg", "g", "l", "ml", "bt"]);
  const [suppliers, setSuppliers] = useState([]);
  const [stats, setStats] = useState(null);
  const [list, setList] = useState([]);
  const [activeCat, setActiveCat] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [movements, setMovements] = useState([]);
  const [suppOpen, setSuppOpen] = useState(false);
  const [recvOpen, setRecvOpen] = useState(false);
  const [recv, setRecv] = useState({ supplier_id: null, note: "", lines: [] });
  const [mov, setMov] = useState({ type: "carico", qty: "", note: "" });
  const [countOpen, setCountOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);

  const loadMeta = useCallback(async () => {
    try {
      const [c, u, s] = await Promise.all([api.get("/t/inventory/categories"), api.get("/t/inventory/units"), api.get("/t/suppliers")]);
      setCats(c.data); setUnits(u.data); setSuppliers(s.data);
    } catch (e) { toast.error(errMsg(e)); }
  }, []);

  const loadStats = useCallback(async () => {
    try { setStats((await api.get("/t/ingredients/stats")).data); } catch (e) { /* noop */ }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const params = {};
      if (activeCat !== "all") params.category = activeCat;
      if (activeFilter !== "all") params.filter = activeFilter;
      if (q) params.q = q;
      setList((await api.get("/t/ingredients", { params })).data);
    } catch (e) { toast.error(errMsg(e)); }
  }, [activeCat, activeFilter, q]);

  useEffect(() => { loadMeta(); loadStats(); }, [loadMeta, loadStats]);
  useEffect(() => { const t = setTimeout(loadList, 200); return () => clearTimeout(t); }, [loadList]);

  const refresh = () => { loadList(); loadStats(); };

  const openNew = () => { setEditing(null); setForm({ ...EMPTY, category: activeCat !== "all" ? activeCat : "Altro" }); setMovements([]); setItemOpen(true); };
  const openEdit = async (it) => {
    setEditing(it);
    setForm({ ...it, cost_per_unit: it.cost_per_unit ?? "", quantity: it.quantity ?? 0, min_stock: it.min_stock ?? "", par_stock: it.par_stock ?? "", supplier_id: it.supplier_id || null });
    setMov({ type: "carico", qty: "", note: "" });
    setItemOpen(true);
    try { setMovements((await api.get(`/t/ingredients/${it.id}/movements`)).data); } catch { setMovements([]); }
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = {
      name: form.name, category: form.category, unit: form.unit,
      cost_per_unit: parseFloat(form.cost_per_unit) || 0,
      min_stock: parseFloat(form.min_stock) || 0, par_stock: parseFloat(form.par_stock) || 0,
      barcode: form.barcode || "", supplier_id: form.supplier_id || null, not_in_pos: !!form.not_in_pos,
    };
    try {
      if (editing) await api.patch(`/t/ingredients/${editing.id}`, payload);
      else await api.post("/t/ingredients", { ...payload, quantity: parseFloat(form.quantity) || 0 });
      toast.success(editing ? "Ingrediente aggiornato" : "Ingrediente creato");
      setItemOpen(false); refresh();
    } catch (err) { toast.error(errMsg(err)); }
  };

  const del = async (it) => {
    if (!window.confirm(`Eliminare "${it.name}"?`)) return;
    try { await api.delete(`/t/ingredients/${it.id}`); toast.success("Eliminato"); setItemOpen(false); refresh(); } catch (err) { toast.error(errMsg(err)); }
  };

  const applyMovement = async () => {
    if (!mov.qty) return;
    try {
      const upd = (await api.post(`/t/ingredients/${editing.id}/movement`, { type: mov.type, qty: parseFloat(mov.qty), note: mov.note })).data;
      setForm((f) => ({ ...f, quantity: upd.quantity }));
      setMov({ type: "carico", qty: "", note: "" });
      setMovements((await api.get(`/t/ingredients/${editing.id}/movements`)).data);
      toast.success("Movimento registrato"); loadList(); loadStats();
    } catch (err) { toast.error(errMsg(err)); }
  };

  const reorderList = list.filter((i) => (i.min_stock || 0) > 0 && (i.quantity || 0) < (i.min_stock || 0));
  const startReceiveReorder = () => {
    setRecv({ supplier_id: null, note: "Riordino scorte", lines: reorderList.map((i) => ({ ingredient_id: i.id, name: i.name, unit: i.unit, qty: Math.max((i.par_stock || i.min_stock) - (i.quantity || 0), 0) })) });
    setRecvOpen(true);
  };
  const openReceive = () => { setRecv({ supplier_id: null, note: "", lines: [] }); setRecvOpen(true); };
  const submitReceive = async () => {
    const lines = recv.lines.filter((l) => l.qty > 0).map((l) => ({ ingredient_id: l.ingredient_id, qty: parseFloat(l.qty), ...(l.cost !== "" && l.cost != null ? { cost_per_unit: parseFloat(l.cost) } : {}) }));
    if (!lines.length) { toast.error("Aggiungi almeno un articolo"); return; }
    try { await api.post("/t/inventory/receive", { supplier_id: recv.supplier_id, note: recv.note, lines }); toast.success("Merce ricevuta"); setRecvOpen(false); refresh(); } catch (err) { toast.error(errMsg(err)); }
  };

  return (
    <div className="space-y-6 max-w-6xl" data-testid="inventory-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Magazzino</h1>
          <p className="text-gray-500 text-sm mt-1">Si scarica da solo con le vendite della cassa. Tocca un ingrediente per correggere la giacenza.</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-12" onClick={() => setSuppOpen(true)} data-testid="suppliers-btn"><Users size={16} className="mr-1" />Fornitori</Button>
            <Button variant="outline" className="h-12" onClick={() => setCountOpen(true)} data-testid="count-btn"><ClipboardList size={16} className="mr-1" />Conteggio</Button>
            <Button variant="outline" className="h-12" onClick={() => setInvOpen(true)} data-testid="invoice-btn"><FileText size={16} className="mr-1" />Scansiona fattura</Button>
            <Button variant="outline" className="h-12" onClick={openReceive} data-testid="receive-btn"><Truck size={16} className="mr-1" />Registra consegna</Button>
            <Button className="h-12 px-6 bg-[#E03131] hover:bg-[#c42727]" onClick={openNew} data-testid="new-ingredient-btn"><Plus size={18} className="mr-2" />Nuovo ingrediente</Button>
          </div>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="inventory-stats">
          <StatCard label="Da riordinare" value={stats.reorder_count} sub={`stima ${fmtEur(stats.reorder_value)}`} tone="amber" action={canEdit && stats.reorder_count > 0 ? { label: "Prepara ordine", onClick: startReceiveReorder } : null} testid="stat-reorder" />
          <StatCard label="Scorta bassa" value={stats.low_count} sub="sotto la soglia minima" tone="red" testid="stat-low" />
          <StatCard label="Sprechi 30gg" value={fmtEur(stats.waste_30d)} sub="scarti e rettifiche" tone="gray" testid="stat-waste" />
          <StatCard label="Valore magazzino" value={fmtEur(stats.stock_value)} sub="ai costi attuali" tone="emerald" testid="stat-value" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input className="h-11 pl-9" placeholder="Cerca ingrediente, fornitore o codice a barre" value={q} onChange={(e) => setQ(e.target.value)} data-testid="inventory-search" />
        </div>
        {["all", "low", "reorder", "not_in_pos"].map((fl) => (
          <button key={fl} onClick={() => setActiveFilter(fl)} data-testid={`filter-${fl}`}
            className={`px-3 h-11 rounded-full text-sm font-medium border transition-colors ${activeFilter === fl ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
            {{ all: "Tutti", low: "Scorta bassa", reorder: "Da riordinare", not_in_pos: "Non in cassa" }[fl]}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 md:flex-wrap md:overflow-visible" data-testid="inventory-cat-tabs">
        <CatTab active={activeCat === "all"} onClick={() => setActiveCat("all")}>Tutti</CatTab>
        {cats.map((c) => <CatTab key={c} active={activeCat === c} onClick={() => setActiveCat(c)}>{c}{stats?.by_category?.[c] ? ` ${stats.by_category[c]}` : ""}</CatTab>)}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100" data-testid="ingredient-list">
        {list.map((i) => {
          const low = (i.min_stock || 0) > 0 && (i.quantity || 0) <= (i.min_stock || 0);
          return (
            <button key={i.id} onClick={() => openEdit(i)} data-testid={`ingredient-row-${i.id}`}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${low ? "bg-red-500" : "bg-emerald-500"}`} />
                <div className="min-w-0">
                  <div className="font-medium truncate">{i.name}</div>
                  <div className="text-xs text-gray-500 truncate">{i.cost_per_unit ? `${fmtEur(i.cost_per_unit)}/${i.unit}` : "—"}{i.supplier_name ? ` · ${i.supplier_name}` : ""}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`font-display font-bold tabular-nums ${low ? "text-red-600" : ""}`}>{(i.quantity ?? 0).toLocaleString("it-IT")} <span className="text-xs text-gray-400">{i.unit}</span></div>
                {(i.min_stock || 0) > 0 && <div className="text-[11px] text-gray-400">min {i.min_stock}</div>}
              </div>
            </button>
          );
        })}
        {list.length === 0 && <div className="text-gray-500 py-10 text-center text-sm">Nessun ingrediente.</div>}
      </div>

      {/* Ingredient sheet */}
      <Sheet open={itemOpen} onOpenChange={setItemOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle className="font-display text-2xl">{editing ? form.name : "Nuovo ingrediente"}</SheetTitle></SheetHeader>
          {canEdit ? (
          <form onSubmit={save} className="space-y-4 mt-6" data-testid="ingredient-form">
            <div className="space-y-1"><Label>Nome</Label><Input className="h-11" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="ingredient-name-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="h-11" data-testid="ingredient-category-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Unità</Label>
                <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                  <SelectTrigger className="h-11" data-testid="ingredient-unit-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Costo per unità (€)</Label><Input className="h-11" type="number" step="0.01" min={0} value={form.cost_per_unit} onChange={(e) => setForm({ ...form, cost_per_unit: e.target.value })} data-testid="ingredient-cost-input" /></div>
              {!editing && <div className="space-y-1"><Label>Giacenza iniziale</Label><Input className="h-11" type="number" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} data-testid="ingredient-qty-input" /></div>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Scorta minima</Label><Input className="h-11" type="number" step="0.01" min={0} value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} data-testid="ingredient-min-input" /></div>
              <div className="space-y-1"><Label>Scorta ideale (par)</Label><Input className="h-11" type="number" step="0.01" min={0} value={form.par_stock} onChange={(e) => setForm({ ...form, par_stock: e.target.value })} data-testid="ingredient-par-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Fornitore</Label>
                <Select value={form.supplier_id || "none"} onValueChange={(v) => setForm({ ...form, supplier_id: v === "none" ? null : v })}>
                  <SelectTrigger className="h-11" data-testid="ingredient-supplier-select"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Nessuno</SelectItem>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Codice a barre</Label><Input className="h-11" value={form.barcode || ""} onChange={(e) => setForm({ ...form, barcode: e.target.value })} data-testid="ingredient-barcode-input" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={!!form.not_in_pos} onCheckedChange={(v) => setForm({ ...form, not_in_pos: v })} data-testid="ingredient-notpos-switch" />Non collegato alla cassa</label>
            <Button type="submit" className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" data-testid="ingredient-submit-btn">{editing ? "Salva modifiche" : "Crea ingrediente"}</Button>
          </form>
          ) : editing && (
            <div className="mt-6 text-sm text-gray-600 space-y-1" data-testid="ingredient-readonly">
              <div>Categoria: <b>{form.category}</b></div>
              <div>Costo: <b>{form.cost_per_unit ? `${fmtEur(form.cost_per_unit)}/${form.unit}` : "—"}</b></div>
              {form.supplier_name && <div>Fornitore: <b>{form.supplier_name}</b></div>}
            </div>
          )}

          {editing && (
            <div className="mt-6 pt-6 border-t border-gray-200 space-y-4">
              <div className="flex items-end justify-between">
                <div className="text-sm text-gray-500">Giacenza attuale</div>
                <div className="font-display text-2xl font-extrabold tabular-nums" data-testid="ingredient-current-qty">{(form.quantity ?? 0).toLocaleString("it-IT")} {form.unit}</div>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <div className="grid grid-cols-2 gap-2">
                  <Select value={mov.type} onValueChange={(v) => setMov({ ...mov, type: v })}>
                    <SelectTrigger className="h-11" data-testid="movement-type-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="carico">Carico (+)</SelectItem>
                      <SelectItem value="scarico">Scarico (−)</SelectItem>
                      <SelectItem value="spreco">Spreco (−)</SelectItem>
                      <SelectItem value="reso">Reso (+)</SelectItem>
                      <SelectItem value="rettifica">Conteggio (=)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="h-11" type="number" step="0.01" placeholder="Quantità" value={mov.qty} onChange={(e) => setMov({ ...mov, qty: e.target.value })} data-testid="movement-qty-input" />
                </div>
                <Button type="button" className="h-11" onClick={applyMovement} data-testid="movement-apply-btn">Applica</Button>
              </div>
              <div className="space-y-1.5" data-testid="movement-history">
                {movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-xs text-gray-600 border border-gray-100 rounded-lg px-3 py-2">
                    <span>{MOV_LABEL[m.type] || m.type}{m.note ? ` · ${m.note}` : ""}</span>
                    <span className={`tabular-nums font-medium ${m.delta < 0 ? "text-red-600" : "text-emerald-600"}`}>{m.delta > 0 ? "+" : ""}{m.delta} → {m.after}</span>
                  </div>
                ))}
                {movements.length === 0 && <div className="text-xs text-gray-400">Nessun movimento.</div>}
              </div>
              <Button type="button" variant="outline" className="w-full h-11 text-red-600 border-red-200" onClick={() => del(editing)} data-testid="ingredient-delete-btn" disabled={!canEdit} hidden={!canEdit}><Trash2 size={16} className="mr-2" />Elimina ingrediente</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <SuppliersSheet open={suppOpen} onOpenChange={setSuppOpen} suppliers={suppliers} reload={async () => setSuppliers((await api.get("/t/suppliers")).data)} canEdit={canEdit} />
      <ReceiveSheet open={recvOpen} onOpenChange={setRecvOpen} recv={recv} setRecv={setRecv} suppliers={suppliers} ingredients={list} submit={submitReceive} />
      <CountSheet open={countOpen} onOpenChange={setCountOpen} onDone={refresh} />
      <InvoiceSheet open={invOpen} onOpenChange={setInvOpen} cats={cats} onDone={() => { refresh(); loadMeta(); }} />
    </div>
  );
}

function StatCard({ label, value, sub, tone, action, testid }) {
  const tones = { amber: "border-amber-200 bg-amber-50", red: "border-red-200 bg-red-50", emerald: "border-emerald-200 bg-emerald-50", gray: "border-gray-200 bg-gray-50" };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.gray}`} data-testid={testid}>
      <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">{label}</div>
      <div className="font-display text-2xl font-extrabold mt-1 tabular-nums">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
      {action && <button onClick={action.onClick} className="mt-2 text-xs font-semibold text-[#E03131] hover:underline" data-testid="stat-action-btn">{action.label} →</button>}
    </div>
  );
}

function CatTab({ active, onClick, children }) {
  return <button onClick={onClick} className={`shrink-0 whitespace-nowrap px-4 h-10 rounded-full text-sm font-medium border transition-colors ${active ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"}`}>{children}</button>;
}

function SuppliersSheet({ open, onOpenChange, suppliers, reload, canEdit }) {
  const [f, setF] = useState({ id: null, name: "", phone: "", email: "", notes: "" });
  const save = async (e) => {
    e.preventDefault();
    try {
      if (f.id) await api.patch(`/t/suppliers/${f.id}`, { name: f.name, phone: f.phone, email: f.email, notes: f.notes });
      else await api.post("/t/suppliers", { name: f.name, phone: f.phone, email: f.email, notes: f.notes });
      toast.success("Fornitore salvato"); setF({ id: null, name: "", phone: "", email: "", notes: "" }); reload();
    } catch (err) { toast.error(errMsg(err)); }
  };
  const del = async (s) => { if (!window.confirm(`Eliminare ${s.name}?`)) return; try { await api.delete(`/t/suppliers/${s.id}`); reload(); } catch (err) { toast.error(errMsg(err)); } };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle className="font-display text-2xl">Fornitori</SheetTitle></SheetHeader>
        {canEdit && (
          <form onSubmit={save} className="space-y-3 mt-6" data-testid="supplier-form">
            <Input className="h-11" placeholder="Nome fornitore" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="supplier-name-input" />
            <div className="grid grid-cols-2 gap-2">
              <Input className="h-11" placeholder="Telefono" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
              <Input className="h-11" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </div>
            <Button type="submit" className="w-full h-11 bg-[#E03131] hover:bg-[#c42727]" data-testid="supplier-submit-btn">{f.id ? "Salva" : "Aggiungi fornitore"}</Button>
            {f.id && <Button type="button" variant="ghost" className="w-full" onClick={() => setF({ id: null, name: "", phone: "", email: "", notes: "" })}>Annulla</Button>}
          </form>
        )}
        <div className="mt-6 space-y-2" data-testid="supplier-list">
          {suppliers.map((s) => (
            <div key={s.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2">
              <div><div className="font-medium text-sm">{s.name}</div><div className="text-xs text-gray-500">{[s.phone, s.email].filter(Boolean).join(" · ")}</div></div>
              {canEdit && <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => setF({ id: s.id, name: s.name, phone: s.phone || "", email: s.email || "", notes: s.notes || "" })}><Pencil size={15} /></Button>
                <Button variant="ghost" size="icon" className="text-red-600" onClick={() => del(s)}><Trash2 size={15} /></Button>
              </div>}
            </div>
          ))}
          {suppliers.length === 0 && <div className="text-sm text-gray-400">Nessun fornitore.</div>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReceiveSheet({ open, onOpenChange, recv, setRecv, suppliers, ingredients, submit }) {
  const [pick, setPick] = useState("");
  const add = (id) => {
    const ing = ingredients.find((i) => i.id === id);
    if (!ing || recv.lines.some((l) => l.ingredient_id === id)) return;
    setRecv({ ...recv, lines: [...recv.lines, { ingredient_id: id, name: ing.name, unit: ing.unit, qty: 1, cost: "" }] });
    setPick("");
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle className="font-display text-2xl">Registra consegna</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6" data-testid="receive-form">
          <div className="space-y-1"><Label>Fornitore</Label>
            <Select value={recv.supplier_id || "none"} onValueChange={(v) => setRecv({ ...recv, supplier_id: v === "none" ? null : v })}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Non specificato</SelectItem>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Aggiungi ingrediente</Label>
            <Select value={pick} onValueChange={add}>
              <SelectTrigger className="h-11" data-testid="receive-add-select"><SelectValue placeholder="Scegli ingrediente" /></SelectTrigger>
              <SelectContent>{ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2" data-testid="receive-lines">
            {recv.lines.map((l, idx) => (
              <div key={l.ingredient_id} className="flex items-center gap-2">
                <div className="flex-1 text-sm truncate">{l.name}</div>
                <Input className="h-10 w-20" type="number" step="0.01" value={l.qty} onChange={(e) => setRecv({ ...recv, lines: recv.lines.map((x, j) => j === idx ? { ...x, qty: e.target.value } : x) })} data-testid={`receive-qty-${idx}`} />
                <span className="text-xs text-gray-400 w-6">{l.unit}</span>
                <Input className="h-10 w-20" type="number" step="0.01" placeholder="€/u" value={l.cost ?? ""} onChange={(e) => setRecv({ ...recv, lines: recv.lines.map((x, j) => j === idx ? { ...x, cost: e.target.value } : x) })} data-testid={`receive-cost-${idx}`} />
                <Button variant="ghost" size="icon" onClick={() => setRecv({ ...recv, lines: recv.lines.filter((_, j) => j !== idx) })}><Trash2 size={15} /></Button>
              </div>
            ))}
            {recv.lines.length === 0 && <div className="text-sm text-gray-400">Nessun articolo aggiunto.</div>}
          </div>
          <Button className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" onClick={submit} data-testid="receive-submit-btn"><PackagePlus size={18} className="mr-2" />Carica in magazzino</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CountSheet({ open, onOpenChange, onDone }) {
  const [ings, setIngs] = useState([]);
  const [counts, setCounts] = useState({});
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) api.get("/t/ingredients").then((r) => { setIngs(r.data); setCounts(Object.fromEntries(r.data.map((i) => [i.id, i.quantity ?? 0]))); }).catch(() => {});
  }, [open]);
  const submit = async () => {
    const lines = ings.filter((i) => parseFloat(counts[i.id]) !== i.quantity).map((i) => ({ ingredient_id: i.id, counted_qty: parseFloat(counts[i.id]) || 0 }));
    try {
      const r = (await api.post("/t/inventory/count", { lines: ings.map((i) => ({ ingredient_id: i.id, counted_qty: parseFloat(counts[i.id]) || 0 })) })).data;
      toast.success(`Conteggio applicato · ${r.adjusted} rettifiche`); onOpenChange(false); onDone();
    } catch (err) { toast.error(errMsg(err)); }
  };
  const visible = q ? ings.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())) : ings;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle className="font-display text-2xl">Sessione di conteggio</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6" data-testid="count-form">
          <p className="text-xs text-gray-500">Conta la merce e inserisci le quantità reali. Le differenze diventano rettifiche automatiche.</p>
          <Input className="h-11" placeholder="Cerca ingrediente" value={q} onChange={(e) => setQ(e.target.value)} data-testid="count-search" />
          <div className="space-y-2 max-h-[55vh] overflow-y-auto">
            {visible.map((i) => (
              <div key={i.id} className="flex items-center gap-2">
                <div className="flex-1 text-sm truncate">{i.name}<span className="text-xs text-gray-400"> (att. {i.quantity ?? 0})</span></div>
                <Input className="h-10 w-24" type="number" step="0.01" value={counts[i.id] ?? ""} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} data-testid={`count-qty-${i.id}`} />
                <span className="text-xs text-gray-400 w-6">{i.unit}</span>
              </div>
            ))}
            {visible.length === 0 && <div className="text-sm text-gray-400">Nessun ingrediente.</div>}
          </div>
          <Button className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" onClick={submit} data-testid="count-submit-btn"><ClipboardList size={18} className="mr-2" />Applica conteggio</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InvoiceSheet({ open, onOpenChange, cats, onDone }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [supplier, setSupplier] = useState("");
  const [ingredients, setIngredients] = useState([]);

  useEffect(() => {
    if (open) api.get("/t/ingredients").then((r) => setIngredients(r.data)).catch(() => {});
  }, [open]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = (await api.post("/t/invoices/scan", fd, { headers: { "Content-Type": "multipart/form-data" } })).data;
      setSupplier(r.supplier_name || "");
      setResult({ ...r, lines: r.lines.map((l) => ({
        ...l, qty: l.qty ?? "", unit: l.unit || "pz", unit_cost: l.unit_cost ?? "",
        ingredient_id: l.ingredient_id || null, create_new: !l.ingredient_id, category: "Altro",
      })) });
      toast.success(`${r.lines.length} righe lette dalla fattura`);
    } catch (err) { toast.error(errMsg(err)); } finally { setLoading(false); e.target.value = ""; }
  };

  const apply = async () => {
    const lines = result.lines.filter((l) => parseFloat(l.qty) > 0 && (l.ingredient_id || l.create_new)).map((l) => ({
      name: l.name, ingredient_id: l.ingredient_id || null, qty: parseFloat(l.qty), unit: l.unit || "pz",
      unit_cost: l.unit_cost !== "" ? parseFloat(l.unit_cost) : null, category: l.category || "Altro", create_new: !l.ingredient_id && l.create_new,
    }));
    if (!lines.length) { toast.error("Nessuna riga valida da applicare"); return; }
    try {
      const r = (await api.post("/t/invoices/apply", { supplier_name: supplier, lines })).data;
      toast.success(`Fattura applicata · ${r.received} caricati, ${r.created} nuovi`);
      onOpenChange(false); setResult(null); onDone();
    } catch (err) { toast.error(errMsg(err)); }
  };

  const upd = (idx, patch) => setResult({ ...result, lines: result.lines.map((l, j) => j === idx ? { ...l, ...patch } : l) });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader><SheetTitle className="font-display text-2xl">Scansiona fattura</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6" data-testid="invoice-form">
          <p className="text-xs text-gray-500">Carica la foto di una fattura/DDT del fornitore: l'IA legge articoli, quantità e costi. Controlla e conferma: aggiorna i costi e carica le giacenze.</p>
          <label className="block">
            <div className="h-28 border-2 border-dashed border-gray-300 rounded-xl grid place-items-center text-sm text-gray-500 hover:border-[#E03131] hover:text-[#E03131] cursor-pointer transition-colors" data-testid="invoice-dropzone">
              {loading ? <span className="flex items-center gap-2"><Loader2 size={18} className="animate-spin" />Lettura in corso…</span> : <span className="flex items-center gap-2"><FileText size={18} />Scegli la foto della fattura</span>}
            </div>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} disabled={loading} data-testid="invoice-file-input" />
          </label>

          {result && (
            <>
              <div className="space-y-1"><Label>Fornitore</Label><Input className="h-11" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nome fornitore" data-testid="invoice-supplier-input" /></div>
              <div className="space-y-2" data-testid="invoice-lines">
                {result.lines.map((l, idx) => (
                  <div key={idx} className="border border-gray-100 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium truncate">{l.name}</div>
                      <Button variant="ghost" size="icon" onClick={() => setResult({ ...result, lines: result.lines.filter((_, j) => j !== idx) })}><Trash2 size={14} /></Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Input className="h-9" type="number" step="0.01" placeholder="Qtà" value={l.qty} onChange={(e) => upd(idx, { qty: e.target.value })} data-testid={`invoice-qty-${idx}`} />
                      <Input className="h-9" placeholder="Unità" value={l.unit} onChange={(e) => upd(idx, { unit: e.target.value })} />
                      <Input className="h-9" type="number" step="0.01" placeholder="€/u" value={l.unit_cost} onChange={(e) => upd(idx, { unit_cost: e.target.value })} data-testid={`invoice-cost-${idx}`} />
                    </div>
                    <Select value={l.ingredient_id || "new"} onValueChange={(v) => upd(idx, v === "new" ? { ingredient_id: null, create_new: true } : { ingredient_id: v, create_new: false })}>
                      <SelectTrigger className="h-9 text-xs" data-testid={`invoice-match-${idx}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">➕ Crea nuovo ingrediente</SelectItem>
                        {ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {!l.ingredient_id && (
                      <Select value={l.category} onValueChange={(v) => upd(idx, { category: v })}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Categoria nuovo" /></SelectTrigger>
                        <SelectContent>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                  </div>
                ))}
                {result.lines.length === 0 && <div className="text-sm text-gray-400">Nessuna riga.</div>}
              </div>
              <Button className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" onClick={apply} data-testid="invoice-apply-btn"><PackagePlus size={18} className="mr-2" />Applica alla giacenza</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
