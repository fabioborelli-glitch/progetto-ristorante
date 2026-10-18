const QUEUE_KEY = "ristoos_queue";
const CONFLICT_KEY = "ristoos_conflicts";
const CACHE_PREFIX = "ristoos_cache:";

const state = { online: navigator.onLine, syncing: false, pending: 0, lastSync: null, conflicts: 0 };
const listeners = new Set();
let apiRef = null;

function emit() {
  state.pending = loadQueue().length;
  state.conflicts = loadConflicts().length;
  listeners.forEach((fn) => fn({ ...state }));
}
export const subscribe = (fn) => { listeners.add(fn); fn({ ...state }); return () => listeners.delete(fn); };
export const getState = () => ({ ...state });

const tenantKey = () => localStorage.getItem("ristoos_act_as") || "t";
const cacheKey = (url) => `${CACHE_PREFIX}${tenantKey()}:${url}`;
export const cacheSet = (url, data) => { try { localStorage.setItem(cacheKey(url), JSON.stringify(data)); } catch {} };
export const cacheGet = (url) => { try { const v = localStorage.getItem(cacheKey(url)); return v ? JSON.parse(v) : undefined; } catch { return undefined; } };
const cacheUpdate = (url, fn) => {
  const prefix = cacheKey(url);
  Object.keys(localStorage).filter((k) => k === prefix || k.startsWith(prefix + "?")).forEach((k) => {
    try { localStorage.setItem(k, JSON.stringify(fn(JSON.parse(localStorage.getItem(k))))); } catch {}
  });
};
const reqKey = (cfg) => (cfg.url || "") + (cfg.params && Object.keys(cfg.params).length ? "?" + JSON.stringify(cfg.params) : "");

const loadQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; } };
const saveQueue = (q) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
export const loadConflicts = () => { try { return JSON.parse(localStorage.getItem(CONFLICT_KEY) || "[]"); } catch { return []; } };
export const clearConflicts = () => { localStorage.removeItem(CONFLICT_KEY); emit(); };

