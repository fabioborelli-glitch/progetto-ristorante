import { buildReceipt, buildTestPrint, receiptHtml } from "@/lib/escpos";

const SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
];

let device = null;
let characteristic = null;
const listeners = new Set();

export const btSupported = () => typeof navigator !== "undefined" && !!navigator.bluetooth;
export const isConnected = () => !!(device?.gatt?.connected && characteristic);
export const deviceName = () => device?.name || localStorage.getItem("ristoos_bt_printer") || "";
export const autoPrintEnabled = () => localStorage.getItem("ristoos_autoprint") === "1";
export const setAutoPrint = (v) => localStorage.setItem("ristoos_autoprint", v ? "1" : "0");

export function onPrinterChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn(isConnected()));

async function findCharacteristic(server) {
  for (const uuid of SERVICES) {
    try {
      const service = await server.getPrimaryService(uuid);
      const chars = await service.getCharacteristics();
      const w = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
      if (w) return w;
    } catch {}
  }
  throw new Error("Nessuna caratteristica di stampa trovata: stampante non compatibile ESC/POS BLE");
}

export async function connectPrinter() {
  if (!btSupported()) throw new Error("Web Bluetooth non disponibile: usa Chrome su Android, Windows o macOS");
  device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  device.addEventListener("gattserverdisconnected", () => { characteristic = null; notify(); });
  const server = await device.gatt.connect();
  characteristic = await findCharacteristic(server);
  localStorage.setItem("ristoos_bt_printer", device.name || "Stampante BT");
  notify();
  return device.name;
}

export async function disconnectPrinter() {
  try { device?.gatt?.disconnect(); } catch {}
  device = null;
  characteristic = null;
  localStorage.removeItem("ristoos_bt_printer");
  notify();
}

async function writeBytes(bytes) {
  if (!isConnected()) throw new Error("Stampante Bluetooth non collegata");
  const CHUNK = 100;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.slice(i, i + CHUNK);
    if (characteristic.properties.writeWithoutResponse) await characteristic.writeValueWithoutResponse(slice);
    else await characteristic.writeValue(slice);
    await new Promise((r) => setTimeout(r, 20));
  }
}

export const printReceiptBluetooth = (bill, tenant) => writeBytes(buildReceipt(bill, tenant));
export const printTestBluetooth = (tenant) => writeBytes(buildTestPrint(tenant));

export function printReceiptSystem(bill, tenant) {
  const w = window.open("", "_blank", "width=420,height=720");
  if (!w) throw new Error("Popup bloccato: consenti le finestre popup per stampare");
  w.document.open();
  w.document.write(receiptHtml(bill, tenant));
  w.document.close();
}
