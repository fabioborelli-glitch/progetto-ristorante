import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtEur } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DiscountSheet({ open, onClose, bill, onChanged }) {
  const [type, setType] = useState("percent");
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) {
      setType(bill.discount_type || "percent");
      setValue(bill.discount_value ? String(bill.discount_value) : "");
    }
  }, [open, bill]);

  const apply = async (payload) => {
    try {
      const { data } = await api.patch(`/t/bills/${bill.id}`, payload);
      onChanged(data);
      toast.success(payload.clear_discount ? "Sconto rimosso" : "Sconto applicato");
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const v = parseFloat(value) || 0;
  const preview = type === "percent" ? bill.subtotal * v / 100 : Math.min(v, bill.subtotal);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md" data-testid="discount-sheet">
        <SheetHeader><SheetTitle className="font-display text-2xl">Sconto</SheetTitle></SheetHeader>
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {[["percent", "Percentuale %"], ["amount", "Importo €"]].map(([k, l]) => (
              <button key={k} onClick={() => setType(k)} className={`h-12 rounded-lg border font-medium ${type === k ? "bg-gray-900 text-white border-gray-900" : "border-gray-200"}`} data-testid={`discount-type-${k}`}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(type === "percent" ? [5, 10, 15, 20] : [1, 2, 5, 10]).map((n) => (
              <button key={n} onClick={() => setValue(String(n))} className="h-12 rounded-lg border border-gray-200 font-semibold hover:bg-gray-50" data-testid={`discount-quick-${n}`}>{type === "percent" ? `${n}%` : `${n} €`}</button>
            ))}
          </div>
          <div className="space-y-1"><Label>Valore</Label><Input type="number" step="0.5" min={0} className="h-12 text-lg" value={value} onChange={(e) => setValue(e.target.value)} data-testid="discount-value" /></div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm flex justify-between"><span>Sconto</span><b className="tabular-nums" data-testid="discount-preview">− {fmtEur(preview)}</b></div>
          <div className="flex gap-2">
            {bill.discount_amount > 0 && <Button variant="outline" className="h-12 flex-1" onClick={() => apply({ clear_discount: true })} data-testid="discount-clear-btn">Rimuovi</Button>}
            <Button className="h-12 flex-1 bg-[#E03131] hover:bg-[#c42727]" disabled={v <= 0} onClick={() => apply({ discount_type: type, discount_value: v })} data-testid="discount-apply-btn">Applica</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
