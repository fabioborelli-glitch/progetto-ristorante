import { useEffect, useRef, useState } from "react";

const WS_BASE = process.env.REACT_APP_BACKEND_URL.replace(/^http/, "ws");

export function useTenantSocket(onEvent) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let ws;
    let timer;
    let closed = false;

    const connect = () => {
      const token = localStorage.getItem("ristoos_token");
      if (!token) return;
      const actAs = localStorage.getItem("ristoos_act_as");
      const url = `${WS_BASE}/api/ws?token=${encodeURIComponent(token)}${actAs ? `&tenant_id=${actAs}` : ""}`;
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          handler.current?.(msg.event, msg.data);
        } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    const ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25000);
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      ws?.close();
    };
  }, []);

  return connected;
}
