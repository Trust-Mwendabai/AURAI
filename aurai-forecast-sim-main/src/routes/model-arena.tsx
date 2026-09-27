// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { FiZap, FiAward, FiAlertTriangle, FiCpu } from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import { listDatasets, runModelArena, addPrediction } from "@/lib/db";
import { useToast } from "@/contexts/ToastContext";

const MODEL_COLORS = {
  prophet: "var(--chart-1)",
  arima: "var(--chart-3)",
  holt_winters: "var(--chart-4)",
  xgboost: "var(--chart-5)",
  lightgbm: "var(--chart-2)",
  ensemble: "#fbbf24",
};

const MODEL_KEYS = ["prophet", "arima", "holt_winters", "xgboost", "lightgbm", "ensemble"];

// Training runs in parallel server-side with no progress callback, so this
// is a staged approximation rather than a literal status feed — ordered by
// each model's typical relative cost (auto-ARIMA's grid search is by far
// the slowest step; the ensemble only "finishes" once its two components
// have). It exists so the wait has something honest-feeling to look at
// instead of a static spinner for up to ~10-15 seconds.
const TRAINING_STAGES = [
  { key: "holt_winters", seconds: 1.5 },
  { key: "prophet", seconds: 3 },
  { key: "xgboost", seconds: 4 },
  { key: "lightgbm", seconds: 5 },
  { key: "arima", seconds: 9 },
  { key: "ensemble", seconds: 10 },
];

const MODEL_LABELS_CLIENT = {
  prophet: "Prophet",
  arima: "ARIMA (auto order search)",
  holt_winters: "Holt-Winters",
  xgboost: "XGBoost",
  lightgbm: "LightGBM",
  ensemble: "Ensemble blend",
};

