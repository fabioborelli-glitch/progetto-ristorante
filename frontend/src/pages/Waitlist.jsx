import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Users, Phone, BellRing, Armchair, X, QrCode, Clock } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTenantSocket } from "@/hooks/useTenantSocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS = {
  in_attesa: { label: "In attesa", cls: "bg-amber-100 text-amber-800" },
  chiamato: { label: "Chiamato", cls: "bg-blue-100 text-blue-800" },
  seduto: { label: "Seduto", cls: "bg-emerald-100 text-emerald-800" },
  annullato: { label: "Annullato", cls: "bg-gray-100 text-gray-600" },
  no_show: { label: "No show", cls: "bg-red-100 text-red-800" },
};
const EMPTY = { name: "", guests: 2, phone: "", notes: "", quoted_minutes: "" };
const waited = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

export default function Waitlist() {
  const { tenant } = useAuth();
  const [list, setList] = useState([]);
  const [tables, setTables] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [seating, setSeating] = useState(null);
  const [tableId, setTableId] = useState("");
  const [showQr, setShowQr] = useState(null);
  const [, tick] = useState(0);

  const load = useCallback(() => api.get("/t/waitlist").then((r) => setList(r.data)).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => {
    load();
    api.get("/t/tables").then((r) => setTables(r.data));
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [load]);
  useTenantSocket((event) => { if (event === "waitlist_changed" || event === "tables_changed") { load(); api.get("/t/tables").then((r) => setTables(r.data)); } });

  const add = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/t/waitlist", { ...form, guests: +form.guests, quoted_minutes: form.quoted_minutes ? +form.quoted_minutes : null });
      toast.success(`${data.name} in lista · posizione ${data.position}`);
      setOpen(false);
      setForm(EMPTY);
      setShowQr(data);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const patch = async (entry, payload, msg) => {
    try {
      await api.patch(`/t/waitlist/${entry.id}`, payload);
      if (msg) toast.success(msg);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const seat = async () => {
    await patch(seating, { status: "seduto", table_id: tableId || null }, `${seating.name} accomodato`);
    setSeating(null);
    setTableId("");
  };

  const active = list.filter((e) => ["in_attesa", "chiamato"].includes(e.status));
  const done = list.filter((e) => !["in_attesa", "chiamato"].includes(e.status));
  const statusUrl = (e) => `${window.location.origin}/r/${tenant?.slug}/attesa/${e.code}`;
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-8 max-w-5xl" data-testid="waitlist-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Lista d'attesa</h1>
          <p className="text-gray-500 text-sm mt-1"><b data-testid="waitlist-count">{active.length}</b> gruppi in coda · {active.reduce((a, e) => a + e.guests, 0)} persone</p>
        </div>
        <Button className="h-12 px-6 bg-[#E03131] hover:bg-[#c42727]" onClick={() => setOpen(true)} data-testid="waitlist-add-btn"><Plus size={18} className="mr-2" />Aggiungi gruppo</Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid="waitlist-active">
        {active.length === 0 ? <div className="p-10 text-center text-gray-500">Nessuno in attesa.</div> : (
          <div className="divide-y divide-gray-100">
            {active.map((e) => (
              <div key={e.id} className={`flex flex-wrap items-center gap-4 px-5 py-4 ${e.status === "chiamato" ? "bg-blue-50/60" : ""}`} data-testid={`waitlist-row-${e.id}`}>
                <div className="font-display text-3xl font-extrabold w-12 tabular-nums text-gray-400">{e.position ? `#${e.position}` : <BellRing className="text-blue-600" />}</div>
                <div className="flex-1 min-w-[160px]">
                  <div className="font-semibold text-lg">{e.name}</div>
                  <div className="text-xs text-gray-500 flex flex-wrap items-center gap-3 mt-0.5">
                    <span className="inline-flex items-center gap-1"><Users size={12} />{e.guests}</span>
                    {e.phone && <span className="inline-flex items-center gap-1"><Phone size={12} />{e.phone}</span>}
                    <span className="inline-flex items-center gap-1" data-testid={`waitlist-waited-${e.id}`}><Clock size={12} />{waited(e.created_at)} min{e.quoted_minutes ? ` / stimati ${e.quoted_minutes}` : ""}</span>
                    {e.notes && <span className="italic">“{e.notes}”</span>}
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS[e.status].cls}`} data-testid={`waitlist-status-${e.id}`}>{STATUS[e.status].label}</span>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => setShowQr(e)} data-testid={`waitlist-qr-${e.id}`}><QrCode size={14} /></Button>
                  {e.status === "in_attesa" && <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => patch(e, { status: "chiamato" }, `${e.name}: tavolo pronto`)} data-testid={`waitlist-call-${e.id}`}><BellRing size={14} className="mr-1" />Chiama</Button>}
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setSeating(e); setTableId(""); }} data-testid={`waitlist-seat-${e.id}`}><Armchair size={14} className="mr-1" />Accomoda</Button>
                  {e.status === "chiamato" && <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => patch(e, { status: "no_show" })} data-testid={`waitlist-noshow-${e.id}`}>No show</Button>}
                  <Button size="sm" variant="ghost" onClick={() => patch(e, { status: "annullato" })} data-testid={`waitlist-cancel-${e.id}`}><X size={14} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {done.length > 0 && (
        <details className="text-sm" data-testid="waitlist-done">
          <summary className="cursor-pointer text-gray-500">Storico di oggi ({done.length})</summary>
          <div className="mt-3 bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {done.map((e) => (
              <div key={e.id} className="flex items-center gap-4 px-5 py-3">
                <div className="flex-1"><b>{e.name}</b> · {e.guests} persone{e.table_id && ` · Tavolo ${tables.find((t) => t.id === e.table_id)?.name || "?"}`}</div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle className="font-display text-2xl">Nuovo gruppo in attesa</SheetTitle></SheetHeader>
          <form onSubmit={add} className="space-y-4 mt-6" data-testid="waitlist-form">
            <div className="space-y-1"><Label>Nome</Label><Input className="h-12" value={form.name} onChange={f("name")} required data-testid="waitlist-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Persone</Label><Input type="number" min={1} className="h-12" value={form.guests} onChange={f("guests")} required data-testid="waitlist-guests" /></div>
              <div className="space-y-1"><Label>Attesa stimata (min)</Label><Input type="number" min={0} className="h-12" value={form.quoted_minutes} onChange={f("quoted_minutes")} placeholder="es. 20" data-testid="waitlist-quoted" /></div>
            </div>
            <div className="space-y-1"><Label>Telefono (opzionale)</Label><Input className="h-12" value={form.phone} onChange={f("phone")} data-testid="waitlist-phone" /></div>
            <div className="space-y-1"><Label>Note</Label><Input className="h-12" value={form.notes} onChange={f("notes")} placeholder="seggiolone, esterno…" data-testid="waitlist-notes" /></div>
            <Button type="submit" className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" data-testid="waitlist-submit">Aggiungi alla lista</Button>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={!!seating} onOpenChange={(o) => !o && setSeating(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle className="font-display text-2xl">Accomoda {seating?.name}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1"><Label>Tavolo</Label>
              <Select value={tableId || "none"} onValueChange={(v) => setTableId(v === "none" ? "" : v)}>
                <SelectTrigger className="h-12" data-testid="waitlist-table-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Non assegnare</SelectItem>
                  {tables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} · {t.seats} posti · {t.status === "libero" ? "libero" : "occupato"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700" onClick={seat} data-testid="waitlist-seat-confirm">Conferma</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!showQr} onOpenChange={(o) => !o && setShowQr(null)}>
        <SheetContent className="sm:max-w-md">
          {showQr && (
            <div className="text-center space-y-4 mt-6" data-testid="waitlist-qr-sheet">
              <SheetHeader><SheetTitle className="font-display text-2xl">Fai inquadrare al cliente</SheetTitle></SheetHeader>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(statusUrl(showQr))}`} alt="QR" className="mx-auto h-60 w-60" />
              <div className="font-display text-4xl font-extrabold tracking-widest" data-testid="waitlist-code">{showQr.code}</div>
              <p className="text-sm text-gray-500">Il cliente vede la posizione in coda e riceve l'avviso "tavolo pronto" sul telefono.</p>
              <a href={statusUrl(showQr)} target="_blank" rel="noreferrer" className="text-sm text-[#E03131] underline break-all" data-testid="waitlist-status-link">{statusUrl(showQr)}</a>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
