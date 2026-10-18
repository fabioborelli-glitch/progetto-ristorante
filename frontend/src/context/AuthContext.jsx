import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [actAs, setActAsState] = useState(() => {
    const raw = localStorage.getItem("ristoos_act_as_tenant");
    return raw ? JSON.parse(raw) : null;
  });

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      localStorage.setItem("ristoos_user", JSON.stringify(data));
      setUser(data);
    } catch (e) {
      const cached = localStorage.getItem("ristoos_user");
      if (!e?.response && cached) setUser(JSON.parse(cached));
      else setUser(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("ristoos_token")) {
      setUser(false);
      return;
    }
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("ristoos_token", data.access_token);
    localStorage.setItem("ristoos_user", JSON.stringify(data));
    setUser(data);
    return data;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    localStorage.removeItem("ristoos_token");
    localStorage.removeItem("ristoos_user");
    localStorage.removeItem("ristoos_act_as");
    localStorage.removeItem("ristoos_act_as_tenant");
    setActAsState(null);
    setUser(false);
  };

  const setActAs = (tenant) => {
    if (tenant) {
      localStorage.setItem("ristoos_act_as", tenant.id);
      localStorage.setItem("ristoos_act_as_tenant", JSON.stringify(tenant));
    } else {
      localStorage.removeItem("ristoos_act_as");
      localStorage.removeItem("ristoos_act_as_tenant");
    }
    setActAsState(tenant);
  };

  const isSuper = user && user.platform_role === "superadmin";
  const tenant = isSuper ? actAs : user?.tenant;
  const role = isSuper ? "owner" : user?.tenant_role;

  return (
    <AuthContext.Provider value={{ user, login, logout, refresh, isSuper, actAs, setActAs, tenant, role }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
