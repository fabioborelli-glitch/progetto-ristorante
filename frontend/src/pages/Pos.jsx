import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Receipt, Wifi, WifiOff, History } from "lucide-react";
import { api, errMsg, fmtEur, TABLE_STATUS, PAY_METHODS } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTenantSocket } from "@/hooks/useTenantSocket";
import { useOnSynced } from "@/hooks/useOffline";
import { BillPanel } from "@/components/pos/BillPanel";
import { HistorySheet } from "@/components/pos/HistorySheet";

export default function Pos() {
  const { role } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tables, setTables] = useState([]);
  const [bills, setBills] = useState([]);
  const [bill, setBill] = useState(null);
  const [summary, setSummary] = useState(null);
  const [histOpen, setHistOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, b, h] = await Promise.all([api.get("/t/tables"), api.get("/t/bills"), api.get("/t/bills/history")]);
      setTables(t.data);
      setBills(b.data);
      setSummary(h.data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  const refreshBill = useCallback(async (id) => {
    if (!id) return;
    try {
      const { data } = await api.get(`/t/bills/${id}`);
      setBill(data);
    } catch {
      setBill(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const tid = params.get("table");
    if (tid && tables.length) openForTable(tid);
  }, [tables.length]);

  const connected = useTenantSocket((event) => {
    if (["orders_changed", "bills_changed", "tables_changed"].includes(event)) {
      load();
      setBill((b) => { if (b && b.status === "aperto") refreshBill(b.id); return b; });
    }
  });

  const openForTable = async (tableId) => {
    try {
      const res = await api.post("/t/bills/open", { table_id: tableId });
      setBill(res.data);
      setParams({});
      load();
    } catch (e) {
      toast.error(errMsg(e, "Aprire un nuovo conto richiede la connessione"));
    }
  };

  useOnSynced(() => { load(); setBill((b) => { if (b) refreshBill(b.id); return b; }); });

  const select = async (b) => refreshBill(b.id);

  const onBillChanged = (updated) => {
    if (updated === null) setBill(null);
    else setBill(updated);
    load();
  };

  const billsByTable = bills.reduce((m, b) => { (m[b.table_id] ||= []).push(b); return m; }, {});
  const active = tables.filter((t) => t.status !== "libero" || t.open_orders > 0 || billsByTable[t.id]);
  const free = tables.filter((t) => !active.includes(t));

  return (
    <div className="flex flex-col gap-6 h-full" data-testid="pos-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Cassa</h1>
          <p className="text-gray-500 text-sm mt-1 inline-flex items-center gap-2">
            Seleziona un tavolo per aprire o gestire il conto.
            <span className={`inline-flex items-center gap-1 text-xs ${connected ? "text-emerald-600" : "text-gray-400"}`} data-testid="pos-ws-status">{connected ? <Wifi size={12} /> : <WifiOff size={12} />}{connected ? "live" : "offline"}</span>
          </p>
        </div>
        {summary && (
          <button onClick={() => setHistOpen(true)} className="bg-white border border-gray-200 rounded-xl px-5 py-3 flex items-center gap-6 hover:bg-gray-50 transition-colors text-left" data-testid="pos-day-summary">
            <div><div className="text-xs text-gray-500">Incasso oggi</div><div className="font-display text-2xl font-extrabold tabular-nums">{fmtEur(summary.total)}</div></div>
            <div><div className="text-xs text-gray-500">Conti chiusi</div><div className="font-display text-2xl font-extrabold tabular-nums">{summary.count}</div></div>
            <div className="hidden sm:block text-xs text-gray-500 space-y-0.5">
              {Object.entries(summary.by_method).map(([m, v]) => <div key={m}>{PAY_METHODS[m] || m}: <b className="text-gray-900">{fmtEur(v)}</b></div>)}
            </div>
            <History size={18} className="text-gray-400" />
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-[1fr_420px] gap-6 flex-1 min-h-0">
        <div className="space-y-6 overflow-y-auto">
          <TableGroup title="Tavoli attivi" tables={active} billsByTable={billsByTable} onOpen={openForTable} onSelect={select} selected={bill?.id} />
          <TableGroup title="Tavoli liberi" tables={free} billsByTable={billsByTable} onOpen={openForTable} onSelect={select} selected={bill?.id} muted />
        </div>
        <div className="lg:sticky lg:top-8 self-start">
          {bill ? (
            <BillPanel bill={bill} onChanged={onBillChanged} canEdit={role === "owner" || role === "manager"} />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400" data-testid="pos-empty-panel">
              <Receipt size={40} className="mx-auto mb-3 opacity-40" />
              Nessun conto selezionato
            </div>
          )}
        </div>
      </div>

      <HistorySheet open={histOpen} onClose={() => setHistOpen(false)} />
    </div>
  );
}

function TableGroup({ title, tables, billsByTable, onOpen, onSelect, selected, muted }) {
  if (tables.length === 0) return null;
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
        {tables.map((t) => {
          const st = TABLE_STATUS[t.status];
          const tb = billsByTable[t.id] || [];
          const main = tb.find((b) => !b.parent_id);
          return (
            <div key={t.id} className={`bg-white border rounded-xl p-4 flex flex-col gap-2 ${muted ? "opacity-70" : ""} ${tb.some((b) => b.id === selected) ? "border-gray-900 ring-1 ring-gray-900" : "border-gray-200"}`} data-testid={`pos-table-${t.name}`}>
              <div className="flex items-center justify-between">
                <div className="font-display text-2xl font-extrabold">{t.name}</div>
                <span className={`h-2.5 w-2.5 rounded-full ${st.color}`} title={st.label} />
              </div>
              <div className="text-xs text-gray-500">{t.open_orders > 0 ? `${t.open_orders} ordini in cucina` : st.label}</div>
              {main ? (
                <button onClick={() => onSelect(main)} className="mt-1 h-12 rounded-lg bg-gray-900 text-white font-semibold flex items-center justify-between px-3 active:scale-95 transition-transform" data-testid={`pos-bill-${t.name}`}>
                  <span className="text-sm">Conto</span><span className="tabular-nums">{fmtEur(main.total)}</span>
                </button>
              ) : (
                <button onClick={() => onOpen(t.id)} className="mt-1 h-12 rounded-lg border border-gray-300 font-semibold text-sm hover:bg-gray-50 active:scale-95 transition-transform" data-testid={`pos-open-${t.name}`}>Apri conto</button>
              )}
              {tb.filter((b) => b.parent_id).map((b, i) => (
                <button key={b.id} onClick={() => onSelect(b)} className="h-10 rounded-lg bg-blue-50 text-blue-800 text-sm font-medium flex items-center justify-between px-3" data-testid={`pos-split-bill-${t.name}-${i}`}>
                  <span>Diviso {i + 1}</span><span className="tabular-nums">{fmtEur(b.total)}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
