import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ROLE = { owner: "Owner", manager: "Manager", staff: "Staff" };

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get(`/invites/${token}`).then((r) => { setInfo(r.data); setName(r.data.name); }).catch((e) => setError(errMsg(e)));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError("Le password non coincidono");
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post(`/invites/${token}/accept`, { name, password });
      localStorage.setItem("ristoos_token", data.access_token);
      await refresh();
      toast.success(`Benvenuto in ${data.tenant?.name}`);
      navigate("/dashboard");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#111827] grid place-items-center p-6" data-testid="accept-invite-page">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-8 space-y-6">
        <div className="font-display text-2xl font-extrabold tracking-tight">Risto<span className="text-[#E03131]">OS</span></div>
        {!info && !error && <div className="text-gray-500">Verifica invito…</div>}
        {error && !info && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-4" data-testid="invite-error">{error}</div>}
        {info && (
          <>
            <div>
              <h1 className="font-display text-3xl font-extrabold tracking-tight">Sei invitato in {info.tenant_name}</h1>
              <p className="text-sm text-gray-500 mt-2">{info.inviter_name} ti ha invitato come <b>{ROLE[info.tenant_role]}</b>. Scegli una password per completare l'accesso con <b>{info.email}</b>.</p>
            </div>
            <form onSubmit={submit} className="space-y-4" data-testid="accept-invite-form">
              <div className="space-y-1"><Label>Il tuo nome</Label><Input className="h-12" value={name} onChange={(e) => setName(e.target.value)} required data-testid="invite-name" /></div>
              <div className="space-y-1"><Label>Password (min 8 caratteri)</Label><Input type="password" className="h-12" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} data-testid="invite-password" /></div>
              <div className="space-y-1"><Label>Conferma password</Label><Input type="password" className="h-12" value={confirm} onChange={(e) => setConfirm(e.target.value)} required data-testid="invite-confirm" /></div>
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="invite-form-error">{error}</div>}
              <Button type="submit" className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" disabled={loading} data-testid="invite-submit">{loading ? "Attivazione…" : "Attiva account ed entra"}</Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
