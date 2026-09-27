// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Area, AreaChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FiTrash2, FiDownload, FiSearch, FiZap, FiCheck, FiFileText, FiAlertTriangle, FiImage, FiX } from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import { ReportBuilder } from "@/components/ReportBuilder";
import { AnomalyBadge, AnomalyList } from "@/components/AnomalyBadge";
import { listDatasets, listPredictions, addPrediction, deletePrediction, runForecast, detectAnomalies, listAnomalies, acknowledgeAnomaly, tuneForecast } from "@/lib/db";
import { getSettings, initSettings } from "@/lib/settings";
import { notifyForecastComplete } from "@/lib/notifications";
import { useToast } from "@/contexts/ToastContext";
import { exportChartAsImage } from "@/lib/export";
import { api } from "@/lib/apiClient";
import { Link } from "react-router-dom";


// Prophet keeps its own dedicated train/predict services and supports
// regressors + cross-request model reuse; the rest run once per request
// via the Model Arena service (backend/Python/model_arena.py /run).
const ALGOS = [
  { key: "prophet", label: "Prophet" },
  { key: "arima", label: "ARIMA (auto)" },
  { key: "holt_winters", label: "Holt-Winters" },
  { key: "xgboost", label: "XGBoost" },
  { key: "lightgbm", label: "LightGBM" },
];
const ALGO_LABEL: Record<string, string> = Object.fromEntries(ALGOS.map((a) => [a.key, a.label]));

const MAX_COMPARE = 4;

// chart-2 is deliberately skipped: against chart-1 it falls in the 6–8 ΔE band
// for deuteranopia, which is too close to rely on for series identity.
const COMPARE_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

// Quotes a CSV field, doubling any embedded quotes per RFC 4180.
function csvCell(v: any) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function saveFile(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, "-");
  // The anchor has to be in the document for the click to start a download in
  // every browser; a detached one is silently ignored by some.
  document.body.appendChild(a);
  a.click();
  // Cleaned up on a later tick: tearing the anchor down or revoking the blob
  // synchronously can abort the download before the browser has read it.
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

/**
 * CSV is the default because a forecast is usually taken into a spreadsheet;
 * JSON stays available for anything that needs the full record.
 */
function exportPrediction(p: any, format: "csv" | "json") {
  if (format === "json") {
    saveFile(JSON.stringify(p, null, 2), "application/json", `${p.name}.json`);
    return;
  }
  const points = p.forecast || [];
  const header = ["Period", "Forecast", "Lower bound", "Upper bound"];
  const rows = points.map((f: any) => [f.label ?? f.i, f.value, f.low, f.high].map(csvCell).join(","));
  // A short provenance block above the table, so the file still makes sense
  // once it's detached from the app.
  const meta = [
    ["Forecast", p.name],
    ["Target", p.target ?? ""],
    ["Model", p.algorithm ?? ""],
    ["Horizon", `${p.horizon ?? ""} ${p.period ?? ""}`.trim()],
    ["Accuracy", p.accuracy !== null && p.accuracy !== undefined ? `${p.accuracy}%` : "not scored"],
    ["Generated", new Date(p.createdAt).toLocaleString()],
  ].map(([k, v]) => `${csvCell(k)},${csvCell(v)}`);

  // The BOM makes Excel read it as UTF-8 rather than the local codepage.
  const csv = "﻿" + [...meta, "", header.join(","), ...rows].join("\r\n");
  saveFile(csv, "text/csv;charset=utf-8", `${p.name}.csv`);
}

/**
 * How wide the model's confidence interval is, as a share of the predicted
 * value, averaged across the forecast.
 *
 * Accuracy says how well the model did on history; this says how sure it is
 * about the future. A model can score well and still hand back a range too
 * wide to plan against, so both are worth showing.
 */
