import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MapPin, Phone, Users, CalendarDays, Check } from "lucide-react";
import { api, errMsg, todayStr } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const HERO = "https://images.pexels.com/photos/2387675/pexels-photo-2387675.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

export default function Booking() {
  const { slug } = useParams();
  const [info, setInfo] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState({ date: todayStr(), guests: 2, time: "", name: "", phone: "", email: "", notes: "" });
  const [slots, setSlots] = useState([]);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get(`/public/${slug}`).then((r) => setInfo(r.data)).catch(() => setNotFound(true));
  }, [slug]);

  useEffect(() => {
    if (!info) return;
    api.get(`/public/${slug}/availability`, { params: { date: form.date, guests: form.guests } }).then((r) => setSlots(r.data));
  }, [info, slug, form.date, form.guests]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.time) return setError("Scegli un orario");
    setLoading(true);
    try {
      const { data } = await api.post(`/public/${slug}/reservations`, { ...form, guests: +form.guests });
      setDone(data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  if (notFound) return <div className="min-h-screen grid place-items-center bg-[#FDFBF7] text-[#292524]">Ristorante non trovato.</div>;
  if (!info) return <div className="min-h-screen bg-[#FDFBF7]" />;

  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#292524]" data-testid="booking-page">
      <div className="relative h-56 md:h-72 overflow-hidden">
        <img src={HERO} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative h-full max-w-2xl mx-auto px-6 flex flex-col justify-end pb-8 text-white">
          <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tight leading-none" data-testid="booking-restaurant-name">{info.name}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-white/90">
            {info.address && <span className="inline-flex items-center gap-1.5"><MapPin size={14} />{info.address}</span>}
            {info.phone && <span className="inline-flex items-center gap-1.5"><Phone size={14} />{info.phone}</span>}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {done ? (
          <div className="bg-white border border-[#e7e0d3] rounded-2xl p-8 text-center space-y-4 fade-up" data-testid="booking-success">
            <div className="h-16 w-16 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center mx-auto"><Check size={32} /></div>
            <h2 className="font-display text-3xl font-extrabold">Richiesta inviata!</h2>
            <p className="text-[#57534e] leading-relaxed">
              Grazie <b>{done.name}</b>. La tua prenotazione per <b>{done.guests}</b> {done.guests === 1 ? "persona" : "persone"} il <b>{new Date(done.date + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</b> alle <b>{done.time}</b> è in attesa di conferma da parte del ristorante.
            </p>
            <Button variant="outline" onClick={() => { setDone(null); setForm({ ...form, time: "", name: "", notes: "" }); }} data-testid="booking-again-btn">Nuova prenotazione</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-8" data-testid="booking-form">
            {info.description && <p className="text-[#57534e] leading-relaxed">{info.description}</p>}
            <section className="bg-white border border-[#e7e0d3] rounded-2xl p-6 space-y-5">
              <h2 className="font-display text-xl font-bold flex items-center gap-2"><CalendarDays size={18} className="text-[#D97706]" />Quando</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><Label>Data</Label><Input type="date" min={todayStr()} className="h-12" value={form.date} onChange={f("date")} required data-testid="booking-date" /></div>
                <div className="space-y-1"><Label>Persone</Label>
                  <div className="flex items-center h-12 border border-input rounded-md">
                    <button type="button" className="w-12 h-full text-xl" onClick={() => setForm({ ...form, guests: Math.max(1, form.guests - 1) })} data-testid="guests-minus">−</button>
                    <div className="flex-1 text-center font-bold inline-flex items-center justify-center gap-1" data-testid="guests-value"><Users size={14} />{form.guests}</div>
                    <button type="button" className="w-12 h-full text-xl" onClick={() => setForm({ ...form, guests: Math.min(20, form.guests + 1) })} data-testid="guests-plus">+</button>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Orario</Label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="slots-grid">
                  {slots.map((s) => (
                    <button type="button" key={s.time} disabled={!s.available} onClick={() => setForm({ ...form, time: s.time })} data-testid={`slot-${s.time}`}
                      className={`h-12 rounded-lg border font-semibold tabular-nums transition-colors duration-200 disabled:opacity-30 disabled:line-through ${form.time === s.time ? "bg-[#D97706] text-white border-[#D97706]" : "bg-white border-[#e7e0d3] hover:border-[#D97706]"}`}>
                      {s.time}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="bg-white border border-[#e7e0d3] rounded-2xl p-6 space-y-4">
              <h2 className="font-display text-xl font-bold">I tuoi dati</h2>
              <div className="space-y-1"><Label>Nome e cognome</Label><Input className="h-12" value={form.name} onChange={f("name")} required data-testid="booking-name" /></div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1"><Label>Telefono</Label><Input type="tel" className="h-12" value={form.phone} onChange={f("phone")} required data-testid="booking-phone" /></div>
                <div className="space-y-1"><Label>Email (opzionale)</Label><Input type="email" className="h-12" value={form.email} onChange={f("email")} data-testid="booking-email" /></div>
              </div>
              <div className="space-y-1"><Label>Note (allergie, seggiolone…)</Label><Textarea value={form.notes} onChange={f("notes")} data-testid="booking-notes" /></div>
            </section>

            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="booking-error">{error}</div>}
            <Button type="submit" className="w-full h-14 text-lg bg-[#D97706] hover:bg-[#b45309] active:scale-[0.98] transition-transform" disabled={loading} data-testid="booking-submit">
              {loading ? "Invio…" : "Prenota il tavolo"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
