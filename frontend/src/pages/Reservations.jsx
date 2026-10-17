import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, ChevronLeft, ChevronRight, Phone, Users, Link as LinkIcon, Mail, MailCheck, Bell } from "lucide-react";
import { api, errMsg, todayStr, RES_STATUS } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTenantSocket } from "@/hooks/useTenantSocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY = { date: todayStr(), time: "20:00", guests: 2, name: "", phone: "", email: "", notes: "", status: "confermata", table_id: null };

function shiftDate(d, n) {
  const dt = new Date(d + "T12:00:00");
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export default function Reservations() {
  const { tenant } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [list, setList] = useState([]);
  const [tables, setTables] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => api.get("/t/reservations", { params: { date } }).then((r) => setList(r.data)).catch((e) => toast.error(errMsg(e))), [date]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get("/t/tables").then((r) => setTables(r.data)); }, []);
  useTenantSocket((event) => {
    if (event === "reservations_changed") { load(); toast.info("Nuova prenotazione online ricevuta"); }
  });

  const openNew = () => { setEditing(null); setForm({ ...EMPTY, date }); setOpen(true); };
  const openEdit = (r) => { setEditing(r); setForm({ ...r }); setOpen(true); };

  const save = async (e) => {
    e.preventDefault();
    const payload = { ...form, guests: +form.guests, table_id: form.table_id || null };
    try {
      if (editing) await api.patch(`/t/reservations/${editing.id}`, payload);
      else await api.post("/t/reservations", payload);
      toast.success(editing ? "Prenotazione aggiornata" : "Prenotazione creata");
      setOpen(false);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const quickStatus = async (r, status) => {
    try {
      await api.patch(`/t/reservations/${r.id}`, { status });
      if (status === "confermata" && r.email) toast.success(`Confermata · email inviata a ${r.email}`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const [sending, setSending] = useState(false);
  const resend = async (kind) => {
    setSending(true);
    try {
      const { data } = await api.post(`/t/reservations/${editing.id}/notify`, { kind });
      setEditing(data);
      toast.success(kind === "promemoria" ? "Promemoria inviato" : "Conferma inviata");
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSending(false);
    }
  };

  const publicUrl = `${window.location.origin}/r/${tenant?.slug}/prenota`;
  const covers = list.filter((r) => !["annullata", "no_show"].includes(r.status)).reduce((a, r) => a + r.guests, 0);
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-8 max-w-5xl" data-testid="reservations-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Prenotazioni</h1>
          <button onClick={() => { navigator.clipboard?.writeText(publicUrl); toast.success("Link copiato"); }} className="text-sm text-gray-500 mt-1 inline-flex items-center gap-1.5 hover:text-gray-900" data-testid="copy-public-link-btn">
            <LinkIcon size={14} /> Link pubblico: <span className="underline">{publicUrl}</span>
          </button>
        </div>
        <Button className="h-12 px-6 bg-[#E03131] hover:bg-[#c42727]" onClick={openNew} data-testid="new-reservation-btn"><Plus size={18} className="mr-2" />Nuova prenotazione</Button>
      </div>

      <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3">
        <Button variant="ghost" size="icon" onClick={() => setDate(shiftDate(date, -1))} data-testid="prev-day-btn"><ChevronLeft /></Button>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 max-w-[180px] font-medium" data-testid="date-input" />
        <Button variant="ghost" size="icon" onClick={() => setDate(shiftDate(date, 1))} data-testid="next-day-btn"><ChevronRight /></Button>
        <Button variant="outline" onClick={() => setDate(todayStr())} data-testid="today-btn">Oggi</Button>
        <div className="ml-auto text-sm text-gray-600 pr-2" data-testid="day-summary"><b>{list.length}</b> prenotazioni · <b>{covers}</b> coperti</div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid="reservations-list">
        {list.length === 0 ? (
          <div className="p-10 text-center text-gray-500">Nessuna prenotazione per questa data.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {list.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors" data-testid={`reservation-row-${r.id}`}>
                <div className="font-display text-2xl font-extrabold w-16 tabular-nums">{r.time}</div>
                <button onClick={() => openEdit(r)} className="flex-1 min-w-[160px] text-left" data-testid={`reservation-edit-${r.id}`}>
                  <div className="font-semibold">{r.name} {r.source === "online" && <span className="text-[10px] uppercase tracking-wide bg-gray-900 text-white px-1.5 py-0.5 rounded ml-1">online</span>}</div>
                  <div className="text-xs text-gray-500 flex items-center gap-3 mt-0.5">
                    <span className="inline-flex items-center gap-1"><Users size={12} />{r.guests}</span>
                    {r.phone && <span className="inline-flex items-center gap-1"><Phone size={12} />{r.phone}</span>}
                    {r.email && (
                      <span className={`inline-flex items-center gap-1 ${r.notify?.conferma || r.notify?.promemoria ? "text-emerald-700" : ""}`} data-testid={`reservation-mail-${r.id}`} title={r.notify?.promemoria ? "Promemoria inviato" : r.notify?.conferma ? "Conferma inviata" : r.notify?.ricevuta ? "Ricevuta inviata" : "Email non ancora inviata"}>
                        {r.notify?.promemoria ? <Bell size={12} /> : r.notify?.conferma ? <MailCheck size={12} /> : <Mail size={12} />}
                        {r.notify?.promemoria ? "promemoria" : r.notify?.conferma ? "confermata via email" : r.notify?.ricevuta ? "ricevuta inviata" : r.email}
                      </span>
                    )}
                    {r.table_id && <span>Tavolo {tables.find((t) => t.id === r.table_id)?.name || "?"}</span>}
                    {r.notes && <span className="truncate italic">“{r.notes}”</span>}
                  </div>
                </button>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${RES_STATUS[r.status]?.cls}`} data-testid={`reservation-status-${r.id}`}>{RES_STATUS[r.status]?.label}</span>
                <div className="flex gap-1">
                  {r.status === "in_attesa" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => quickStatus(r, "confermata")} data-testid={`confirm-btn-${r.id}`}>Conferma</Button>}
                  {r.status === "confermata" && <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => quickStatus(r, "seduta")} data-testid={`seat-btn-${r.id}`}>Accomoda</Button>}
                  {r.status === "seduta" && <Button size="sm" variant="outline" onClick={() => quickStatus(r, "completata")} data-testid={`complete-btn-${r.id}`}>Completa</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle className="font-display text-2xl">{editing ? "Modifica prenotazione" : "Nuova prenotazione"}</SheetTitle></SheetHeader>
          <form onSubmit={save} className="space-y-4 mt-6" data-testid="reservation-form">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Data</Label><Input type="date" className="h-11" value={form.date} onChange={f("date")} required data-testid="res-date-input" /></div>
              <div className="space-y-1"><Label>Ora</Label>
                <Select value={form.time} onValueChange={(v) => setForm({ ...form, time: v })}>
                  <SelectTrigger className="h-11" data-testid="res-time-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{(tenant?.slots || []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Coperti</Label><Input type="number" min={1} className="h-11" value={form.guests} onChange={f("guests")} required data-testid="res-guests-input" /></div>
              <div className="space-y-1"><Label>Tavolo</Label>
                <Select value={form.table_id || "none"} onValueChange={(v) => setForm({ ...form, table_id: v === "none" ? null : v })}>
                  <SelectTrigger className="h-11" data-testid="res-table-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Non assegnato</SelectItem>
                    {tables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.seats} posti)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1"><Label>Nome cliente</Label><Input className="h-11" value={form.name} onChange={f("name")} required data-testid="res-name-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Telefono</Label><Input className="h-11" value={form.phone || ""} onChange={f("phone")} data-testid="res-phone-input" /></div>
              <div className="space-y-1"><Label>Email</Label><Input type="email" className="h-11" value={form.email || ""} onChange={f("email")} data-testid="res-email-input" /></div>
            </div>
            <div className="space-y-1"><Label>Stato</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="h-11" data-testid="res-status-select"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(RES_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Note</Label><Textarea value={form.notes || ""} onChange={f("notes")} data-testid="res-notes-input" /></div>
            <Button type="submit" className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" data-testid="res-submit-btn">{editing ? "Salva" : "Crea prenotazione"}</Button>
            {editing && editing.email && (
              <div className="border-t border-gray-200 pt-4 space-y-2" data-testid="res-notify-section">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Email al cliente</div>
                <div className="text-xs text-gray-500">
                  {editing.notify?.ricevuta && <div>Ricevuta: {new Date(editing.notify.ricevuta).toLocaleString("it-IT")}</div>}
                  {editing.notify?.conferma && <div>Conferma: {new Date(editing.notify.conferma).toLocaleString("it-IT")}</div>}
                  {editing.notify?.promemoria && <div>Promemoria: {new Date(editing.notify.promemoria).toLocaleString("it-IT")}</div>}
                  {!editing.notify?.ricevuta && !editing.notify?.conferma && !editing.notify?.promemoria && <div>Nessuna email inviata finora.</div>}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="h-10 flex-1" disabled={sending} onClick={() => resend("conferma")} data-testid="res-send-conferma-btn"><MailCheck size={14} className="mr-1" />{editing.notify?.conferma ? "Reinvia conferma" : "Invia conferma"}</Button>
                  <Button type="button" variant="outline" className="h-10 flex-1" disabled={sending} onClick={() => resend("promemoria")} data-testid="res-send-promemoria-btn"><Bell size={14} className="mr-1" />Invia promemoria</Button>
                </div>
                <p className="text-[11px] text-gray-400">Il promemoria parte automaticamente alle 10:00 del giorno della prenotazione per le prenotazioni confermate.</p>
              </div>
            )}
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