function bandQuality(points: any[]) {
  if (!points?.length) return null;
  const widths = points
    .filter((p: any) => p.high != null && p.low != null && Number(p.value) !== 0)
    .map((p: any) => ((Number(p.high) - Number(p.low)) / Math.abs(Number(p.value))) * 100);
  if (!widths.length) return null;

  const avg = widths.reduce((a: number, b: number) => a + b, 0) / widths.length;
  const label = avg < 10 ? "Tight" : avg < 30 ? "Moderate" : "Wide";
  const tone = avg < 10 ? "text-emerald-400" : avg < 30 ? "text-amber-400" : "text-rose-400";
  const note = avg < 10
    ? "the model is confident — these figures are firm enough to plan against"
    : avg < 30
      ? "reasonably confident near term, looser further out"
      : "a wide range — treat these as direction rather than numbers";
  return { avg: Math.round(avg * 10) / 10, label, tone, note };
}

/** A short instruction at the top of each wizard step. */
function StepIntro({ title, body }: any) {
  return (
    <div className="mb-4">
      <div className="text-sm font-semibold">{title}</div>
      <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{body}</p>
    </div>
  );
}

export default function PredictionsPage() {
  const [step, setStep] = useState(1);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [dataset, setDataset] = useState<any>(null);
  const [target, setTarget] = useState("");
  const [horizon, setHorizon] = useState(getSettings().forecastHorizon);
  const [period, setPeriod] = useState(getSettings().forecastPeriod);
  const [algo, setAlgo] = useState("prophet");
  const [tuning, setTuning] = useState(false);
  const [tuneResult, setTuneResult] = useState<any>(null);
  const [tunedParams, setTunedParams] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [forecast, setForecast] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [compare, setCompare] = useState<string[]>([]);
  const [reportPrediction, setReportPrediction] = useState<any>(null);
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [selectedPredictionForAnomalies, setSelectedPredictionForAnomalies] = useState<any>(null);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [loadingAnomalies, setLoadingAnomalies] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const { success, info } = useToast();

  useEffect(() => {
    listDatasets().then(setDatasets);
    listPredictions().then(setHistory);
    initSettings().then((s) => { setHorizon(s.forecastHorizon); setPeriod(s.forecastPeriod); });
  }, []);

  // Tuned params are specific to one dataset+target's own backtest — carrying
  // them over to a different dataset, target, or algorithm would silently
  // apply settings that were never actually evaluated on that data.
  useEffect(() => {
    setTuneResult(null);
    setTunedParams(null);
  }, [dataset?.id, target, algo]);

  const loadAnomalies = async (predictionId: string) => {
    setLoadingAnomalies(true);
    setSelectedPredictionForAnomalies(predictionId);
    try {
      // Detect first — a forecast is only checkable against dates that have
      // since gained real data (e.g. after appending new rows on the
      // Dataset page), so this is safe to re-run every time the panel opens.
      await detectAnomalies(predictionId);
      const data = await listAnomalies(predictionId);
      setAnomalies(data);
    } catch (e) {
      info('Could not load anomalies', String(e));
    } finally {
      setLoadingAnomalies(false);
    }
  };

  const onAcknowledgeAnomaly = async (id: string) => {
    const target = anomalies.find((a: any) => a.id === id);
    if (!target) return;
    try {
      await acknowledgeAnomaly(id, !target.acknowledged);
      setAnomalies(anomalies.map((a: any) => (a.id === id ? { ...a, acknowledged: !a.acknowledged } : a)));
    } catch (e) {
      info('Could not update anomaly', String(e));
    }
  };

  const runTuning = async () => {
    if (!dataset || !target) return;
    setTuning(true);
    setTuneResult(null);
    try {
      const res = await tuneForecast({ datasetId: dataset.id, target, dateColumn: dateColumn || null, period });
      setTuneResult(res);
      if (res.improved) setTunedParams(res.bestParams);
    } catch (e: any) {
      info('Tuning failed', String(e.message || e));
    } finally {
      setTuning(false);
    }
  };

  const run = async () => {
    // The wizard's Next button already blocks advancing without these, but the
    // run path shouldn't depend on that guard staying correct.
    if (!dataset || !target) {
      setError("Pick a dataset and a target column first.");
      setStep(!dataset ? 1 : 2);
      return;
    }
    setLoading(true); setForecast(null); setMeta(null); setError("");
    try {
      const res = await runForecast({ datasetId: dataset.id, target, dateColumn: dateColumn || null, horizon, period, algorithm: algo, tunedParams });
      setForecast(res.forecast);
      setMeta(res);
      const predictionId = await addPrediction({
        name: `${dataset.name} · ${target}`, datasetId: dataset.id, target, horizon, period,
        algorithm: ALGO_LABEL[algo] || algo, modelName: res.model_name, accuracy: res.accuracy, forecast: res.forecast,
      });
      listPredictions().then(setHistory);

      // Auto-generate report
      if (predictionId) {
        try {
          await api.post('/auto-reports/generate', { prediction_id: predictionId });
          success(
            "Forecast Complete + Auto-Report Generated",
            `Prediction for "${target}" is ready with an auto-generated report. View it in the Reports tab.`,
            5000
          );
        } catch (reportError) {
          success(
            "Forecast Complete",
            `Prediction for "${target}" is ready. Visit Business Insights for analysis.`,
            5000
          );
        }
      } else {
        success(
          "Forecast Complete",
          `Prediction for "${target}" is ready. Visit Business Insights for analysis.`,
          5000
        );
      }
      notifyForecastComplete(dataset.name, target);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredHistory = history.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  const toggleCompare = (id: string) => {
    setCompare((ids: string[]) =>
      ids.includes(id) ? ids.filter((x) => x !== id)
        : ids.length >= MAX_COMPARE ? ids
        : [...ids, id],
    );
  };

  const comparedRuns = compare
    .map((id: string) => history.find((p) => p.id === id))
    .filter(Boolean);

  /**
   * Runs are aligned by period index rather than by date: two forecasts made at
   * different times cover different calendar ranges, and what's being compared
   * is the shape of the projection, not the specific days.
   */
  const comparisonData = useMemo(() => {
    if (comparedRuns.length < 2) return [];
    const longest = Math.max(...comparedRuns.map((p: any) => (p.forecast || []).length));
    return Array.from({ length: longest }, (_, i) => {
      const point: any = { step: `T+${i + 1}` };
      comparedRuns.forEach((p: any, idx: number) => {
        const value = p.forecast?.[i]?.value;
        if (value !== undefined) point[`run${idx}`] = value;
      });
      return point;
    });
  }, [comparedRuns]);

  const band = useMemo(() => bandQuality(forecast || []), [forecast]);

  /**
   * History and forecast on one axis, kept in separate keys so each can be
   * drawn differently. The last recorded point is repeated as the forecast's
   * first value, otherwise the two lines appear as disconnected fragments.
   */
  const combined = useMemo(() => {
    const past = (meta?.history || []).map((h: any) => ({ label: h.label, actual: h.value }));
    const future = (forecast || []).map((f: any) => ({
      label: f.label, value: f.value, low: f.low, high: f.high,
    }));
    if (past.length && future.length) {
      const join = past[past.length - 1];
      future.unshift({ label: join.label, value: join.actual, low: join.actual, high: join.actual });
      past.pop();
      past.push({ label: join.label, actual: join.actual });
    }
    // Merge on label so the join point carries both keys.
    const byLabel = new Map();
    for (const row of [...past, ...future]) {
      byLabel.set(row.label, { ...(byLabel.get(row.label) || {}), ...row });
    }
    return [...byLabel.values()];
  }, [meta, forecast]);

  const boundaryLabel = meta?.history?.length ? meta.history[meta.history.length - 1].label : null;

  const STEPS = ["Dataset","Target","Settings","Run"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Predictions</h1>
        <p className="text-sm text-muted-foreground">Generate forecasts with confidence intervals.</p>
      </div>

      <GlassCard>
        <div className="flex items-center gap-3 mb-5">
          {STEPS.map((s, i) => {
            const n = i + 1; const active = step === n; const done = step > n;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={`h-7 w-7 rounded-full grid place-items-center text-xs font-semibold border transition-colors ${
                  active
                    ? "text-white glow border-transparent"
                    : done
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                      : "bg-muted/60 text-foreground/60 border-border"
                }`}
                  style={active ? { background: "var(--gradient-primary)" } : undefined}>
                  {done ? <FiCheck className="h-3 w-3" /> : n}
                </div>
                <div className={`text-xs ${active ? "font-semibold text-foreground" : done ? "text-foreground/70" : "text-muted-foreground"}`}>{s}</div>
                {i < STEPS.length - 1 && <div className={`w-10 h-px ${active || done ? "bg-primary/40" : "bg-border"}`} />}
              </div>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
            {step === 1 && (
              <div>
                <StepIntro
                  title="Choose the data to forecast from"
                  body="Pick the dataset holding the history you want projected forward. You can change this later."
                />
                {datasets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center">
                    <div className="text-sm font-medium">No datasets yet</div>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                      Import a CSV, Excel file or JSON on the Dataset page first — it needs a date column and at
                      least one numeric column.
                    </p>
                    <Link to="/dataset" className="mt-4 inline-block rounded-xl px-4 py-2 text-sm font-semibold text-white"
                      style={{ background: "var(--gradient-primary)" }}>
                      Go to Datasets
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {datasets.map((d) => {
                      const selected = dataset?.id === d.id;
                      return (
                        <button
                          key={d.id}
                          onClick={() => { setDataset(d); setTarget(""); }}
                          aria-pressed={selected}
                          className={`relative rounded-xl p-4 text-left border-2 transition-all ${
                            selected
                              ? "border-primary bg-primary/10 shadow-lg"
                              : "border-border/40 glass hover:border-border/80 hover:shadow-md"
                          }`}
                        >
                          {selected && (
                            <span className="absolute top-3 right-3 h-5 w-5 rounded-full grid place-items-center text-white"
                              style={{ background: "var(--gradient-primary)" }}>
                              <FiCheck className="h-3 w-3" />
                            </span>
                          )}
                          <div className="text-sm font-semibold pr-6">{d.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {d.rowCount ?? 0} rows · {d.headers?.length || 0} columns
                          </div>
                          {selected && <div className="text-[11px] font-medium text-primary mt-2">✓ Selected</div>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {step === 2 && dataset && (
              <div>
                <StepIntro
                  title={`Which column of ${dataset.name} do you want to predict?`}
                  body="Choose the number you care about — revenue, units, demand. The date column is detected for you."
                />
                <div className="flex flex-wrap gap-2">
                  {dataset.headers.map((h: string) => {
                    const selected = target === h;
                    return (
                      <button
                        key={h}
                        onClick={() => setTarget(h)}
                        aria-pressed={selected}
                        className={`px-3 py-2 rounded-lg text-xs border-2 transition-colors inline-flex items-center gap-1.5 ${
                          selected ? "text-white border-transparent" : "glass border-transparent hover:border-border"
                        }`}
                        style={selected ? { background: "var(--gradient-primary)" } : undefined}
                      >
                        {selected && <FiCheck className="h-3 w-3" />}
                        {h}
                      </button>
                    );
                  })}
                </div>
                {target && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Forecasting <span className="font-medium text-foreground">{target}</span>. Continue to set how far ahead to look.
                  </div>
                )}
              </div>
            )}
            {step === 3 && (
              <div>
                <StepIntro
                  title="How far ahead, and at what interval?"
                  body="Horizon is how many periods to project. Period should match how often your data is recorded — monthly data needs a monthly period."
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="text-xs">Prediction Horizon
                  <input type="number" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm" />
                </label>
                <label className="text-xs">Forecast Period
                  <select value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm">
                    {["Hourly","Daily","Weekly","Monthly","Quarterly"].map((p) => <option key={p}>{p}</option>)}
                  </select>
                </label>
                <label className="text-xs">Algorithm
                  <select value={algo} onChange={(e) => setAlgo(e.target.value)} className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm">
                    {ALGOS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                </label>
                <label className="text-xs">Date Column
                  <select value={dateColumn} onChange={(e) => setDateColumn(e.target.value)} className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm">
                    <option value="">Auto-detect</option>
                    {(dataset?.headers || []).filter((h: string) => h !== target).map((h: string) => <option key={h}>{h}</option>)}
                  </select>
                </label>
                </div>

                {algo === 'prophet' && (
                  <div className="mt-4 rounded-xl border border-border/50 p-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-xs text-muted-foreground max-w-sm">
                        Searches Prophet's own settings for a combination that scores better on this data's backtest than the defaults. Takes longer than a normal run — it fits several times.
                      </div>
                      <button
                        onClick={runTuning}
                        disabled={tuning || !dataset || !target}
                        className="shrink-0 text-xs px-3 py-2 rounded-lg bg-accent/40 hover:bg-accent/60 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        <FiZap className="h-3.5 w-3.5" /> {tuning ? 'Searching…' : 'Auto-tune'}
                      </button>
                    </div>

                    {tuneResult && (
                      <div className="mt-3 text-xs">
                        {tuneResult.improved ? (
                          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5">
                            <div className="text-emerald-400 font-medium">
                              Found a better fit: {tuneResult.defaultAccuracy}% → {tuneResult.bestAccuracy}% accuracy
                            </div>
                            <div className="text-muted-foreground mt-1">
                              changepoint_prior_scale={tuneResult.bestParams.changepoint_prior_scale}, seasonality_mode={tuneResult.bestParams.seasonality_mode}, seasonality_prior_scale={tuneResult.bestParams.seasonality_prior_scale}
                            </div>
                            <div className="text-emerald-400/80 mt-1">
                              {tunedParams ? '✓ Will be used on the next run' : ''}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg bg-muted/30 border border-border/50 p-2.5 text-muted-foreground">
                            The defaults ({tuneResult.defaultAccuracy}% accuracy) already beat every combination tried — nothing to change.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {step === 4 && (
              <div className="space-y-4">
                <StepIntro
                  title="Ready to forecast"
                  body="Check the settings below, then run it. A first run trains the model and measures its accuracy against held-back data — expect roughly two minutes. After that the model is reused and repeat runs return almost immediately."
                />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="glass rounded-xl p-3"><div className="text-[10px] text-muted-foreground">Dataset</div><div className="text-sm font-semibold truncate">{dataset?.name}</div></div>
                  <div className="glass rounded-xl p-3"><div className="text-[10px] text-muted-foreground">Target</div><div className="text-sm font-semibold">{target}</div></div>
                  <div className="glass rounded-xl p-3"><div className="text-[10px] text-muted-foreground">Horizon</div><div className="text-sm font-semibold">{horizon} {period}</div></div>
                  <div className="glass rounded-xl p-3">
                    <div className="text-[10px] text-muted-foreground">Algorithm</div>
                    <div className="text-sm font-semibold">
                      {ALGO_LABEL[algo]}{tunedParams && <span className="text-primary"> (tuned)</span>}
                    </div>
                  </div>
                </div>

                <button onClick={run} disabled={loading} className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white glow inline-flex items-center gap-2" style={{ background: "var(--gradient-primary)" }}>
                  <FiZap /> {loading ? "Generating Forecast…" : "Run Prediction"}
                </button>

                {loading && (
                  <div className="glass rounded-2xl p-10 text-center">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }} className="mx-auto h-10 w-10 rounded-full border-2 border-primary border-t-transparent" />
                    <div className="mt-3 text-sm text-muted-foreground">Training {ALGO_LABEL[algo]} model…</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Fitting on the server. A first run trains and scores the model — around two minutes on
                      a typical machine. Repeat runs on the same data are near-instant.
                    </div>
                  </div>
                )}

                {error && (
                  <div className="glass rounded-xl p-4 text-sm text-destructive border border-destructive/30">{error}</div>
                )}

                {meta?.accuracyNote && (
                  <div className="glass rounded-xl p-3 text-xs text-muted-foreground border border-border">
                    {meta.accuracyNote}
                  </div>
                )}

                {/* Prophet can fit noise worse than a flat line does. Saying so
                    is more useful than a number the user would act on. */}
                {meta?.mape != null && meta?.baselineMape != null && meta.mape >= meta.baselineMape && (
                  <div className="rounded-xl p-3 text-xs border border-amber-500/40 bg-amber-500/5 text-amber-200">
                    This model did not beat simply assuming no change — it was off by {meta.mape}% on held-out
                    history against {meta.baselineMape}% for a flat line. That usually means the series has no
                    pattern to learn, or too little history. Treat this forecast with real caution.
                  </div>
                )}

                {forecast && (
                  <>
                    <GlassCard>
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">Forecast — {ALGO_LABEL[algo]}</div>
                        <div className="flex items-center gap-3">
                          <div className="text-xs text-muted-foreground text-right">
                            {meta?.accuracy != null && (
                              <div>
                                Accuracy <span className="font-semibold text-emerald-400">{meta.accuracy}%</span>
                                {meta.mape != null && <> · MAPE {meta.mape}%</>}
                                {meta.dateColumn && <> · dates from <span className="font-medium">{meta.dateColumn}</span></>}
                              </div>
                            )}
                            {band && (
                              <div className="mt-0.5">
                                Confidence band <span className={`font-semibold ${band.tone}`}>{band.label}</span>
                                <span className="opacity-70"> ({band.avg}% wide)</span>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={async () => {
                              try {
                                await exportChartAsImage("forecast-chart", `forecast-${target || "chart"}`);
                                success("Chart exported", "PNG image downloaded");
                              } catch (e) {
                                info("Export failed", String(e));
                              }
                            }}
                            className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            title="Export chart as PNG"
                          >
                            <FiImage className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div id="forecast-chart">
                      <ResponsiveContainer width="100%" height={300}>
                        <ComposedChart data={combined} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                          <defs>
                            <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32} />
                              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.06} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                          <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} minTickGap={28} />
                          {/* Values sit far from zero, so a zero baseline would flatten the line. */}
                          <YAxis stroke="var(--muted-foreground)" fontSize={10} domain={["auto", "auto"]} width={58} />
                          <Tooltip
                            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                            formatter={(v: any, key: string) => {
                              if (v === null || v === undefined) return [null, null];
                              const names: any = { actual: "Recorded", value: "Forecast", high: "Best case", low: "Worst case" };
                              return [Number(v).toLocaleString(), names[key] ?? key];
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />

                          {/* Recorded history and the forecast estimate are
                              both solid — only the upper/lower bounds are
                              dashed — matching the convention used on
                              Dashboard, Insights, and What-If. */}
                          <Line type="monotone" dataKey="actual" name="Recorded" stroke="var(--muted-foreground)"
                            strokeWidth={2} dot={false} connectNulls />
                          <Line type="monotone" dataKey="value" name="Forecast (Estimate)" stroke="var(--chart-1)"
                            strokeWidth={2.5} dot={false} connectNulls />
                          {hasBand && <Line type="monotone" dataKey="high" name="Upper Bound" stroke="var(--chart-3)"
                            strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls opacity={0.6} />}
                          {hasBand && <Line type="monotone" dataKey="low" name="Lower Bound" stroke="var(--chart-4)"
                            strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls opacity={0.6} />}

                          {boundaryLabel && (
                            <ReferenceLine x={boundaryLabel} stroke="var(--muted-foreground)" strokeDasharray="4 4"
                              label={{ value: "forecast starts", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} />
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                      </div>

                      <div className="text-xs text-muted-foreground mt-2">
                        The grey line is data you recorded. The colored line is the model's projection, with
                        dashed upper/lower bounds — everything to the right of the marker has not happened yet.
                      </div>
                    </GlassCard>
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40"><tr><th className="text-left px-3 py-2">Period</th><th className="text-left px-3 py-2">Value</th><th className="text-left px-3 py-2">Low</th><th className="text-left px-3 py-2">High</th></tr></thead>
                        <tbody>{forecast.slice(0, 12).map((f) => (
                          <tr key={f.i} className="border-t border-border"><td className="px-3 py-2">{f.label}</td><td className="px-3 py-2">{f.value}</td><td className="px-3 py-2 text-muted-foreground">{f.low}</td><td className="px-3 py-2 text-muted-foreground">{f.high}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center justify-between gap-3 mt-6">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className="rounded-xl px-4 py-2 text-sm border border-border bg-muted/40 text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
          >Back</button>

          <div className="flex items-center gap-3 min-w-0">
            {/* Says why the button is unavailable instead of leaving the user
                to guess. */}
            {step === 1 && !dataset && <span className="text-xs text-muted-foreground">Pick a dataset to continue</span>}
            {step === 2 && !target && <span className="text-xs text-muted-foreground">Pick a column to forecast</span>}
            {step < 4 && (
              <button
                onClick={() => setStep((s) => Math.min(4, s + 1))}
                disabled={(step === 1 && !dataset) || (step === 2 && !target)}
                className="rounded-xl px-5 py-2 text-sm font-semibold text-white glow disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                style={{ background: "var(--gradient-primary)" }}
              >Next</button>
            )}
          </div>
        </div>
      </GlassCard>

      {comparedRuns.length >= 2 && (
        <GlassCard data-comparison-section>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <div className="font-semibold">Comparing {comparedRuns.length} forecasts</div>
            <button onClick={() => setCompare([])} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
          </div>
          <div className="text-xs text-muted-foreground mb-3">
            Aligned by step, so runs covering different dates can still be compared on shape.
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={comparisonData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="step" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={60} />
              <Tooltip
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                formatter={(v: any, key: string) => {
                  const run: any = comparedRuns[Number(String(key).replace("run", ""))];
                  return [Number(v).toLocaleString(), run?.name ?? key];
                }}
              />
              <Legend
                formatter={(key: string) => {
                  const run: any = comparedRuns[Number(String(key).replace("run", ""))];
                  if (!run) return key;
                  return `${run.name}${run.accuracy != null ? ` · ${run.accuracy}%` : ""}`;
                }}
                wrapperStyle={{ fontSize: 11 }}
              />
              {comparedRuns.map((_: any, i: number) => (
                <Line key={i} type="monotone" dataKey={`run${i}`} stroke={COMPARE_COLORS[i]}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>

          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Run</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2 text-right">Accuracy</th>
                  <th className="px-3 py-2 text-right">Steps</th>
                  <th className="px-3 py-2 text-right">Start</th>
                  <th className="px-3 py-2 text-right">End</th>
                  <th className="px-3 py-2 text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {comparedRuns.map((p: any, i: number) => {
                  const points = p.forecast || [];
                  const first = points[0]?.value;
                  const last = points[points.length - 1]?.value;
                  const change = first && last ? ((last - first) / Math.abs(first)) * 100 : null;
                  return (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: COMPARE_COLORS[i] }} />
                          <span className="font-medium">{p.name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.target ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.accuracy != null ? `${p.accuracy}%` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{points.length}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{first?.toLocaleString() ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{last?.toLocaleString() ?? "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${change == null ? "text-muted-foreground" : change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Prediction History</div>
          <div className="flex items-center gap-2">
            <div className="glass rounded-lg flex items-center gap-2 px-2.5 py-1.5"><FiSearch className="h-3.5 w-3.5 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="bg-transparent outline-none text-xs" /></div>
          </div>
        </div>
        <div className="space-y-2">
          {filteredHistory.length === 0 && <div className="text-xs text-muted-foreground">No predictions yet.</div>}
          {filteredHistory.map((p) => (
            <div key={p.id} className="flex items-center justify-between glass rounded-xl px-3 py-2.5 hover:bg-accent/30 transition-colors">
              <label className="flex items-center gap-3 min-w-0 cursor-pointer flex-1">
                <input
                  type="checkbox"
                  checked={compare.includes(p.id)}
                  onChange={() => toggleCompare(p.id)}
                  disabled={!compare.includes(p.id) && compare.length >= MAX_COMPARE}
                  className="shrink-0 accent-[var(--primary)] disabled:opacity-40"
                  title={compare.length >= MAX_COMPARE && !compare.includes(p.id)
                    ? `Comparing is limited to ${MAX_COMPARE} runs`
                    : "Compare this run"}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-muted/60 text-[10px] font-medium text-foreground/70">{p.algorithm}</span>
                    <span className="inline-block px-2 py-0.5 rounded-full bg-muted/60 text-[10px] font-medium text-foreground/70">{p.horizon} {p.period}</span>
                    {p.accuracy != null && <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-500/15 text-[10px] font-medium text-emerald-400">{p.accuracy}%</span>}
                    <span className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </label>
              <div className="flex gap-1 text-muted-foreground shrink-0 ml-2 items-center">
                <button
                  onClick={() => loadAnomalies(p.id)}
                  className="hover:text-amber-400 p-1.5 transition-colors"
                  title="View anomalies"
                >
                  <FiAlertTriangle className="h-4 w-4" />
                </button>
                <button onClick={() => { setReportPrediction(p); setShowReportBuilder(true); }} className="hover:text-chart-1 p-1.5 transition-colors" title="Generate PDF Report"><FiFileText className="h-4 w-4" /></button>
                <button onClick={() => exportPrediction(p, "csv")} className="hover:text-foreground p-1.5 transition-colors" title="Download as CSV"><FiDownload className="h-4 w-4" /></button>
                <button onClick={() => exportPrediction(p, "json")} className="hover:text-foreground p-1.5 transition-colors" title="Download as JSON"><FiDownload className="h-4 w-4" /></button>
                <button onClick={async () => { await deletePrediction(p.id); listPredictions().then(setHistory); }} className="hover:text-destructive p-1.5 transition-colors"><FiTrash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Floating compare action bar */}
      {compare.length > 0 && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40"
        >
          <div className="glass rounded-2xl px-6 py-3 flex items-center gap-4 border border-border/80">
            <div className="text-sm font-medium">
              {compare.length} forecast{compare.length !== 1 ? "s" : ""} selected
            </div>
            {compare.length >= 2 && (
              <button
                onClick={() => {
                  // Scroll to comparison section
                  const comparisonSection = document.querySelector('[data-comparison-section]');
                  comparisonSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-all"
                style={{ background: "var(--gradient-primary)" }}
              >
                View Comparison
              </button>
            )}
            <button
              onClick={() => setCompare([])}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Clear
            </button>
          </div>
        </motion.div>
      )}

      <ReportBuilder
        prediction={reportPrediction}
        chartRef={chartRef}
        insights={null}
        isOpen={showReportBuilder}
        onClose={() => { setShowReportBuilder(false); setReportPrediction(null); }}
      />

      {/* Anomalies — compares this forecast's past-due periods against
          whatever actual data has since arrived for those dates. */}
      {selectedPredictionForAnomalies && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog">
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setSelectedPredictionForAnomalies(null)} />
          <div className="relative w-full max-w-lg bg-background border border-border rounded-2xl shadow-2xl p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold">Anomalies</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Where recorded actuals landed outside this forecast's range.
                </p>
              </div>
              <button
                onClick={() => setSelectedPredictionForAnomalies(null)}
                className="rounded-lg h-8 w-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent/40"
              >
                <FiX className="h-4 w-4" />
              </button>
            </div>
            {loadingAnomalies ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Checking…</div>
            ) : (
              <AnomalyList anomalies={anomalies} onAcknowledge={onAcknowledgeAnomaly} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
