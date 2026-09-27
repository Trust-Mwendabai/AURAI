// @ts-nocheck
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { motion } from "framer-motion";
import { FiZap, FiMail, FiLock } from "react-icons/fi";
import { login } from "@/lib/auth";
import { PasswordInput } from "@/components/PasswordInput";


export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: any) => {
    e.preventDefault(); setErr(""); setLoading(true);
    try { await login(email, password); navigate("/dashboard"); }
    catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-10 relative overflow-hidden">
        <div className="flex items-center gap-2 relative z-10">
          <div className="h-9 w-9 rounded-xl grid place-items-center text-white" style={{ background: "var(--gradient-primary)" }}><FiZap className="h-4 w-4" /></div>
          <span className="font-semibold">Aurai Forecast</span>
        </div>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="relative z-10">
          <h1 className="text-5xl font-bold leading-tight">Forecast smarter.<br /><span className="gradient-text">Decide faster.</span></h1>
          <p className="mt-4 text-muted-foreground max-w-md">AI-powered time series forecasting, dataset processing, and reporting in one premium workspace.</p>
        </motion.div>
        <div className="text-xs text-muted-foreground relative z-10">© Aurai Labs</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <motion.form onSubmit={onSubmit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong rounded-3xl p-8 w-full max-w-md">
          <h2 className="text-2xl font-semibold">Welcome back</h2>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your Aurai workspace.</p>

          <label className="block mt-6 text-xs font-medium">Email</label>
          <div className="mt-1 glass rounded-xl flex items-center gap-2 px-3 py-2.5">
            <FiMail className="h-4 w-4 text-muted-foreground" />
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-transparent outline-none text-sm flex-1" placeholder="you@company.com" />
          </div>

          <label className="block mt-4 text-xs font-medium">Password</label>
          <div className="mt-1 glass rounded-xl flex items-center gap-2 px-3 py-2.5">
            <FiLock className="h-4 w-4 text-muted-foreground" />
            <PasswordInput bare required value={password} onChange={(e) => setPassword(e.target.value)} className="bg-transparent outline-none text-sm flex-1 min-w-0" placeholder="••••••••" />
          </div>

          <div className="flex items-center justify-end mt-4 text-xs">
            <Link to="/forgot-password" className="text-primary hover:underline">Forgot password?</Link>
          </div>

          {err && <div className="mt-4 text-xs text-destructive">{err}</div>}

          <button type="submit" disabled={loading} className="mt-6 w-full rounded-xl py-2.5 text-sm font-semibold text-white glow disabled:opacity-60" style={{ background: "var(--gradient-primary)" }}>{loading ? "Signing in…" : "Sign in"}</button>
          <div className="mt-4 text-center text-xs text-muted-foreground">
            New here? <Link to="/register" className="text-primary hover:underline">Create an account</Link>
          </div>
        </motion.form>
      </div>
    </div>
  );
}