export const newClientId = () => `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const isNetworkError = (e) => !e?.response && (e?.code === "ERR_NETWORK" || e?.message === "Network Error" || !navigator.onLine);

const QUEUEABLE = [
  /^\/t\/orders$/, /^\/t\/orders\/[^/]+\/status$/, /^\/t\/tables\/[^/]+$/,
  /^\/t\/bills\/[^/]+\/payments$/, /^\/t\/bills\/[^/]+\/close$/, /^\/t\/bills\/[^/]+$/,
  /^\/t\/waitlist\/[^/]+$/, /^\/t\/reservations\/[^/]+$/,
];
export const isQueueable = (method, url) => ["post", "patch"].includes(method) && QUEUEABLE.some((re) => re.test(url));

function optimistic(entry) {
  const { method, url, data } = entry;
  const now = new Date().toISOString();
  let m;
  if (method === "post" && url === "/t/orders") {
    const tables = cacheGet("/t/tables") || [];
    const table = tables.find((t) => t.id === data.table_id);
    const items = cacheGet("/t/menu/items") || [];
    const lines = data.lines.map((l) => {
      const it = items.find((x) => x.id === l.item_id) || {};
      const v = (it.variants || []).find((x) => x.name === l.variant);
      return { item_id: l.item_id, name: it.name || "Piatto", qty: l.qty, variant: l.variant || null, notes: l.notes || "", price: (it.price || 0) + (v?.price_delta || 0), station_id: it.station_id || null };
    });
    const order = { id: data.client_id, client_id: data.client_id, table_id: data.table_id, table_name: table?.name || "?", customer_name: data.customer_name || "Sala", notes: data.notes || "", items: lines, stations: {}, total: lines.reduce((a, l) => a + l.qty * l.price, 0), status: "nuovo", source: "sala", created_at: now, updated_at: now, offline: true };
    cacheUpdate("/t/orders", (list) => [...list, order]);
    cacheUpdate("/t/tables", (list) => list.map((t) => (t.id === data.table_id ? { ...t, status: "occupato", open_orders: (t.open_orders || 0) + 1 } : t)));
    return order;
  }
  if (method === "patch" && (m = url.match(/^\/t\/orders\/([^/]+)\/status$/))) {
    let updated = null;
    cacheUpdate("/t/orders", (list) => list.map((o) => {
      if (o.id !== m[1]) return o;
      const stations = { ...(o.stations || {}) };
      if (data.station_id && stations[data.station_id]) stations[data.station_id] = data.status;
      updated = { ...o, status: data.station_id ? o.status : data.status, stations, updated_at: now, offline: true };
      return updated;
    }).filter((o) => !["servito", "annullato"].includes(o.status)));
    return updated || { id: m[1], status: data.status };
  }
  if (method === "patch" && (m = url.match(/^\/t\/tables\/([^/]+)$/))) {
    let updated = null;
    cacheUpdate("/t/tables", (list) => list.map((t) => (t.id === m[1] ? (updated = { ...t, ...data, offline: true }) : t)));
    return updated || { id: m[1], ...data };
  }
  if (m = url.match(/^\/t\/bills\/([^/]+)(\/payments|\/close)?$/)) {
    let updated = null;
    const apply = (b) => {
      if (!b || b.id !== m[1]) return b;
      let nb = { ...b, offline: true };
      if (m[2] === "/payments") {
        const payments = [...(b.payments || []), { id: data.client_id || newClientId(), method: data.method, amount: data.amount, at: now }];
        const paid = payments.reduce((a, p) => a + p.amount, 0);
        nb = { ...nb, payments, paid, remaining: Math.round((b.total - paid) * 100) / 100 };
      } else if (m[2] === "/close") {
        nb = { ...nb, status: "chiuso", closed_at: now, number: "in sincronizzazione" };
      } else {
        nb = { ...nb, ...data };
      }
      return (updated = nb);
    };
    cacheUpdate(`/t/bills/${m[1]}`, apply);
    cacheUpdate("/t/bills", (list) => list.map(apply).filter((b) => b.status === "aperto"));
    return updated || { id: m[1] };
  }
  return { ...data, offline: true };
}

export function enqueue(method, url, data, label) {
  const entry = { id: newClientId(), method, url, data, label, at: new Date().toISOString() };
  const q = loadQueue();
  q.push(entry);
  saveQueue(q);
  const result = optimistic(entry);
  emit();
  return result;
}

export async function flush() {
  if (state.syncing || !apiRef) return;
  let q = loadQueue();
  if (!q.length) return;
  state.syncing = true;
  emit();
  const conflicts = loadConflicts();
  while (q.length) {
    const entry = q[0];
    try {
      await apiRef.request({ method: entry.method, url: entry.url, data: entry.data, headers: { "X-Offline-Replay": "1" } });
      q.shift();
      saveQueue(q);
    } catch (e) {
      if (isNetworkError(e) || e?.response?.status >= 500 || e?.response?.status === 429) break;
      if (e?.response?.status === 401) break;
      conflicts.push({ ...entry, error: e?.response?.data?.detail || "Rifiutato dal server", status: e?.response?.status });
      localStorage.setItem(CONFLICT_KEY, JSON.stringify(conflicts));
      q.shift();
      saveQueue(q);
    }
  }
  state.syncing = false;
  state.online = navigator.onLine && q.length === 0 ? true : state.online;
  if (!q.length) {
    state.lastSync = new Date().toISOString();
    state.online = true;
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
    window.dispatchEvent(new CustomEvent("ristoos:synced"));
  }
  emit();
}

export function setOnline(v) {
  if (state.online !== v) {
    state.online = v;
    emit();
  }
  if (v) flush();
}

export function installOffline(api) {
  apiRef = api;
  api.interceptors.response.use(
    (res) => {
      const url = res.config.url || "";
      if (res.config.method === "get" && url.startsWith("/t/") && !res.config.headers?.["X-Offline-Replay"]) cacheSet(reqKey(res.config), res.data);
      if (!state.online && !state.syncing) setOnline(true);
      return res;
    },
    (error) => {
      const cfg = error.config || {};
      const url = cfg.url || "";
      if (isNetworkError(error) && url.startsWith("/t/")) {
        setOnline(false);
        if (cfg.method === "get") {
          const cached = cacheGet(reqKey(cfg));
          if (cached !== undefined) return Promise.resolve({ data: cached, status: 200, fromCache: true, config: cfg });
        } else if (!cfg.headers?.["X-Offline-Replay"] && isQueueable(cfg.method, url)) {
          const data = typeof cfg.data === "string" ? JSON.parse(cfg.data) : cfg.data;
          return Promise.resolve({ data: enqueue(cfg.method, url, data), status: 202, queued: true, config: cfg });
        }
      }
      return Promise.reject(error);
    },
  );
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
  setInterval(() => { if (navigator.onLine && loadQueue().length) flush(); }, 10000);
  emit();
}
