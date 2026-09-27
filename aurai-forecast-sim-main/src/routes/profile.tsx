// @ts-nocheck
import { useEffect, useState } from "react";
import { FiLock } from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import { getCurrentUser, refreshSession, updateProfile } from "@/lib/auth";
import { listDatasets, listPredictions, listReports } from "@/lib/db";
import { PasswordInput } from "@/components/PasswordInput";


export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState({ datasets: 0, predictions: 0, reports: 0 });
  const [msg, setMsg] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");

  useEffect(() => {
    refreshSession().then(() => setUser(getCurrentUser()));
    Promise.all([listDatasets(), listPredictions(), listReports()])
      .then(([d, p, r]) => setStats({ datasets: d.length, predictions: p.length, reports: r.length }));
  }, []);

  if (!user) return null;

  const onSave = async (e: any) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const patch: any = { name: fd.get("name"), email: fd.get("email") };
    try {
      const u = await updateProfile(patch);
      setUser(u);
      setMsg("Profile updated"); setTimeout(() => setMsg(""), 2500);
    } catch (err: any) {
      setMsg(err.message || "Update failed"); setTimeout(() => setMsg(""), 3000);
    }
  };

  const onChangePassword = async (e: any) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const newPassword = fd.get("new-password");
    const confirmPassword = fd.get("confirm-password");

    if (!newPassword) {
      setPasswordMsg("Password is required");
      setTimeout(() => setPasswordMsg(""), 3000);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMsg("Passwords do not match");
      setTimeout(() => setPasswordMsg(""), 3000);
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMsg("Password must be at least 6 characters");
      setTimeout(() => setPasswordMsg(""), 3000);
      return;
    }

    try {
      await updateProfile({ password: newPassword });
      setPasswordMsg("Password changed successfully");
      (e.target as HTMLFormElement).reset();
      setTimeout(() => setPasswordMsg(""), 2500);
    } catch (err: any) {
      setPasswordMsg(err.message || "Password change failed");
      setTimeout(() => setPasswordMsg(""), 3000);
    }
  };


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-4">
        <GlassCard>
          <div className="flex flex-col items-center text-center">
            <div className="h-24 w-24 rounded-3xl grid place-items-center text-white text-3xl font-bold glow overflow-hidden" style={{ background: "var(--gradient-primary)" }}>
              {user.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : (user.name?.[0]?.toUpperCase() || "U")}
            </div>
            <div className="mt-3 font-semibold text-lg">{user.name}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
            <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Plan: {user.plan || "free"}</div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-5">
            {[["Datasets", stats.datasets],["Predictions", stats.predictions],["Reports", stats.reports]].map(([l, v]: any) => (
              <div key={l} className="glass rounded-xl p-3 text-center"><div className="text-lg font-bold gradient-text">{v}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">{l}</div></div>
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <form onSubmit={onSave} className="space-y-3">
            <div className="font-semibold mb-1">Account details</div>
            <div><label className="text-xs">Name</label><input name="name" defaultValue={user.name} className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm" /></div>
            <div><label className="text-xs">Email</label><input name="email" type="email" defaultValue={user.email} className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm" /></div>
            {msg && <div className="text-xs text-primary">{msg}</div>}
            <button type="submit" className="rounded-xl px-4 py-2 text-sm text-white glow" style={{ background: "var(--gradient-primary)" }}>Update profile</button>
          </form>
        </GlassCard>
      </div>

      {/* Change Password Section */}
      <GlassCard>
        <form onSubmit={onChangePassword} className="space-y-3 max-w-md">
          <div className="flex items-center gap-2 mb-3">
            <FiLock className="h-5 w-5 text-primary" />
            <div className="font-semibold">Change password</div>
          </div>
          <div><label className="text-xs">New password</label><PasswordInput name="new-password" minLength={6} className="mt-1 w-full" /></div>
          <div><label className="text-xs">Confirm password</label><PasswordInput name="confirm-password" minLength={6} className="mt-1 w-full" /></div>
          {passwordMsg && <div className={`text-xs ${passwordMsg.includes("successfully") ? "text-emerald-400" : "text-rose-400"}`}>{passwordMsg}</div>}
          <button type="submit" className="rounded-xl px-4 py-2 text-sm text-white glow" style={{ background: "var(--gradient-primary)" }}>Change password</button>
        </form>
      </GlassCard>
    </div>
  );
}
