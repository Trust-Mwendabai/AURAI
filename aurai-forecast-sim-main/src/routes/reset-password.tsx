// @ts-nocheck
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { resetPasswordWithToken } from "@/lib/auth";
import { PasswordInput } from "@/components/PasswordInput";


export default function ResetPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get("email") || "";
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const ready = !!email && !!token;

  const onSubmit = async (e: any) => {
    e.preventDefault(); setErr(""); setMsg(""); setLoading(true);
    try {
      await resetPasswordWithToken(email, token, pw);
      setMsg("Password updated. Redirecting…");
      setTimeout(() => navigate("/login"), 800);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form onSubmit={onSubmit} className="glass-strong rounded-3xl p-8 w-full max-w-md">
        <h2 className="text-2xl font-semibold">Set a new password</h2>
        <p className="text-sm text-muted-foreground mt-1">Enter a new password for your account.</p>
        {!ready && <div className="mt-4 text-xs text-muted-foreground">Open this page from the reset link in your email.</div>}
        <label className="block mt-6 text-xs font-medium">New password</label>
        <PasswordInput required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1 w-full" />
        {err && <div className="mt-4 text-xs text-destructive">{err}</div>}
        {msg && <div className="mt-4 text-xs text-primary">{msg}</div>}
        <button type="submit" disabled={loading || !ready} className="mt-6 w-full rounded-xl py-2.5 text-sm font-semibold text-white glow disabled:opacity-60" style={{ background: "var(--gradient-primary)" }}>{loading ? "Updating…" : "Update password"}</button>
        <div className="mt-4 text-center text-xs text-muted-foreground"><Link to="/login" className="text-primary hover:underline">Back to sign in</Link></div>
      </form>
    </div>
  );
}
