// @ts-nocheck
import { useEffect, useState } from "react";
import { FiClock, FiPlus, FiTrash2, FiPlay, FiPause, FiRefreshCw } from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import {
  listDatasets, getDataset, listSchedules, createSchedule,
  updateSchedule, deleteSchedule, runScheduleNow,
} from "@/lib/db";

const ALGOS = [
  { key: "prophet", label: "Prophet" },
  { key: "arima", label: "ARIMA (auto)" },
  { key: "holt_winters", label: "Holt-Winters" },
  { key: "xgboost", label: "XGBoost" },
  { key: "lightgbm", label: "LightGBM" },
];
const FREQ_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

function fmt(dt: string | null) {
  if (!dt) return "—";
  return new Date(dt.replace(" ", "T")).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Lets a forecast re-run on a cadence instead of only when someone clicks
 * Run Prediction. There is no cron here (see api/schedules.php) — due
 * schedules are checked the next time any page calls /stats, which for most
 * users is simply "the next time they open the app," so this panel says so
 * rather than implying a background job runs on the dot.
 */
export function ScheduledRefreshes() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState<any>({
    datasetId: "", target: "", horizon: 12, period: "Monthly",
    algorithm: "prophet", frequency: "weekly", name: "",
  });
  const [targetOptions, setTargetOptions] = useState<string[]>([]);

  const refresh = async () => {
    const [s, d] = await Promise.all([listSchedules(), listDatasets()]);
    setSchedules(s);
    setDatasets(d);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const onPickDataset = async (datasetId: string) => {
    setForm((f: any) => ({ ...f, datasetId, target: "" }));
    if (!datasetId) { setTargetOptions([]); return; }
    const ds = await getDataset(datasetId);
    setTargetOptions((ds.headers || []).filter((h: string) => ds.rows.some((r: any) => typeof r[h] === "number")));
  };

  const onCreate = async () => {
    if (!form.datasetId || !form.target) { setError("Pick a dataset and a target column."); return; }
    setError("");
    setCreating(true);
    try {
      await createSchedule(form);
      setForm({ datasetId: "", target: "", horizon: 12, period: "Monthly", algorithm: "prophet", frequency: "weekly", name: "" });
      setTargetOptions([]);
      await refresh();
    } catch (e: any) {
      setError(e.message || "Could not create schedule.");
    } finally {
      setCreating(false);
    }
  };

  const onToggle = async (s: any) => {
    setBusyId(s.id);
    try { await updateSchedule(s.id, { enabled: !s.enabled }); await refresh(); }
    finally { setBusyId(null); }
  };

  const onRunNow = async (s: any) => {
    setBusyId(s.id);
    try { await runScheduleNow(s.id); await refresh(); }
    catch (e: any) { setError(e.message || "Run failed."); }
    finally { setBusyId(null); }
  };

  const onDelete = async (s: any) => {
    if (!confirm(`Delete "${s.name}"? This does not delete forecasts it already produced.`)) return;
    setBusyId(s.id);
    try { await deleteSchedule(s.id); await refresh(); }
    finally { setBusyId(null); }
  };

  const input = "mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm";

  return (
    <GlassCard className="lg:col-span-2">
      <div className="flex items-center gap-2 mb-1">
        <FiClock className="h-4 w-4 text-primary" />
        <div className="font-semibold">Scheduled Refreshes</div>
      </div>
      <div className="text-xs text-muted-foreground mb-4">
        Re-run a forecast automatically on a cadence. There's no background job here — a due
        schedule runs the next time you (or anyone on the account) opens the app.
      </div>

      {!loading && schedules.length > 0 && (
        <div className="space-y-2 mb-4">
          {schedules.map((s) => (
            <div key={s.id} className="glass rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {s.name}
                  {!s.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground">Paused</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {s.dataset_name || "Unknown dataset"} · {s.target} · {FREQ_LABEL[s.frequency]}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Last run {fmt(s.last_run_at)} · Next due {fmt(s.next_run_at)}
                  {s.last_error && <span className="text-rose-400"> · last attempt failed: {s.last_error}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onRunNow(s)} disabled={busyId === s.id}
                  className="rounded-lg p-2 glass hover:glow transition disabled:opacity-50" title="Run now"
                >
                  <FiRefreshCw className={`h-3.5 w-3.5 ${busyId === s.id ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={() => onToggle(s)} disabled={busyId === s.id}
                  className="rounded-lg p-2 glass hover:glow transition disabled:opacity-50" title={s.enabled ? "Pause" : "Resume"}
                >
                  {s.enabled ? <FiPause className="h-3.5 w-3.5" /> : <FiPlay className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => onDelete(s)} disabled={busyId === s.id}
                  className="rounded-lg p-2 glass hover:text-rose-400 transition disabled:opacity-50" title="Delete"
                >
                  <FiTrash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && schedules.length === 0 && (
        <div className="text-xs text-muted-foreground mb-4">No scheduled refreshes yet.</div>
      )}

      <div className="border-t border-border/60 pt-4">
        <div className="text-xs font-medium text-muted-foreground mb-2">New schedule</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs">Dataset</label>
            <select value={form.datasetId} onChange={(e) => onPickDataset(e.target.value)} className={input}>
              <option value="">Choose a dataset…</option>
              {datasets.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs">Target column</label>
            <select value={form.target} onChange={(e) => setForm((f: any) => ({ ...f, target: e.target.value }))} className={input} disabled={!targetOptions.length}>
              <option value="">{targetOptions.length ? "Choose a column…" : "Pick a dataset first"}</option>
              {targetOptions.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs">Horizon</label>
            <input type="number" min={1} max={365} value={form.horizon}
              onChange={(e) => setForm((f: any) => ({ ...f, horizon: Number(e.target.value) }))} className={input} />
          </div>
          <div>
            <label className="text-xs">Period</label>
            <select value={form.period} onChange={(e) => setForm((f: any) => ({ ...f, period: e.target.value }))} className={input}>
              {["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs">Algorithm</label>
            <select value={form.algorithm} onChange={(e) => setForm((f: any) => ({ ...f, algorithm: e.target.value }))} className={input}>
              {ALGOS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs">Repeat</label>
            <select value={form.frequency} onChange={(e) => setForm((f: any) => ({ ...f, frequency: e.target.value }))} className={input}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs">Name (optional)</label>
            <input value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))}
              placeholder={form.target ? `${form.target} refresh` : "e.g. Weekly revenue refresh"} className={input} />
          </div>
        </div>

        {error && <div className="text-xs text-rose-400 mt-2">{error}</div>}

        <button
          onClick={onCreate} disabled={creating}
          className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold text-white glow inline-flex items-center gap-2 disabled:opacity-60"
          style={{ background: "var(--gradient-primary)" }}
        >
          <FiPlus className="h-4 w-4" /> {creating ? "Creating…" : "Create schedule"}
        </button>
      </div>
    </GlassCard>
  );
}
