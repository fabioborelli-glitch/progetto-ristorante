import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Printer, ExternalLink } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

const qrSrc = (url, size = 220) => `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(url)}`;

export default function QrTables() {
  const { tenant } = useAuth();
  const [tables, setTables] = useState([]);
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    Promise.all([api.get("/t/tables"), api.get("/t/rooms")])
      .then(([t, r]) => { setTables(t.data); setRooms(r.data); })
      .catch((e) => toast.error(errMsg(e)));
  }, []);

  const menuUrl = (code) => `${window.location.origin}/r/${tenant?.slug}/menu?t=${code}`;
  const bookingUrl = `${window.location.origin}/r/${tenant?.slug}/prenota`;

  return (
    <div className="space-y-8 max-w-6xl" data-testid="qr-page">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">QR Tavoli</h1>
          <p className="text-gray-500 text-sm mt-1">Stampa e posiziona un QR su ogni tavolo: il cliente ordina dal proprio telefono.</p>
        </div>
        <Button variant="outline" className="h-12" onClick={() => window.print()} data-testid="print-qr-btn"><Printer size={16} className="mr-2" />Stampa tutti</Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-wrap items-center gap-6 print:hidden" data-testid="booking-qr-card">
        <img src={qrSrc(bookingUrl, 140)} alt="QR prenotazioni" className="h-32 w-32" />
        <div>
          <div className="font-display text-xl font-bold">Prenotazioni online</div>
          <p className="text-sm text-gray-500 mt-1">Condividi questo link su Google, Instagram o sito web.</p>
          <a href={bookingUrl} target="_blank" rel="noreferrer" className="text-sm text-[#E03131] mt-2 inline-flex items-center gap-1 hover:underline" data-testid="booking-link">{bookingUrl} <ExternalLink size={12} /></a>
        </div>
      </div>

      {rooms.map((room) => {
        const list = tables.filter((t) => t.room_id === room.id);
        if (list.length === 0) return null;
        return (
          <section key={room.id}>
            <h2 className="font-display text-lg font-bold mb-4">{room.name}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {list.map((t) => (
                <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col items-center text-center gap-3 break-inside-avoid" data-testid={`qr-card-${t.name}`}>
                  <div className="font-display text-xs font-bold tracking-widest uppercase text-gray-400">{tenant?.name}</div>
                  <img src={qrSrc(menuUrl(t.code))} alt={`QR ${t.name}`} className="h-40 w-40" />
                  <div className="font-display text-3xl font-extrabold">Tavolo {t.name}</div>
                  <div className="text-xs text-gray-500">Inquadra per vedere il menu e ordinare</div>
                  <a href={menuUrl(t.code)} target="_blank" rel="noreferrer" className="text-xs text-[#E03131] hover:underline print:hidden" data-testid={`qr-link-${t.name}`}>Apri menu · {t.code}</a>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
