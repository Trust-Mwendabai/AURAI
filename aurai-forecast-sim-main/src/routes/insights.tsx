// @ts-nocheck
/**
 * Business Insights — the adviser's read on one forecast.
 *
 * The page answers "what should I do about this?" rather than "what does the
 * data say?". The written verdict leads, because that is what a business
 * reader acts on; the figures sit underneath as the evidence for it, and the
 * chart shows where recorded history stops and projection begins.
 *
 * Advice and figures arrive in one response, so the verdict can never describe
 * a different run from the one charted beneath it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  FiTrendingUp, FiTrendingDown, FiActivity, FiArrowUpRight,
  FiArrowDownRight, FiTarget, FiCpu, FiRefreshCw, FiCopy, FiDownload, FiChevronDown, FiFileText, FiImage, FiCheck,
} from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import { ReportBuilder } from "@/components/ReportBuilder";
import { renderRichText } from "@/lib/markdown";
import { getInsightsPage } from "@/lib/db";
import { exportChartAsImage } from "@/lib/export";
import { SkeletonChart } from "@/components/Skeleton";

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
};

const fmt = (n) =>
  n === null || n === undefined
    ? "—"
    : Math.abs(n) >= 1000
      ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
      : String(n);

const pct = (n) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n}%`);

/**
 * One headline figure.
 *
 * `tone` colours only the trend arrow, never the number itself: a figure
 * painted red reads as an error rather than as a decline.
 */
