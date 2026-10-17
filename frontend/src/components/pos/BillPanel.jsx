import { useState } from "react";
import { toast } from "sonner";
import { Plus, Scissors, Percent, Banknote, CheckCircle2, FileText, Trash2, X } from "lucide-react";
import { api, errMsg, fmtEur, PAY_METHODS } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AddItemsSheet } from "@/components/pos/AddItemsSheet";
import { SplitSheet } from "@/components/pos/SplitSheet";
import { PaySheet } from "@/components/pos/PaySheet";
import { DiscountSheet } from "@/components/pos/DiscountSheet";

export async function openReceipt(billId) {
  try {
    const res = await api.get(`/t/bills/${billId}/receipt.pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast.error(errMsg(e));
  }
}

export function BillPanel({ bill, onChanged, canEdit }) {
  const [sheet, setSheet] = useState(null);
  const closed = bill.status === "chiuso";

  const call = async (fn, ok) => {
    try {
      const { data } = await fn();
      onChanged(data);
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const close = () => call(() => api.post(`/t/bills/${bill.id}/close`), `Conto chiuso · ${bill.table_name}`);
  const removeLine = (key) => call(() => api.delete(`/t/bills/${bill.id}/lines/${encodeURIComponent(key)}`));
  const removePayment = (pid) => call(() => api.delete(`/t/bills/${bill.id}/payments/${pid}`));
  const cancel = async () => {
    if (!window.confirm("Annullare questo conto? Gli ordini torneranno disponibili per un nuovo conto.")) return;
    try {
      await api.delete(`/t/bills/${bill.id}`);
      toast.success("Conto annullato");
      onChanged(null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl flex flex-col max-h-[calc(100vh-8rem)]" data-testid="bill-panel">
      <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between">
        <div>
          <div className="font-display text-2xl font-extrabold">Tavolo {bill.table_name} {bill.parent_id && <span className="text-sm font-medium text-blue-700 ml-1">conto diviso</span>}</div>
          <div className="text-xs text-gray-500">{closed ? `Conto n. ${bill.number} · chiuso` : `Aperto · ${bill.covers || "-"} coperti`}</div>
        </div>
        <button onClick={() => onChanged(null)} className="h-9 w-9 grid place-items-center rounded-full hover:bg-gray-100" data-testid="bill-close-panel"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3 divide-y divide-gray-100" data-testid="bill-lines">
        {bill.lines.length === 0 && <div className="py-8 text-center text-gray-400 text-sm">Nessun piatto. Aggiungi dal menu o attendi gli ordini QR.</div>}
        {bill.lines.map((l) => (
          <div key={l.key} className="flex items-center gap-3 py-2.5 text-sm" data-testid={`bill-line-${l.key}`}>
            <span className="font-display text-lg font-extrabold w-7 tabular-nums">{l.qty}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{l.name}</div>
              {l.variant && <div className="text-xs text-amber-700">{l.variant}</div>}
            </div>
            <span className="tabular-nums font-medium">{fmtEur(l.qty * l.price)}</span>
            {!closed && canEdit && <button onClick={() => removeLine(l.key)} className="h-8 w-8 grid place-items-center text-gray-400 hover:text-red-600" data-testid={`bill-line-remove-${l.key}`}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>

      <div className="px-5 py-4 border-t border-gray-200 space-y-1.5 text-sm">
        <Row label="Subtotale" value={fmtEur(bill.subtotal)} />
        {bill.discount_amount > 0 && <Row label={bill.discount_type === "percent" ? `Sconto ${bill.discount_value}%` : "Sconto"} value={`− ${fmtEur(bill.discount_amount)}`} cls="text-emerald-700" />}
        <div className="flex justify-between items-baseline pt-1"><span className="font-semibold">Totale</span><span className="font-display text-3xl font-extrabold tabular-nums" data-testid="bill-total">{fmtEur(bill.total)}</span></div>
        {bill.payments.map((pm) => (
          <div key={pm.id} className="flex justify-between items-center text-gray-600" data-testid={`bill-payment-${pm.id}`}>
            <span>Pagato {PAY_METHODS[pm.method]}</span>
            <span className="inline-flex items-center gap-2 tabular-nums">{fmtEur(pm.amount)}{!closed && <button onClick={() => removePayment(pm.id)} className="text-gray-400 hover:text-red-600" data-testid={`bill-payment-remove-${pm.id}`}><X size={14} /></button>}</span>
          </div>
        ))}
        {bill.payments.length > 0 && !closed && <Row label="Resta da incassare" value={fmtEur(Math.max(0, bill.remaining))} cls="font-semibold text-[#E03131]" testid="bill-remaining" />}
      </div>

      <div className="p-3 border-t border-gray-200 grid grid-cols-2 gap-2">
        {closed ? (
          <>
            <Button variant="outline" className="h-14 col-span-2" onClick={() => openReceipt(bill.id)} data-testid="bill-receipt-btn"><FileText size={16} className="mr-2" />Scontrino PDF</Button>
          </>
        ) : (
          <>
            <Action icon={Plus} label="Aggiungi" onClick={() => setSheet("add")} testid="bill-add-btn" />
            <Action icon={Scissors} label="Dividi" onClick={() => setSheet("split")} testid="bill-split-btn" disabled={bill.lines.length < 1} />
            <Action icon={Percent} label="Sconto" onClick={() => setSheet("discount")} testid="bill-discount-btn" />
            <Action icon={Banknote} label="Incassa" onClick={() => setSheet("pay")} testid="bill-pay-btn" disabled={bill.remaining <= 0} primary />
            <Button className="h-14 col-span-2 bg-emerald-600 hover:bg-emerald-700 text-base font-bold active:scale-[0.98] transition-transform" disabled={bill.remaining > 0.009 || bill.lines.length === 0} onClick={close} data-testid="bill-close-btn">
              <CheckCircle2 size={18} className="mr-2" />Chiudi conto
            </Button>
            <div className="col-span-2 flex justify-between">
              <button onClick={() => openReceipt(bill.id)} className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1" data-testid="bill-preconto-btn"><FileText size={12} />Preconto PDF</button>
              {canEdit && <button onClick={cancel} className="text-xs text-red-600 hover:underline" data-testid="bill-cancel-btn">Annulla conto</button>}
            </div>
          </>
        )}
      </div>

      <AddItemsSheet open={sheet === "add"} onClose={() => setSheet(null)} bill={bill} onChanged={onChanged} />
      <SplitSheet open={sheet === "split"} onClose={() => setSheet(null)} bill={bill} onChanged={onChanged} />
      <PaySheet open={sheet === "pay"} onClose={() => setSheet(null)} bill={bill} onChanged={onChanged} />
      <DiscountSheet open={sheet === "discount"} onClose={() => setSheet(null)} bill={bill} onChanged={onChanged} />
    </div>
  );
}

function Row({ label, value, cls = "", testid }) {
  return <div className={`flex justify-between ${cls}`} data-testid={testid}><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}

function Action({ icon: Icon, label, onClick, testid, disabled, primary }) {
  return (
    <button onClick={onClick} disabled={disabled} data-testid={testid}
      className={`h-14 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40 ${primary ? "bg-[#E03131] text-white hover:bg-[#c42727]" : "border border-gray-300 hover:bg-gray-50"}`}>
      <Icon size={16} />{label}
    </button>
  );
}
