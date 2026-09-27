// @ts-nocheck
import { Link } from "react-router-dom";
import { useState } from "react";
import { requestPasswordReset } from "@/lib/auth";


export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: any) => {
    e.preventDefault(); setMsg(""); setErr(""); setLoading(true);
    try { await requestPasswordReset(email); setMsg("Check your email for a reset link."); }
    catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form onSubmit={onSubmit} className="glass-strong rounded-3xl p-8 w-full max-w-md">
        <h2 className="text-2xl font-semibold">Reset password</h2>
        <p className="text-sm text-muted-foreground mt-1">We'll email you a secure reset link.</p>
        <label className="block mt-6 text-xs font-medium">Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full glass rounded-xl px-3 py-2.5 bg-transparent outline-none text-sm" />
        {err && <div className="mt-4 text-xs text-destructive">{err}</div>}
        {msg && <div className="mt-4 text-xs text-primary">{msg}</div>}
        <button type="submit" disabled={loading} className="mt-6 w-full rounded-xl py-2.5 text-sm font-semibold text-white glow disabled:opacity-60" style={{ background: "var(--gradient-primary)" }}>{loading ? "Sending…" : "Send reset link"}</button>
        <div className="mt-4 text-center text-xs text-muted-foreground"><Link to="/login" className="text-primary hover:underline">Back to sign in</Link></div>
      </form>
    </div>
  );
}