function Metric({ label, value, sub, icon: Icon, accent = "var(--chart-1)", tone, progress }) {
  return (
    <GlassCard>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
            <div className="text-2xl font-semibold mt-2 tabular-nums">{value}</div>
          </div>
          <div className="h-10 w-10 rounded-lg grid place-items-center shrink-0 border"
            style={{ background: `color-mix(in oklab, ${accent} 25%, transparent)`, color: accent, borderColor: `color-mix(in oklab, ${accent} 40%, transparent)` }}>
            <Icon className="h-5 w-5" />
          </div>
        </div>

        {progress !== undefined && (
          <div className="pt-1">
            <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${Math.min(progress, 100)}%`, background: accent, opacity: 0.7 }}
              />
            </div>
          </div>
        )}

        {sub && (
          <div className={`text-xs font-medium pt-1 ${
            tone === "up" ? "text-emerald-400" : tone === "down" ? "text-rose-400" : "text-foreground/70"
          }`}>
            {sub}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

/** Turns the volatility figure into the planning advice it implies. */
function volatilityNote(v) {
  if (v === null || v === undefined) return "not enough history to judge";
  if (v > 30) return "high — hold a real buffer";
  if (v > 12) return "moderate — modest contingency";
  return "low — plan close to the forecast";
}

/** The same for accuracy, in the terms a decision actually turns on. */
function accuracyNote(a) {
  if (a === null || a === undefined) return "not scored — indicative only";
  if (a >= 85) return "solid — reasonable to plan against";
  if (a >= 70) return "use the direction, not the exact figures";
  return "weak — gather more history first";
}

export default function InsightsPage() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [rewriteTone, setRewriteTone] = useState("balanced");
  const [copied, setCopied] = useState(false);
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [chartExported, setChartExported] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const exportChart = async () => {
    try {
      await exportChartAsImage("insights-chart", `insights-${data?.forecast?.name || "chart"}`);
      setChartExported(true);
      setTimeout(() => setChartExported(false), 2000);
    } catch (e) {
      console.error("Chart export failed:", e);
    }
  };

  const copyAdvice = () => {
    if (data?.advice) {
      navigator.clipboard.writeText(data.advice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const exportPDF = () => {
    setShowReportBuilder(true);
  };

  /**
   * Advice is written once per forecast and stored, so opening the page is a
   * database read and returns immediately. `refresh` asks for it to be written
   * again, which costs a model request — hence a separate control and a
   * separate spinner, so the wait is never a surprise.
   */
  const load = async (predictionId, refresh = false) => {
    if (refresh) setRegenerating(true); else setLoading(true);
    setError("");
    try {
      const res = await getInsightsPage(predictionId, refresh);
      setData(res);
      setSelected(res.forecast?.id || "");
    } catch (e) {
      setError(e.message || "Could not load insights.");
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  };

  useEffect(() => { load(); }, []);

  const metrics = data?.metrics;
  const forecast = data?.forecast;

  /**
   * History and projection on one axis, in separate keys so each draws
   * differently. The last recorded point is repeated as the projection's first
   * value, or the two lines appear as disconnected fragments.
   */
  const combined = useMemo(() => {
    const past = (data?.history || []).map((h) => ({ label: h.label, actual: h.value }));
    const future = (data?.points || []).map((f) => ({
      label: f.label, value: f.value, low: f.low, high: f.high,
    }));
    if (past.length && future.length) {
      const join = past[past.length - 1];
      future.unshift({ label: join.label, value: join.actual, low: join.actual, high: join.actual });
    }
    const byLabel = new Map();
    for (const row of [...past, ...future]) {
      byLabel.set(row.label, { ...(byLabel.get(row.label) || {}), ...row });
    }
    return [...byLabel.values()];
  }, [data]);

  const boundaryLabel = data?.history?.length ? data.history[data.history.length - 1].label : null;
  const hasBand = (data?.points || []).some((p) => p.high > p.low);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Business Insights</h1>
          <p className="text-sm text-muted-foreground">
            What your forecast means for the decisions in front of you — growth, timing, risk,
            and how much weight the numbers deserve.
          </p>
        </div>

        {(data?.available?.length > 0) && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-muted-foreground">Forecast</label>
              <select
                value={selected}
                onChange={(e) => load(e.target.value)}
                className="mt-1 glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm min-w-64 border border-border/60"
              >
                {data.available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.accuracy !== null ? ` — ${p.accuracy}%` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <div className="relative group">
                <button
                  disabled={loading || regenerating}
                  title="Rewrite with different tone"
                  className="glass rounded-xl px-3 py-2.5 text-sm disabled:opacity-40 inline-flex items-center gap-2 border border-border/60 hover:border-border"
                >
                  <FiRefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
                  {regenerating ? "Rewriting…" : "Rewrite"}
                  <FiChevronDown className="h-3 w-3" />
                </button>
                <div className="absolute top-full mt-2 left-0 glass rounded-lg border border-border/60 hidden group-hover:block z-10 min-w-48 p-1">
                  {["balanced", "executive", "detailed", "risk-focused"].map((tone) => (
                    <button
                      key={tone}
                      onClick={() => {
                        setRewriteTone(tone);
                        load(selected, true);
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-accent/50 rounded-lg transition-colors capitalize"
                    >
                      {tone === "balanced" ? "Balanced" : tone === "executive" ? "Executive Summary" : tone === "detailed" ? "Detailed Analysis" : "Risk-Focused"}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={copyAdvice}
                disabled={!data?.advice}
                title="Copy commentary to clipboard"
                className="glass rounded-xl px-3 py-2.5 text-sm disabled:opacity-40 inline-flex items-center gap-2 border border-border/60 hover:border-border"
              >
                <FiCopy className="h-3.5 w-3.5" />
                {copied ? "Copied!" : "Copy"}
              </button>

              <button
                onClick={exportPDF}
                disabled={!data?.advice}
                title="Download as text file"
                className="glass rounded-xl px-3 py-2.5 text-sm disabled:opacity-40 inline-flex items-center gap-2 border border-border/60 hover:border-border"
              >
                <FiDownload className="h-3.5 w-3.5" />
                Export
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <GlassCard><div className="text-sm text-destructive">{error}</div></GlassCard>
      )}

      {loading && !data && <SkeletonChart height={320} />}

      {/* Nothing to advise on yet. The advice text already explains this, so
          the page shows it rather than inventing a second empty state. */}
      {!loading && data && !forecast && (
        <GlassCard>
          <div className="py-10 text-center text-sm text-muted-foreground max-w-lg mx-auto">
            {renderRichText(data.advice)}
          </div>
        </GlassCard>
      )}

      {forecast && (
        <>
          <GlassCard>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">Advising on</div>
                <div className="text-lg font-semibold mt-0.5">{forecast.name}</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {forecast.algorithm && (
                  <span className="inline-block px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs font-medium text-primary">
                    {forecast.algorithm}
                  </span>
                )}
                <span className="inline-block px-2.5 py-1 rounded-full bg-accent/30 border border-border/60 text-xs font-medium text-foreground/70">
                  {forecast.horizon} {String(forecast.period || "").toLowerCase()}
                </span>
                {forecast.target && (
                  <span className="inline-block px-2.5 py-1 rounded-full bg-muted/50 border border-border/60 text-xs font-medium text-foreground/70">
                    {forecast.target}
                  </span>
                )}
                {forecast.datasetName && (
                  <span className="inline-block px-2.5 py-1 rounded-full bg-muted/50 border border-border/60 text-xs font-medium text-foreground/70">
                    {forecast.datasetName}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/30 text-xs">
                <div className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <FiCpu className="h-3.5 w-3.5" />
                  {data.reasoned ? "Reasoning model" : "Built-in analysis"}
                </div>
                {data.generatedAt && (
                  <div className="text-muted-foreground">
                    {data.cached ? "Saved " : "Written "}
                    {new Date(data.generatedAt.replace(" ", "T")).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </GlassCard>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Metric
              label="Projected average"
              value={fmt(metrics?.forecastAvg)}
              sub={metrics?.growthPct === null || metrics?.growthPct === undefined
                ? "no history to compare"
                : `${pct(metrics.growthPct)} vs recent history`}
              tone={metrics?.growthPct > 0 ? "up" : metrics?.growthPct < 0 ? "down" : undefined}
              icon={metrics?.growthPct >= 0 ? FiTrendingUp : FiTrendingDown}
              accent="var(--chart-1)"
            />
            <Metric
              label="Peak"
              value={fmt(metrics?.peak?.value)}
              sub={metrics?.peak?.label}
              icon={FiArrowUpRight}
              accent="var(--chart-3)"
            />
            <Metric
              label="Trough"
              value={fmt(metrics?.trough?.value)}
              sub={metrics?.trough?.label}
              icon={FiArrowDownRight}
              accent="var(--chart-4)"
            />
            <Metric
              label="Accuracy"
              value={forecast.accuracy === null ? "—" : `${forecast.accuracy}%`}
              sub={accuracyNote(forecast.accuracy)}
              icon={FiTarget}
              accent="var(--chart-5)"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <GlassCard className="lg:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-muted-foreground">
                  Recorded history and projection
                  {boundaryLabel && <> — the dashed line is where the forecast starts</>}
                </div>
                <button
                  onClick={exportChart}
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Export chart as PNG"
                >
                  {chartExported ? <FiCheck className="h-4 w-4 text-emerald-400" /> : <FiImage className="h-4 w-4" />}
                </button>
              </div>
              <div id="insights-chart" ref={chartRef}>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={combined} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="insightBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10}
                    minTickGap={28} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={10} width={58}
                    domain={["auto", "auto"]} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, key) => {
                      const names = { actual: "Recorded", value: "Forecast", high: "Best case", low: "Worst case" };
                      return [fmt(Number(v)), names[key] || key];
                    }}
                  />
                  <Line type="monotone" dataKey="actual" name="Recorded" stroke="var(--muted-foreground)"
                    strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="value" name="Forecast (Estimate)" stroke="var(--chart-1)"
                    strokeWidth={2} dot={false} connectNulls />
                  {hasBand && <Line type="monotone" dataKey="high" name="Upper Bound" stroke="var(--chart-3)"
                    strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls opacity={0.7} />}
                  {hasBand && <Line type="monotone" dataKey="low" name="Lower Bound" stroke="var(--chart-4)"
                    strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls opacity={0.7} />}
                  {boundaryLabel && (
                    <ReferenceLine x={boundaryLabel} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              </div>
            </GlassCard>

            <div className="space-y-4">
              <Metric
                label="Swing across the window"
                value={metrics?.swingPct === null || metrics?.swingPct === undefined ? "—" : `${metrics.swingPct}%`}
                sub={metrics?.swingPct > 25 ? "pronounced — plan around the peak" : "moderate — a buffer covers it"}
                icon={FiActivity}
                accent="var(--chart-3)"
                progress={metrics?.swingPct}
              />
              <Metric
                label="Historical variability"
                value={metrics?.volatilityPct === null || metrics?.volatilityPct === undefined
                  ? "—" : `${metrics.volatilityPct}%`}
                sub={volatilityNote(metrics?.volatilityPct)}
                icon={FiActivity}
                accent="var(--chart-4)"
                progress={metrics?.volatilityPct}
              />
              <Metric
                label="Uncertainty by the end"
                value={metrics?.bandPct === null || metrics?.bandPct === undefined ? "—" : `${metrics.bandPct}%`}
                sub="width of the range at the final period"
                icon={FiTarget}
                accent="var(--chart-5)"
                progress={metrics?.bandPct}
              />
            </div>
          </div>

          <GlassCard data-advice-section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">The adviser's read</div>
              </div>
              <button
                onClick={copyAdvice}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                title="Copy to clipboard"
              >
                <FiCopy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
            <div className="text-sm leading-relaxed prose-sm max-w-3xl">
              {renderRichText(data.advice)}
            </div>
          </GlassCard>
        </>
      )}

      <ReportBuilder
        prediction={data?.forecast}
        chartRef={chartRef}
        insights={data}
        isOpen={showReportBuilder}
        onClose={() => setShowReportBuilder(false)}
      />
    </div>
  );
}
