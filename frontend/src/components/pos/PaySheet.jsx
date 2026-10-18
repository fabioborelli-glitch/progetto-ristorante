import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, CreditCard, Shuffle } from "lucide-react";
import { api, errMsg, fmtEur } from "@/lib/api";
import { newClientId } from "@/lib/offline";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PaySheet({ open, onClose, bill, onChanged }) {
  const [mode, setMode] = useState(null);
  const [amount, setAmount] = useState("");
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const remaining = Math.max(0, bill.remaining);

  useEffect(() => {
    if (open) {
      setMode(null);
      setAmount(remaining.toFixed(2));
      setCash("");
      setCard("");
    }
  }, [open, remaining]);

  const pay = async (payments) => {
    try {
      let data = bill;
      for (const pm of payments.filter((p) => p.amount > 0)) {
        ({ data } = await api.post(`/t/bills/${bill.id}/payments`, { ...pm, client_id: newClientId() }));
      }
      onChanged(data);
      toast.success(data.remaining <= 0.009 ? "Conto saldato: puoi chiuderlo" : `Incassato, restano ${fmtEur(data.remaining)}`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const change = mode === "contanti" && parseFloat(amount) > remaining ? parseFloat(amount) - remaining : 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md" data-testid="pay-sheet">
        <SheetHeader><SheetTitle className="font-display text-2xl">Incassa</SheetTitle></SheetHeader>
        <div className="mt-5 space-y-6">
          <div className="bg-gray-900 text-white rounded-xl p-5 flex justify-between items-baseline">
            <span className="text-sm text-gray-300">Da incassare</span>
            <span className="font-display text-4xl font-extrabold tabular-nums" data-testid="pay-remaining">{fmtEur(remaining)}</span>
          </div>

          {!mode ? (
            <div className="grid gap-3">
              <Big icon={Banknote} label="Contanti" sub="incasso totale" onClick={() => pay([{ method: "contanti", amount: remaining }])} testid="pay-cash-full" />
              <Big icon={CreditCard} label="Carta / POS" sub="incasso totale" onClick={() => pay([{ method: "carta", amount: remaining }])} testid="pay-card-full" />
              <Big icon={Shuffle} label="Misto / parziale" sub="contanti + carta o importo personalizzato" onClick={() => setMode("misto")} testid="pay-mixed" />
              <button onClick={() => setMode("contanti")} className="text-sm text-gray-500 underline mt-1" data-testid="pay-cash-custom">Contanti con calcolo resto</button>
            </div>
          ) : mode === "misto" ? (
            <div className="space-y-4">
              <div className="space-y-1"><Label>Contanti (€)</Label><Input type="number" step="0.01" className="h-12 text-lg" value={cash} onChange={(e) => setCash(e.target.value)} data-testid="pay-mixed-cash" /></div>
              <div className="space-y-1"><Label>Carta (€)</Label><Input type="number" step="0.01" className="h-12 text-lg" value={card} onChange={(e) => setCard(e.target.value)} data-testid="pay-mixed-card" /></div>
              <div className="flex gap-2">
                <Button variant="outline" className="h-12 flex-1" onClick={() => setCard(Math.max(0, remaining - (parseFloat(cash) || 0)).toFixed(2))} data-testid="pay-mixed-rest-card">Resto su carta</Button>
                <Button className="h-12 flex-1 bg-[#E03131] hover:bg-[#c42727]" onClick={() => pay([{ method: "contanti", amount: parseFloat(cash) || 0 }, { method: "carta", amount: parseFloat(card) || 0 }])} disabled={!(parseFloat(cash) > 0 || parseFloat(card) > 0)} data-testid="pay-mixed-confirm">Registra</Button>
              </div>
              <button onClick={() => setMode(null)} className="text-sm text-gray-500 underline">Indietro</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1"><Label>Contanti ricevuti (€)</Label><Input type="number" step="0.01" className="h-12 text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="pay-cash-amount" /></div>
              {change > 0 && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex justify-between"><span>Resto da dare</span><b className="tabular-nums" data-testid="pay-change">{fmtEur(change)}</b></div>}
              <Button className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" onClick={() => pay([{ method: "contanti", amount: Math.min(parseFloat(amount) || 0, remaining) }])} disabled={!(parseFloat(amount) > 0)} data-testid="pay-cash-confirm">Registra contanti</Button>
              <button onClick={() => setMode(null)} className="text-sm text-gray-500 underline">Indietro</button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Big({ icon: Icon, label, sub, onClick, testid }) {
  return (
    <button onClick={onClick} data-testid={testid} className="h-20 rounded-xl border border-gray-200 px-5 flex items-center gap-4 text-left hover:border-gray-900 active:scale-[0.98] transition-transform">
      <Icon size={26} className="text-[#E03131]" />
      <div><div className="font-semibold text-lg">{label}</div><div className="text-xs text-gray-500">{sub}</div></div>
    </button>
  );
}
