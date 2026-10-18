import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Trash2, QrCode, Receipt, ClipboardList } from "lucide-react";
import { api, errMsg, fmtEur, TABLE_STATUS, ORDER_STATUS } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { WaiterOrderSheet } from "@/components/WaiterOrderSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function TableSheet({ table, onClose, onChanged, canEdit }) {
  const { tenant } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [ordering, setOrdering] = useState(false);
  const [edit, setEdit] = useState({ name: "", seats: 4 });

  const loadOrders = () => table && api.get("/t/orders").then((r) => setOrders(r.data.filter((o) => o.table_id === table.id))).catch(() => {});

  useEffect(() => {
    if (!table) return;
    setEdit({ name: table.name, seats: table.seats });
    loadOrders();
  }, [table]);

  if (!table) return null;

  const setStatus = async (status) => {
    try {
      await api.patch(`/t/tables/${table.id}`, { status });
      toast.success(`Tavolo ${table.name}: ${TABLE_STATUS[status].label}`);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const save = async () => {
    try {
      await api.patch(`/t/tables/${table.id}`, edit);
      toast.success("Tavolo aggiornato");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async () => {
    if (!window.confirm(`Eliminare il tavolo ${table.name}?`)) return;
    try {
      await api.delete(`/t/tables/${table.id}`);
      toast.success("Tavolo eliminato");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const st = TABLE_STATUS[table.status];
  const menuUrl = `${window.location.origin}/r/${tenant?.slug}/menu?t=${table.code}`;

  return (
    <Sheet open={!!table} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md overflow-y-auto" data-testid="table-sheet">
        <SheetHeader>
          <SheetTitle className="font-display text-3xl flex items-center gap-3">
            Tavolo {table.name}
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${st.soft} ${st.text}`} data-testid="table-sheet-status">{st.label}</span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-8">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setOrdering(true)} className="h-16 rounded-xl bg-gray-900 text-white font-display text-lg font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform" data-testid="take-order-btn">
              <ClipboardList size={20} /> Prendi comanda
            </button>
            <button onClick={() => navigate(`/cassa?table=${table.id}`)} className="h-16 rounded-xl bg-[#E03131] text-white font-display text-lg font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform" data-testid="go-to-pos-btn">
              <Receipt size={20} /> {table.status === "libero" ? "Apri conto" : "Vai al conto"}
            </button>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Cambia stato</div>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(TABLE_STATUS).map(([k, v]) => (
                <button key={k} onClick={() => setStatus(k)} disabled={table.status === k} data-testid={`set-status-${k}`}
                  className={`h-14 rounded-lg border text-left px-4 font-medium flex items-center gap-3 transition-colors duration-200 active:scale-[0.98] disabled:opacity-40 ${table.status === k ? "border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>
                  <span className={`h-3 w-3 rounded-full ${v.color}`} />{v.label}
                  {k === "libero" && table.status !== "libero" && <span className="ml-auto text-xs text-gray-500">chiude gli ordini</span>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Ordini aperti ({orders.length})</div>
            {orders.length === 0 ? (
              <div className="text-sm text-gray-500">Nessun ordine attivo.</div>
            ) : (
              <div className="space-y-3">
                {orders.map((o) => (
                  <div key={o.id} className={`border-l-4 ${ORDER_STATUS[o.status].color} bg-gray-50 rounded-r-lg p-3 text-sm`} data-testid={`table-order-${o.id}`}>
                    <div className="flex justify-between font-medium"><span>{ORDER_STATUS[o.status].label}</span><span>{fmtEur(o.total)}</span></div>
                    <ul className="mt-1 text-gray-600">
                      {o.items.map((it, i) => <li key={i}>{it.qty}× {it.name}{it.variant ? ` (${it.variant})` : ""}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">QR ordinazione</div>
            <a href={menuUrl} target="_blank" rel="noreferrer" className="text-sm text-[#E03131] inline-flex items-center gap-2 hover:underline break-all" data-testid="table-menu-link">
              <QrCode size={16} /> Codice {table.code}
            </a>
          </div>

          {canEdit && (
            <div className="border-t border-gray-200 pt-6 space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Modifica</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Nome</Label><Input className="h-11" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="edit-table-name" /></div>
                <div className="space-y-1"><Label>Posti</Label><Input className="h-11" type="number" min={1} value={edit.seats} onChange={(e) => setEdit({ ...edit, seats: +e.target.value })} data-testid="edit-table-seats" /></div>
              </div>
              <div className="flex gap-2">
                <Button className="flex-1 h-11 bg-gray-900 hover:bg-gray-800" onClick={save} data-testid="save-table-btn">Salva</Button>
                <Button variant="outline" className="h-11 text-red-600 border-red-200 hover:bg-red-50" onClick={remove} data-testid="delete-table-btn"><Trash2 size={16} /></Button>
              </div>
            </div>
          )}
        </div>
        <WaiterOrderSheet open={ordering} onClose={() => setOrdering(false)} table={table} onSent={() => { loadOrders(); onChanged(); }} />
      </SheetContent>
    </Sheet>
  );
}
