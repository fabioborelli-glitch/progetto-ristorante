import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const u = await login(email, password);
      toast.success(`Bentornato, ${u.name}`);
      navigate(u.platform_role === "superadmin" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#FAFAFA]">
      <div className="hidden lg:flex flex-col justify-between p-14 bg-[#111827] text-white">
        <div className="font-display text-3xl font-extrabold tracking-tight">
          Risto<span className="text-[#E03131]">OS</span>
        </div>
        <div>
          <h1 className="font-display text-5xl font-extrabold leading-none tracking-tight max-w-md">
            Il gestionale operativo per la tua sala.
          </h1>
          <p className="mt-6 text-gray-400 max-w-md leading-relaxed">
            Prenotazioni, piantina sala, menu digitale con QR e schermo cucina. Multi-locale, pronto per agenzie.
          </p>
        </div>
        <div className="text-sm text-gray-500">© {new Date().getFullYear()} RistoOS</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="login-form">
          <div className="lg:hidden font-display text-3xl font-extrabold tracking-tight">
            Risto<span className="text-[#E03131]">OS</span>
          </div>
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight">Accedi</h2>
            <p className="text-sm text-gray-500 mt-1">Inserisci le credenziali del tuo account.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12" data-testid="login-email-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12" data-testid="login-password-input" />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="login-error">{error}</div>}
          <Button type="submit" className="w-full h-12 text-base bg-[#E03131] hover:bg-[#c42727] active:scale-95 transition-transform" disabled={loading} data-testid="login-submit-btn">
            {loading ? "Accesso in corso…" : "Accedi"}
          </Button>
        </form>
      </div>
    </div>
  );
}
