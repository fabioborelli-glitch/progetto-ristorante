import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bluetooth, BluetoothOff, Printer } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { btSupported, isConnected, deviceName, connectPrinter, disconnectPrinter, printTestBluetooth, onPrinterChange, autoPrintEnabled, setAutoPrint, printReceiptSystem } from "@/lib/printer";

export function PrinterSettings() {
  const { tenant } = useAuth();
  const [connected, setConnected] = useState(isConnected());
  const [auto, setAuto] = useState(autoPrintEnabled());
  const [busy, setBusy] = useState(false);

  useEffect(() => onPrinterChange(setConnected), []);

  const connect = async () => {
    setBusy(true);
    try {
      const name = await connectPrinter();
      toast.success(`Collegata: ${name || "stampante"}`);
    } catch (e) {
      if (e?.name !== "NotFoundError") toast.error(e.message || "Connessione fallita");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try { await printTestBluetooth(tenant); toast.success("Stampa di prova inviata"); } catch (e) { toast.error(e.message); }
  };

  const testSystem = () => {
    try {
      printReceiptSystem({ table_name: "Prova", lines: [{ key: "x", name: "Stampa di prova", qty: 1, price: 0 }], subtotal: 0, discount_amount: 0, total: 0, payments: [], covers: 0 }, tenant);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6 md:p-8 space-y-5" data-testid="printer-section">
      <div>
        <h2 className="font-display text-lg font-bold">Stampante scontrini</h2>
        <p className="text-sm text-gray-500 mt-1">Le impostazioni valgono per questo dispositivo di cassa. Stampa di sistema (80mm) sempre disponibile; Bluetooth ESC/POS richiede Chrome.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-4">
        {connected ? <Bluetooth className="text-blue-600" /> : <BluetoothOff className="text-gray-400" />}
        <div className="flex-1 min-w-[160px]">
          <div className="font-medium" data-testid="printer-status">{connected ? `Collegata · ${deviceName()}` : btSupported() ? "Nessuna stampante Bluetooth collegata" : "Bluetooth non supportato da questo browser"}</div>
          <div className="text-xs text-gray-500">Stampanti termiche 58/80mm con protocollo ESC/POS via BLE</div>
        </div>
        {connected ? (
          <>
            <Button variant="outline" onClick={test} data-testid="printer-test-btn">Stampa di prova</Button>
            <Button variant="ghost" onClick={disconnectPrinter} data-testid="printer-disconnect-btn">Scollega</Button>
          </>
        ) : (
          <Button onClick={connect} disabled={!btSupported() || busy} className="bg-gray-900 hover:bg-gray-800" data-testid="printer-connect-btn"><Bluetooth size={16} className="mr-2" />{busy ? "Ricerca…" : "Collega Bluetooth"}</Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-3 text-sm"><Switch checked={auto} onCheckedChange={(v) => { setAuto(v); setAutoPrint(v); }} data-testid="printer-autoprint-switch" />Stampa automatica alla chiusura del conto</label>
        <Button variant="outline" size="sm" onClick={testSystem} data-testid="printer-system-test-btn"><Printer size={14} className="mr-2" />Prova stampa di sistema</Button>
      </div>
    </section>
  );
}
