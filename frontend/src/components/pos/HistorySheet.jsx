import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api, fmtEur, todayStr, PAY_METHODS } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { openReceipt } from "@/components/pos/BillPanel";

export function HistorySheet({ open, onClose }) {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);

  useEffect(() => {
    if (open) api.get("/t/bills/history", { params: { date } }).then((r) => setData(r.data)).catch(() => setData(null));
  }, [open, date]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto" data-testid="history-sheet">
        <SheetHeader><SheetTitle className="font-display text-2xl">Chiusura di giornata</SheetTitle></SheetHeader>
        <div className="mt-5 space-y-5">
          <Input type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} data-testid="history-date" />
          {data && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Incasso" value={fmtEur(data.total)} testid="history-total" />
                <Stat label="Conti chiusi" value={data.count} testid="history-count" />
                {Object.entries(data.by_method).map(([m, v]) => <Stat key={m} label={PAY_METHODS[m] || m} value={fmtEur(v)} />)}
              </div>
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl" data-testid="history-list">
                {data.bills.length === 0 && <div className="p-6 text-center text-gray-400 text-sm">Nessun conto chiuso.</div>}
                {data.bills.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-3 text-sm" data-testid={`history-bill-${b.id}`}>
                    <div className="flex-1"><div className="font-medium">n. {b.number} · Tavolo {b.table_name}</div><div className="text-xs text-gray-500">{new Date(b.closed_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} · {b.payments.map((p) => PAY_METHODS[p.method]).join(" + ")}</div></div>
                    <span className="font-bold tabular-nums">{fmtEur(b.total)}</span>
                    <button onClick={() => openReceipt(b.id)} className="h-9 w-9 grid place-items-center rounded-lg hover:bg-gray-100" data-testid={`history-receipt-${b.id}`}><FileText size={16} /></button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, testid }) {
  return <div className="bg-gray-50 border border-gray-200 rounded-lg p-3" data-testid={testid}><div className="text-xs text-gray-500">{label}</div><div className="font-display text-xl font-extrabold tabular-nums">{value}</div></div>;
}
