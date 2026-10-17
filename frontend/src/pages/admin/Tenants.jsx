import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Store, Users, Grid2x2, CalendarDays, LogOut, ArrowRight, ExternalLink } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const EMPTY = { name: "", slug: "", city: "", owner_name: "", owner_email: "", owner_password: "", send_invite: true };

export default function Tenants() {
  const { user, logout, setActAs, isSuper } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/admin/tenants").then((r) => setTenants(r.data)).catch((e) => toast.error(errMsg(e)));

  useEffect(() => {
    if (user && !isSuper) navigate("/dashboard");
    else load();
  }, [user, isSuper]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post("/admin/tenants", form);
      toast.success(data.invite_sent_to ? `Ristorante creato, invito inviato a ${data.invite_sent_to}` : "Ristorante creato");
      setOpen(false);
      setForm(EMPTY);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t) => {
    try {
      await api.patch(`/admin/tenants/${t.id}`, { active: !t.active });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const enter = (t) => {
    setActAs(t);
    navigate("/dashboard");
  };

  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#111827]">
      <header className="bg-white border-b border-gray-200 px-6 md:px-10 py-5 flex items-center justify-between">
        <div className="font-display text-2xl font-extrabold tracking-tight">
          Risto<span className="text-[#E03131]">OS</span> <span className="text-gray-400 font-medium text-base ml-2">Agenzia</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 hidden sm:inline" data-testid="admin-user-email">{user?.email}</span>
          <Button variant="ghost" onClick={logout} data-testid="admin-logout-btn"><LogOut size={16} className="mr-2" />Esci</Button>
        </div>
      </header>

      <main className="px-6 md:px-10 py-10 max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
          <div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight">Ristoranti clienti</h1>
            <p className="text-gray-500 mt-2">Gestisci i tenant, crea nuovi locali e accedi come owner.</p>
          </div>
          <Button className="h-12 px-6 bg-[#E03131] hover:bg-[#c42727]" onClick={() => setOpen(true)} data-testid="create-tenant-btn">
            <Plus size={18} className="mr-2" /> Nuovo ristorante
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2" data-testid="tenants-list">
          {tenants.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col gap-5" data-testid={`tenant-card-${t.slug}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-lg bg-gray-900 text-white grid place-items-center"><Store size={20} /></div>
                  <div>
                    <div className="font-display text-xl font-bold leading-tight">{t.name}</div>
                    <div className="text-sm text-gray-500">/{t.slug} · {t.city || "—"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${t.active ? "text-emerald-600" : "text-gray-400"}`}>{t.active ? "Attivo" : "Sospeso"}</span>
                  <Switch checked={t.active} onCheckedChange={() => toggle(t)} data-testid={`tenant-toggle-${t.slug}`} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat icon={Users} label="Utenti" value={t.users_count} />
                <Stat icon={Grid2x2} label="Tavoli" value={t.tables_count} />
                <Stat icon={CalendarDays} label="Prenotaz." value={t.reservations_count} />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button className="flex-1 h-11 bg-gray-900 hover:bg-gray-800" onClick={() => enter(t)} data-testid={`enter-tenant-${t.slug}`}>
                  Entra come owner <ArrowRight size={16} className="ml-2" />
                </Button>
                <a href={`/r/${t.slug}/prenota`} target="_blank" rel="noreferrer" className="h-11 px-4 inline-flex items-center rounded-md border border-gray-200 text-sm hover:bg-gray-50" data-testid={`public-link-${t.slug}`}>
                  <ExternalLink size={16} />
                </a>
              </div>
            </div>
          ))}
          {tenants.length === 0 && <div className="text-gray-500">Nessun ristorante ancora. Creane uno.</div>}
        </div>
      </main>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle className="font-display text-2xl">Nuovo ristorante</SheetTitle></SheetHeader>
          <form onSubmit={create} className="space-y-5 mt-6" data-testid="create-tenant-form">
            <Field label="Nome locale" value={form.name} onChange={f("name")} required testid="tenant-name-input" />
            <Field label="Slug URL (opzionale)" value={form.slug} onChange={f("slug")} placeholder="es. osteria-rossi" testid="tenant-slug-input" />
            <Field label="Città" value={form.city} onChange={f("city")} testid="tenant-city-input" />
            <div className="pt-3 border-t border-gray-200 text-sm font-semibold text-gray-700">Account owner</div>
            <Field label="Nome owner" value={form.owner_name} onChange={f("owner_name")} required testid="owner-name-input" />
            <Field label="Email owner" type="email" value={form.owner_email} onChange={f("owner_email")} required testid="owner-email-input" />
            <label className="flex items-center gap-3 text-sm bg-gray-50 border border-gray-200 rounded-lg p-3">
              <Switch checked={form.send_invite} onCheckedChange={(v) => setForm({ ...form, send_invite: v })} data-testid="send-invite-switch" />
              <span>{form.send_invite ? "Invia invito via email: l'owner sceglie la sua password" : "Imposta tu la password iniziale"}</span>
            </label>
            {!form.send_invite && <Field label="Password iniziale (min 8)" type="text" value={form.owner_password} onChange={f("owner_password")} required testid="owner-password-input" />}
            <Button type="submit" className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" disabled={saving} data-testid="tenant-submit-btn">
              {saving ? "Creazione…" : form.send_invite ? "Crea e invia invito" : "Crea ristorante"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
      <div className="flex items-center gap-1.5 text-gray-500 text-xs"><Icon size={14} />{label}</div>
      <div className="font-display text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function Field({ label, testid, ...props }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input className="h-11" data-testid={testid} {...props} />
    </div>
  );
}
