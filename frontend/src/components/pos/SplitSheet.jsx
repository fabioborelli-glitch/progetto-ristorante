import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtEur } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export function SplitSheet({ open, onClose, bill, onChanged }) {
  const [sel, setSel] = useState({});
  const [parts, setParts] = useState(2);

  useEffect(() => { if (open) setSel({}); }, [open]);

  const setQty = (key, max, d) => setSel((s) => ({ ...s, [key]: Math.max(0, Math.min(max, (s[key] || 0) + d)) }));
  const selected = bill.lines.filter((l) => sel[l.key] > 0);
  const selTotal = selected.reduce((a, l) => a + sel[l.key] * l.price, 0);
  const allSelected = bill.lines.every((l) => (sel[l.key] || 0) === l.qty);

  const split = async () => {
    try {
      const { data } = await api.post(`/t/bills/${bill.id}/split`, { lines: selected.map((l) => ({ key: l.key, qty: sel[l.key] })) });
      toast.success(`Nuovo conto diviso: ${fmtEur(data.total)}`);
      onChanged(data);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md overflow-y-auto" data-testid="split-sheet">
        <SheetHeader><SheetTitle className="font-display text-2xl">Dividi il conto</SheetTitle></SheetHeader>
        <div className="mt-5 space-y-6">
          <section className="bg-gray-50 border border-gray-200 rounded-xl p-4" data-testid="split-equal">
            <div className="font-semibold mb-2">Alla romana</div>
            <div className="flex items-center gap-3">
              <button onClick={() => setParts(Math.max(2, parts - 1))} className="h-11 w-11 rounded-lg border bg-white text-xl" data-testid="split-parts-minus">−</button>
              <div className="font-display text-2xl font-extrabold w-10 text-center tabular-nums" data-testid="split-parts">{parts}</div>
              <button onClick={() => setParts(parts + 1)} className="h-11 w-11 rounded-lg border bg-white text-xl" data-testid="split-parts-plus">+</button>
              <div className="ml-auto text-right">
                <div className="text-xs text-gray-500">a persona</div>
                <div className="font-display text-2xl font-extrabold tabular-nums" data-testid="split-per-person">{fmtEur(bill.total / parts)}</div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">Registra più incassi con "Incassa" inserendo l'importo di ciascuno.</p>
          </section>

          <section>
            <div className="font-semibold mb-1">Per piatti</div>
            <p className="text-xs text-gray-500 mb-3">Seleziona le quantità da spostare su un nuovo conto separato.</p>
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl">
              {bill.lines.map((l) => (
                <div key={l.key} className="flex items-center gap-3 px-3 py-2.5 text-sm" data-testid={`split-line-${l.key}`}>
                  <div className="flex-1 min-w-0"><div className="font-medium truncate">{l.name}</div><div className="text-xs text-gray-500">{l.qty} × {fmtEur(l.price)}</div></div>
                  <div className="flex items-center gap-1 bg-gray-100 rounded-full">
                    <button onClick={() => setQty(l.key, l.qty, -1)} className="h-9 w-9" data-testid={`split-minus-${l.key}`}>−</button>
                    <span className="w-6 text-center font-bold tabular-nums">{sel[l.key] || 0}</span>
                    <button onClick={() => setQty(l.key, l.qty, 1)} className="h-9 w-9" data-testid={`split-plus-${l.key}`}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center mt-3 text-sm"><span>Nuovo conto</span><span className="font-display text-xl font-extrabold tabular-nums" data-testid="split-selected-total">{fmtEur(selTotal)}</span></div>
            <Button className="w-full h-12 mt-3 bg-gray-900 hover:bg-gray-800" disabled={selected.length === 0 || allSelected} onClick={split} data-testid="split-confirm-btn">Crea conto separato</Button>
            {allSelected && bill.lines.length > 0 && <p className="text-xs text-red-600 mt-2">Non puoi spostare tutte le righe.</p>}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
