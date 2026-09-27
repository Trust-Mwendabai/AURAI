// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { GlassCard } from "@/components/GlassCard";
import { ScheduledRefreshes } from "@/components/ScheduledRefreshes";
import { defaultSettings, getSettings, initSettings, saveSettings } from "@/lib/settings";

export default function SettingsPage() {
  const [s, setS] = useState<any>(getSettings());
  const [status, setStatus] = useState("");
  const timer = useRef<any>(null);

  useEffect(() => { initSettings().then(setS); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Typing updates the form immediately but only writes once the user pauses,
  // so a field edit costs one request rather than one per keystroke.
  const update = (patch: any) => {
    const next = { ...s, ...patch };
    setS(next);
    setStatus("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await saveSettings(next);
        setStatus("Saved");
        setTimeout(() => setStatus(""), 1500);
      } catch (e: any) {
        setStatus(`Not saved — ${e.message}`);
      }
    }, 600);
  };

  const input = "mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Saved to your account — these follow you across devices.</p>
        </div>
        {status && <div className="text-xs text-muted-foreground">{status}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard>
          <div className="font-semibold mb-3">Workspace</div>
          <label className="text-xs">Workspace name</label>
          <input value={s.systemName} onChange={(e) => update({ systemName: e.target.value })} className={input} />
          <label className="text-xs mt-3 block">Company name</label>
          <input value={s.companyName} onChange={(e) => update({ companyName: e.target.value })} className={input} />
          <div className="text-xs text-muted-foreground mt-2">Both appear in the sidebar.</div>
        </GlassCard>

        <GlassCard>
          <div className="font-semibold mb-3">Forecast defaults</div>
          {/* Two fields side by side inside a half-width card only once there
              is room for them; below that they stack. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs">Default horizon</label>
              <input
                type="number" min={1} max={365} value={s.forecastHorizon}
                onChange={(e) => update({ forecastHorizon: Number(e.target.value) })}
                className={input}
              />
            </div>
            <div>
              <label className="text-xs">Default period</label>
              <select value={s.forecastPeriod} onChange={(e) => update({ forecastPeriod: e.target.value })} className={input}>
                {["Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "Yearly"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            Used to pre-fill the Predictions wizard. Forecasting runs on Prophet, trained server-side.
          </div>
        </GlassCard>

        <ScheduledRefreshes />
      </div>

      <button onClick={() => update(defaultSettings)} className="glass rounded-xl px-4 py-2 text-sm">
        Reset to defaults
      </button>
    </div>
  );
}
