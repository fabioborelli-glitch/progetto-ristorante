import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { BellRing, Users, Clock, Check } from "lucide-react";
import { api, imgUrl } from "@/lib/api";

export default function WaitStatus() {
  const { slug, code } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const wasCalled = useRef(false);

  useEffect(() => {
    const load = () => api.get(`/public/${slug}/waitlist/${code}`).then((r) => {
      setData(r.data);
      if (r.data.status === "chiamato" && !wasCalled.current) {
        wasCalled.current = true;
        try { navigator.vibrate?.([300, 100, 300]); } catch {}
      }
    }).catch((e) => setError(e?.response?.data?.detail || "Codice non trovato"));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [slug, code]);

  if (error) return <div className="min-h-screen grid place-items-center bg-[#FDFBF7] text-[#292524] p-6 text-center" data-testid="wait-error">{error}</div>;
  if (!data) return <div className="min-h-screen bg-[#FDFBF7]" />;

  const minutes = Math.floor((Date.now() - new Date(data.created_at).getTime()) / 60000);
  const called = data.status === "chiamato";
  const seated = data.status === "seduto";
  const closed = ["annullato", "no_show"].includes(data.status);

  return (
    <div className={`min-h-screen p-6 transition-colors duration-500 ${called ? "bg-[#D97706] text-white" : "bg-[#FDFBF7] text-[#292524]"}`} data-testid="wait-status-page">
      <div className="max-w-md mx-auto pt-10 space-y-8 text-center">
        <div className="flex items-center justify-center gap-3">
          {data.restaurant.logo_url && <img src={imgUrl(data.restaurant.logo_url)} alt="" className="h-12 w-12 rounded-xl object-cover" />}
          <div className="font-display text-2xl font-extrabold" data-testid="wait-restaurant">{data.restaurant.name}</div>
        </div>

        {called ? (
          <div className="space-y-4 fade-up" data-testid="wait-called">
            <div className="h-28 w-28 mx-auto rounded-full bg-white/20 grid place-items-center pulse-new"><BellRing size={56} /></div>
            <h1 className="font-display text-5xl font-extrabold leading-none">Il tuo tavolo è pronto!</h1>
            <p className="text-lg opacity-90">{data.name}, presentati all'ingresso: ti stiamo aspettando.</p>
          </div>
        ) : seated ? (
          <div className="space-y-4" data-testid="wait-seated">
            <div className="h-20 w-20 mx-auto rounded-full bg-emerald-100 text-emerald-700 grid place-items-center"><Check size={40} /></div>
            <h1 className="font-display text-4xl font-extrabold">Buon appetito!</h1>
          </div>
        ) : closed ? (
          <div className="space-y-4" data-testid="wait-closed">
            <h1 className="font-display text-3xl font-extrabold">Attesa conclusa</h1>
            <p className="text-[#78716c]">Questa prenotazione in lista non è più attiva. Rivolgiti al personale.</p>
          </div>
        ) : (
          <div className="space-y-6" data-testid="wait-queue">
            <div>
              <div className="text-xs uppercase tracking-widest text-[#D97706] font-bold">Davanti a te</div>
              <div className="font-display text-8xl font-extrabold leading-none mt-2 tabular-nums" data-testid="wait-ahead">{data.ahead}</div>
              <div className="text-[#78716c] mt-2">{data.ahead === 0 ? "Sei il prossimo!" : data.ahead === 1 ? "gruppo in coda" : "gruppi in coda"}</div>
            </div>
            <div className="bg-white border border-[#e7e0d3] rounded-2xl p-5 text-left space-y-2">
              <div className="font-semibold text-lg">{data.name}</div>
              <div className="text-sm text-[#78716c] flex gap-4">
                <span className="inline-flex items-center gap-1"><Users size={14} />{data.guests} persone</span>
                <span className="inline-flex items-center gap-1"><Clock size={14} />in attesa da {minutes} min</span>
              </div>
              {data.quoted_minutes != null && <div className="text-sm text-[#78716c]">Attesa stimata: circa {data.quoted_minutes} minuti</div>}
            </div>
            <p className="text-xs text-[#a8a29e]">Tieni aperta questa pagina: si aggiorna da sola e ti avvisa quando il tavolo è pronto.</p>
          </div>
        )}
        {data.restaurant.phone && <div className={`text-sm ${called ? "text-white/80" : "text-[#78716c]"}`}>Tel. {data.restaurant.phone}</div>}
      </div>
    </div>
  );
}
