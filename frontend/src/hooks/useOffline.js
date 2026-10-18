import { useEffect, useState } from "react";
import { subscribe, getState } from "@/lib/offline";

export function useOffline() {
  const [s, setS] = useState(getState());
  useEffect(() => subscribe(setS), []);
  return s;
}

export function useOnSynced(fn) {
  useEffect(() => {
    window.addEventListener("ristoos:synced", fn);
    return () => window.removeEventListener("ristoos:synced", fn);
  }, [fn]);
}
