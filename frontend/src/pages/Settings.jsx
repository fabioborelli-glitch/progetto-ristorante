import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Mail, Copy, X } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ImageUpload } from "@/components/ImageUpload";
import { PrinterSettings } from "@/components/PrinterSettings";
import { StationsEditor } from "@/components/StationsEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLE_LABEL = { owner: "Owner", manager: "Manager", staff: "Staff" };

export default function Settings() {
  const { role, refresh, user, isSuper } = useAuth();
  const canEdit = role === "owner" || role === "manager";
  const [s, setS] = useState(null);
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [slotsText, setSlotsText] = useState("");
  const [nu, setNu] = useState({ name: "", email: "", tenant_role: "staff" });
  const [inviting, setInviting] = useState(false);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });

  const loadUsers = () => {
    if (!canEdit) return;
    api.get("/t/users").then((r) => setUsers(r.data)).catch(() => {});
    api.get("/t/invites").then((r) => setInvites(r.data)).catch(() => {});
  };

  useEffect(() => {
    api.get("/t/settings").then((r) => { setS(r.data); setSlotsText(r.data.slots.join(", ")); }).catch((e) => toast.error(errMsg(e)));
    loadUsers();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    const slots = slotsText.split(",").map((x) => x.trim()).filter(Boolean);
    try {
      const { data } = await api.patch("/t/settings", { name: s.name, address: s.address, city: s.city, phone: s.phone, description: s.description, slots, capacity_per_slot: +s.capacity_per_slot, logo_url: s.logo_url || "", kds_warn_minutes: +s.kds_warn_minutes || 15, kds_alert_minutes: +s.kds_alert_minutes || 25, whatsapp_enabled: !!s.whatsapp_enabled });
      setS({ ...data, whatsapp_available: s.whatsapp_available });
      toast.success("Impostazioni salvate");
      if (!isSuper) refresh();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const addUser = async (e) => {
    e.preventDefault();
    setInviting(true);
    try {
      const { data } = await api.post("/t/invites", nu);
      toast.success(`Invito inviato a ${data.email}`);
      setNu({ name: "", email: "", tenant_role: "staff" });
      loadUsers();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setInviting(false);
    }
  };

  const revokeInvite = async (inv) => {
    try { await api.delete(`/t/invites/${inv.id}`); loadUsers(); } catch (err) { toast.error(errMsg(err)); }
  };

  const delUser = async (u) => {
    if (!window.confirm(`Rimuovere ${u.email}?`)) return;
    try { await api.delete(`/t/users/${u.id}`); loadUsers(); } catch (err) { toast.error(errMsg(err)); }
  };

  const changePw = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/change-password", pw);
      toast.success("Password aggiornata");
      setPw({ current_password: "", new_password: "" });
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  if (!s) return <div className="text-gray-500">Caricamento…</div>;
  const f = (k) => (e) => setS({ ...s, [k]: e.target.value });

  return (
    <div className="space-y-10 max-w-4xl" data-testid="settings-page">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Impostazioni</h1>

      <form onSubmit={save} className="bg-white border border-gray-200 rounded-xl p-6 md:p-8 space-y-5" data-testid="settings-form">
        <h2 className="font-display text-lg font-bold">Locale</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Nome</Label><Input className="h-11" value={s.name} onChange={f("name")} disabled={!canEdit} data-testid="settings-name" /></div>
          <div className="space-y-1"><Label>Telefono</Label><Input className="h-11" value={s.phone || ""} onChange={f("phone")} disabled={!canEdit} data-testid="settings-phone" /></div>
          <div className="space-y-1"><Label>Indirizzo</Label><Input className="h-11" value={s.address || ""} onChange={f("address")} disabled={!canEdit} data-testid="settings-address" /></div>
          <div className="space-y-1"><Label>Città</Label><Input className="h-11" value={s.city || ""} onChange={f("city")} disabled={!canEdit} data-testid="settings-city" /></div>
        </div>
        <div className="space-y-1"><Label>Descrizione (pagina pubblica)</Label><Textarea value={s.description || ""} onChange={f("description")} disabled={!canEdit} data-testid="settings-description" /></div>
        {canEdit && <div className="max-w-[112px]"><ImageUpload value={s.logo_url || ""} onChange={(u) => setS({ ...s, logo_url: u })} label="Logo" shape="square" testid="logo-upload" /></div>}
        <h2 className="font-display text-lg font-bold pt-2">Prenotazioni online</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1"><Label>Fasce orarie (separate da virgola)</Label><Input className="h-11" value={slotsText} onChange={(e) => setSlotsText(e.target.value)} disabled={!canEdit} data-testid="settings-slots" /></div>
          <div className="space-y-1"><Label>Coperti max per fascia</Label><Input className="h-11" type="number" min={1} value={s.capacity_per_slot} onChange={f("capacity_per_slot")} disabled={!canEdit} data-testid="settings-capacity" /></div>
        </div>
        <div className="text-xs text-gray-500">Slug pubblico: <code className="bg-gray-100 px-1.5 py-0.5 rounded">/r/{s.slug}</code></div>
        <h2 className="font-display text-lg font-bold pt-2">Notifiche al cliente</h2>
        <div className="rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-4" data-testid="whatsapp-section">
          <div className="flex-1 min-w-[220px]">
            <div className="font-medium">WhatsApp (Twilio)</div>
            <div className="text-xs text-gray-500" data-testid="whatsapp-status">
              {s.whatsapp_available ? "Credenziali Twilio configurate: conferme e promemoria partono anche su WhatsApp al numero del cliente." : "Non ancora attivo: inserisci TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_WHATSAPP_FROM nelle variabili d'ambiente del backend per abilitarlo. Le email funzionano comunque."}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={!!s.whatsapp_enabled} disabled={!canEdit} onCheckedChange={(v) => setS({ ...s, whatsapp_enabled: v })} data-testid="whatsapp-switch" />{s.whatsapp_enabled ? "Attivo per questo locale" : "Disattivato"}</label>
        </div>
        <h2 className="font-display text-lg font-bold pt-2">Tempi cucina (KDS)</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Avviso giallo dopo (minuti)</Label><Input className="h-11" type="number" min={1} value={s.kds_warn_minutes ?? 15} onChange={f("kds_warn_minutes")} disabled={!canEdit} data-testid="settings-kds-warn" /></div>
          <div className="space-y-1"><Label>Allarme rosso dopo (minuti)</Label><Input className="h-11" type="number" min={1} value={s.kds_alert_minutes ?? 25} onChange={f("kds_alert_minutes")} disabled={!canEdit} data-testid="settings-kds-alert" /></div>
        </div>
        {canEdit && <Button type="submit" className="h-12 px-6 bg-[#E03131] hover:bg-[#c42727]" data-testid="settings-save-btn">Salva impostazioni</Button>}
      </form>

      {canEdit && <StationsEditor stations={s.stations} onSaved={(t) => setS({ ...s, stations: t.stations })} />}
      <PrinterSettings />

      {canEdit && (
        <section className="bg-white border border-gray-200 rounded-xl p-6 md:p-8 space-y-5" data-testid="team-section">
          <h2 className="font-display text-lg font-bold">Team</h2>
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 text-sm" data-testid={`team-user-${u.email}`}>
                <div className="flex-1"><div className="font-medium">{u.name}</div><div className="text-gray-500 text-xs">{u.email}</div></div>
                <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">{ROLE_LABEL[u.tenant_role]}</span>
                {role === "owner" && u.id !== user?.id && <Button variant="ghost" size="icon" className="text-red-600" onClick={() => delUser(u)} data-testid={`delete-user-${u.email}`}><Trash2 size={16} /></Button>}
              </div>
            ))}
          </div>
          <form onSubmit={addUser} className="grid md:grid-cols-4 gap-3 items-end" data-testid="add-user-form">
            <div className="space-y-1"><Label>Nome</Label><Input className="h-11" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} required data-testid="new-user-name" /></div>
            <div className="space-y-1"><Label>Email</Label><Input className="h-11" type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} required data-testid="new-user-email" /></div>
            <div className="space-y-1"><Label>Ruolo</Label>
              <Select value={nu.tenant_role} onValueChange={(v) => setNu({ ...nu, tenant_role: v })}>
                <SelectTrigger className="h-11" data-testid="new-user-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  {role === "owner" && <SelectItem value="owner">Owner</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="h-11 bg-gray-900 hover:bg-gray-800" disabled={inviting} data-testid="add-user-btn"><Mail size={16} className="mr-1" />{inviting ? "Invio…" : "Invita via email"}</Button>
          </form>
          {invites.length > 0 && (
            <div className="space-y-2" data-testid="pending-invites">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Inviti in attesa</div>
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-4 py-3 text-sm" data-testid={`invite-row-${inv.email}`}>
                    <Mail size={16} className="text-gray-400" />
                    <div className="flex-1"><div className="font-medium">{inv.name}</div><div className="text-gray-500 text-xs">{inv.email} · scade {new Date(inv.expires_at).toLocaleDateString("it-IT")}</div></div>
                    <span className="text-xs bg-amber-50 text-amber-800 px-2 py-1 rounded-full">{ROLE_LABEL[inv.tenant_role]}</span>
                    <Button variant="ghost" size="icon" className="text-gray-500" onClick={() => revokeInvite(inv)} data-testid={`revoke-invite-${inv.email}`}><X size={16} /></Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {!isSuper && (
        <form onSubmit={changePw} className="bg-white border border-gray-200 rounded-xl p-6 md:p-8 space-y-4 max-w-md" data-testid="change-password-form">
          <h2 className="font-display text-lg font-bold">Cambia password</h2>
          <div className="space-y-1"><Label>Password attuale</Label><Input type="password" className="h-11" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required data-testid="pw-current" /></div>
          <div className="space-y-1"><Label>Nuova password</Label><Input type="password" className="h-11" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required data-testid="pw-new" /></div>
          <Button type="submit" variant="outline" className="h-11" data-testid="pw-submit">Aggiorna password</Button>
        </form>
      )}
    </div>
  );
}
