import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, withCredentials: true });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("ristoos_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const actAs = localStorage.getItem("ristoos_act_as");
  if (actAs) config.headers["X-Tenant-Id"] = actAs;
  return config;
});

export function errMsg(e, fallback = "Si è verificato un errore") {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(" ");
  return d?.msg || String(d);
}

export const fmtEur = (n) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);

export const imgUrl = (u) => (u && u.startsWith("/api/") ? `${process.env.REACT_APP_BACKEND_URL}${u}` : u);

export const PAY_METHODS = { contanti: "Contanti", carta: "Carta / POS" };

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const TABLE_STATUS = {
  libero: { label: "Libero", color: "bg-emerald-500", ring: "ring-emerald-500", text: "text-emerald-700", soft: "bg-emerald-50" },
  occupato: { label: "Occupato", color: "bg-amber-500", ring: "ring-amber-500", text: "text-amber-700", soft: "bg-amber-50" },
  in_attesa_conto: { label: "In attesa conto", color: "bg-blue-500", ring: "ring-blue-500", text: "text-blue-700", soft: "bg-blue-50" },
};

export const RES_STATUS = {
  in_attesa: { label: "In attesa", cls: "bg-amber-100 text-amber-800" },
  confermata: { label: "Confermata", cls: "bg-emerald-100 text-emerald-800" },
  seduta: { label: "Seduta", cls: "bg-blue-100 text-blue-800" },
  completata: { label: "Completata", cls: "bg-gray-100 text-gray-700" },
  annullata: { label: "Annullata", cls: "bg-red-100 text-red-800" },
  no_show: { label: "No show", cls: "bg-red-100 text-red-800" },
};

export const ORDER_STATUS = {
  nuovo: { label: "Nuovo", color: "border-blue-500", badge: "bg-blue-500" },
  in_preparazione: { label: "In preparazione", color: "border-amber-500", badge: "bg-amber-500" },
  pronto: { label: "Pronto", color: "border-emerald-500", badge: "bg-emerald-500" },
  servito: { label: "Servito", color: "border-gray-500", badge: "bg-gray-500" },
  annullato: { label: "Annullato", color: "border-red-500", badge: "bg-red-500" },
};

export const ALLERGEN_LABELS = {
  glutine: "Glutine", crostacei: "Crostacei", uova: "Uova", pesce: "Pesce", arachidi: "Arachidi", soia: "Soia",
  latte: "Latte", frutta_a_guscio: "Frutta a guscio", sedano: "Sedano", senape: "Senape", sesamo: "Sesamo",
  solfiti: "Solfiti", lupini: "Lupini", molluschi: "Molluschi",
};
