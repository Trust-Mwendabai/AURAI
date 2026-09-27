// @ts-nocheck
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { register } from "@/lib/auth";
import { PasswordInput } from "@/components/PasswordInput";


export default function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: any) => {
    e.preventDefault(); setErr(""); setMsg(""); setLoading(true);
    try {
      await register(name, email, password);
      navigate("/dashboard");
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form onSubmit={onSubmit} className="glass-strong rounded-3xl p-8 w-full max-w-md">
        <h2 className="text-2xl font-semibold">Create your account</h2>
        <p className="text-sm text-muted-foreground mt-1">Start forecasting in seconds.</p>

        <label className="block mt-6 text-xs font-medium">Name</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full glass rounded-xl px-3 py-2.5 bg-transparent outline-none text-sm" placeholder="Ada Lovelace" />
        <label className="block mt-4 text-xs font-medium">Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full glass rounded-xl px-3 py-2.5 bg-transparent outline-none text-sm" placeholder="you@company.com" />
        <label className="block mt-4 text-xs font-medium">Password</label>
        <PasswordInput required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full" placeholder="••••••••" />
        {err && <div className="mt-4 text-xs text-destructive">{err}</div>}
        {msg && <div className="mt-4 text-xs text-primary">{msg}</div>}
        <button type="submit" disabled={loading} className="mt-6 w-full rounded-xl py-2.5 text-sm font-semibold text-white glow disabled:opacity-60" style={{ background: "var(--gradient-primary)" }}>{loading ? "Creating…" : "Create account"}</button>
        <div className="mt-4 text-center text-xs text-muted-foreground">Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link></div>
      </form>
    </div>
  );
}
