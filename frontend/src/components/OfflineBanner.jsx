import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { useOffline } from "@/hooks/useOffline";
import { loadConflicts, clearConflicts, flush } from "@/lib/offline";

export function OfflineBanner({ dark = false }) {
  const s = useOffline();
  const [showSynced, setShowSynced] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);

  useEffect(() => {
    if (s.lastSync) {
      setShowSynced(true);
      const t = setTimeout(() => setShowSynced(false), 4000);
      return () => clearTimeout(t);
    }
  }, [s.lastSync]);

  const base = "fixed top-0 inset-x-0 z-[60] flex items-center justify-center gap-3 px-4 py-2 text-sm font-semibold";
  if (!s.online || s.pending > 0) {
    return (
      <div className={`${base} ${s.syncing ? "bg-amber-500 text-black" : "bg-[#E03131] text-white"}`} data-testid="offline-banner" data-state={s.syncing ? "syncing" : "offline"}>
        {s.syncing ? <RefreshCw size={16} className="animate-spin" /> : <WifiOff size={16} />}
        {s.syncing ? `Sincronizzazione in corso… ${s.pending} ${s.pending === 1 ? "azione" : "azioni"}` : `Modalità offline — ${s.pending} ${s.pending === 1 ? "azione salvata" : "azioni salvate"} sul dispositivo, verranno inviate al ritorno della rete`}
        {!s.syncing && s.pending > 0 && navigator.onLine && <button onClick={flush} className="underline ml-2" data-testid="offline-retry-btn">Riprova ora</button>}
      </div>
    );
  }
  if (s.conflicts > 0) {
    const list = loadConflicts();
    return (
      <div className={`${base} bg-amber-100 text-amber-900 flex-wrap`} data-testid="offline-conflicts-banner">
        <AlertTriangle size={16} />
        {s.conflicts} {s.conflicts === 1 ? "azione offline non applicata" : "azioni offline non applicate"} dal server: da controllare
        <button onClick={() => setShowConflicts(!showConflicts)} className="underline" data-testid="offline-conflicts-toggle">{showConflicts ? "Nascondi" : "Dettagli"}</button>
        <button onClick={clearConflicts} className="ml-2 h-6 w-6 grid place-items-center rounded-full hover:bg-amber-200" data-testid="offline-conflicts-dismiss"><X size={14} /></button>
        {showConflicts && (
          <ul className="w-full max-w-2xl text-xs font-normal bg-white/70 rounded-lg p-3 space-y-1" data-testid="offline-conflicts-list">
            {list.map((c) => <li key={c.id}><b>{c.label || `${c.method.toUpperCase()} ${c.url}`}</b> · {new Date(c.at).toLocaleTimeString("it-IT")} → {c.error}</li>)}
          </ul>
        )}
      </div>
    );
  }
  if (showSynced) {
    return (
      <div className={`${base} bg-emerald-600 text-white fade-up`} data-testid="offline-synced-banner">
        <CheckCircle2 size={16} /> Sincronizzazione completata
      </div>
    );
  }
  return null;
}