export default function ModelArenaPage() {
  const [datasets, setDatasets] = useState<any[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [target, setTarget] = useState("");
  const [horizon, setHorizon] = useState(6);
  const [period, setPeriod] = useState("Monthly");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const { success, info } = useToast();

  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const start = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - start) / 1000), 150);
    return () => clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    listDatasets().then((d) => {
      setDatasets(d);
      if (d.length > 0) setDatasetId(d[0].id);
    });
  }, []);

  const dataset = datasets.find((d) => d.id === datasetId);

  const runComparison = async () => {
    if (!datasetId || !target) {
      setError("Pick a dataset and a target column first.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await runModelArena({ datasetId, target, horizon, period });
      setResult(res);
    } catch (e: any) {
      setError(e.message || "Comparison failed");
    } finally {
      setLoading(false);
    }
  };

  const useModel = async (key: string) => {
    if (!result?.forecasts?.[key] || result.forecasts[key].error) return;
    try {
      const modelResult = result.results[key];
      await addPrediction({
        name: `${dataset?.name || "Dataset"} · ${target} (${modelResult.label})`,
        datasetId,
        target,
        horizon,
        period,
        algorithm: modelResult.label,
        modelName: `arena_${key}`,
        accuracy: modelResult.accuracy,
        forecast: result.forecasts[key],
      });
      success("Forecast saved", `${modelResult.label} added to your Predictions.`);
    } catch (e: any) {
      info("Could not save forecast", String(e.message || e));
    }
  };

  // Combine history + every model's forecast onto one chart timeline.
  const chartData = useMemo(() => {
    if (!result) return [];
    const past = (result.history || []).map((h: any) => ({ label: h.label, actual: h.value }));
    const byLabel = new Map();
    for (const row of past) byLabel.set(row.label, { ...row });

    for (const key of MODEL_KEYS) {
      const points = result.forecasts?.[key];
      if (!Array.isArray(points)) continue;
      for (const p of points) {
        byLabel.set(p.label, { ...(byLabel.get(p.label) || {}), label: p.label, [key]: p.value });
      }
    }

    // Join point: carry the last recorded value into the first forecast
    // label so every model's line visibly continues from history instead
    // of starting from a gap.
    if (past.length) {
      const joinLabel = past[past.length - 1].label;
      const join = byLabel.get(joinLabel) || { label: joinLabel };
      for (const key of MODEL_KEYS) {
        if (result.results?.[key]?.ok) join[key] = join.actual;
      }
      byLabel.set(joinLabel, join);
    }

    return [...byLabel.values()].sort((a, b) => (a.label > b.label ? 1 : -1));
  }, [result]);

  const boundaryLabel = result?.history?.length ? result.history[result.history.length - 1].label : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FiCpu className="h-6 w-6 text-primary" /> Model Arena
        </h1>
        <p className="text-sm text-muted-foreground">
          Train Prophet, ARIMA, Holt-Winters, and XGBoost on the same holdout and see which one actually fits your data best.
        </p>
      </div>

      <GlassCard>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs">Dataset
            <select
              value={datasetId}
              onChange={(e) => { setDatasetId(e.target.value); setTarget(""); }}
              className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm"
            >
              {datasets.length === 0 && <option value="">No datasets yet</option>}
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="text-xs">Target column
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm"
            >
              <option value="">Choose…</option>
              {(dataset?.headers || []).map((h: string) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className="text-xs">Horizon
            <input
              type="number" min={1} max={24} value={horizon}
              onChange={(e) => setHorizon(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
              className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm"
            />
          </label>
          <label className="text-xs">Period
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm"
            >
              {["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <button
          onClick={runComparison}
          disabled={loading || !datasetId || !target}
          className="mt-4 rounded-xl px-5 py-2.5 text-sm font-semibold text-white glow inline-flex items-center gap-2 disabled:opacity-50"
          style={{ background: "var(--gradient-primary)" }}
        >
          <FiZap /> {loading ? "Training 4 models…" : "Compare Models"}
        </button>

        {error && (
          <div className="mt-3 rounded-xl p-3 text-sm text-destructive border border-destructive/30">{error}</div>
        )}
      </GlassCard>

      {loading && (
        <GlassCard>
          <div className="text-xs text-muted-foreground mb-4">
            Training {TRAINING_STAGES.length} models in parallel — {elapsed.toFixed(1)}s elapsed
          </div>
          <div className="space-y-2.5">
            {TRAINING_STAGES.map((stage) => {
              const done = elapsed >= stage.seconds;
              const active = !done && elapsed >= (stage.seconds - 2 > 0 ? stage.seconds - 2 : 0);
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${done ? "" : active ? "animate-pulse" : "opacity-30"}`}
                       style={{ background: done ? MODEL_COLORS[stage.key] : "var(--muted-foreground)" }} />
                  <span className={`text-sm ${done ? "text-foreground" : "text-muted-foreground"}`}>
                    {MODEL_LABELS_CLIENT[stage.key]}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {done ? "done" : active ? "training…" : "queued"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 h-1.5 rounded-full bg-muted/30 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-150"
              style={{ width: `${Math.min(100, (elapsed / TRAINING_STAGES[TRAINING_STAGES.length - 1].seconds) * 100)}%`, background: "var(--gradient-primary)" }}
            />
          </div>
        </GlassCard>
      )}

      {result && !loading && (
        <>
          {/* Ranking */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {MODEL_KEYS.map((key) => {
              const r = result.results?.[key];
              const isBest = result.bestModel === key;
              if (!r) return null;
              return (
                <GlassCard key={key} className={isBest ? "ring-2 ring-primary/60" : ""}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-muted-foreground">{r.label}</div>
                    {isBest && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                        <FiAward className="h-3 w-3" /> BEST
                      </span>
                    )}
                  </div>
                  {r.ok ? (
                    <>
                      <div className="text-2xl font-bold" style={{ color: MODEL_COLORS[key] }}>
                        {r.accuracy}%
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">MAPE {r.mape}%</div>
                      <button
                        onClick={() => useModel(key)}
                        className="mt-3 w-full text-xs px-3 py-1.5 rounded-lg bg-accent/30 hover:bg-accent/50 transition-colors"
                      >
                        Use this model
                      </button>
                    </>
                  ) : (
                    <div className="text-xs text-destructive flex items-start gap-1.5 mt-1">
                      <FiAlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{r.error || "Could not fit this model"}</span>
                    </div>
                  )}
                </GlassCard>
              );
            })}
          </div>

          {/* Overlay chart */}
          <GlassCard>
            <div className="text-xs text-muted-foreground mb-3">History and every model's forecast, overlaid</div>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} minTickGap={28} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} width={58} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                  labelFormatter={(l) => `Period: ${l}`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="actual" name="Recorded" stroke="var(--muted-foreground)" strokeWidth={2} dot={false} connectNulls />
                {MODEL_KEYS.map((key) => (
                  result.results?.[key]?.ok && (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={result.results[key].label}
                      stroke={MODEL_COLORS[key]}
                      strokeWidth={key === result.bestModel ? 3 : 1.75}
                      strokeDasharray={key === result.bestModel ? undefined : "5 4"}
                      dot={false}
                      connectNulls
                      opacity={key === result.bestModel ? 1 : 0.75}
                    />
                  )
                ))}
                {boundaryLabel && (
                  <ReferenceLine x={boundaryLabel} stroke="var(--muted-foreground)" strokeDasharray="4 4"
                    label={{ value: "forecast starts", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <div className="text-xs text-muted-foreground mt-2">
              The solid, thicker line is the best-performing model on this dataset's holdout. Dashed lines are the others, for comparison.
            </div>
          </GlassCard>
        </>
      )}

      {!result && !loading && datasets.length === 0 && (
        <GlassCard className="text-center py-12">
          <p className="text-muted-foreground mb-4">No datasets yet.</p>
          <p className="text-sm text-muted-foreground">Upload a dataset first, then come back to compare models on it.</p>
        </GlassCard>
      )}
    </div>
  );
}
