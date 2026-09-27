// @ts-nocheck
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ComposedChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, ReferenceLine,
} from "recharts";
import { FiActivity, FiDatabase, FiTrendingUp, FiTarget, FiArrowRight, FiImage, FiCompass, FiFileText, FiX, FiZap } from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import { getStats } from "@/lib/db";
import { exportChartAsImage } from "@/lib/export";
import { useToast } from "@/contexts/ToastContext";
import { SkeletonStatRow, SkeletonChart } from "@/components/Skeleton";

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
};

function StatTile({ label, value, hint, icon: Icon, accent, delay }: any) {
  return (
    <GlassCard delay={delay}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
        </div>
        <div
          className="h-9 w-9 rounded-xl grid place-items-center shrink-0"
          style={{ background: `color-mix(in oklab, ${accent} 18%, transparent)`, color: accent }}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </GlassCard>
  );
}

const ONBOARDING_DISMISSED_KEY = "aurai_onboarding_dismissed";

/**
 * Shown only for a genuinely empty account (no datasets at all) — the plain
 * EmptyState below still covers "I have data but haven't forecasted yet".
 * This walks the full flow up front instead of leaving a first-time user to
 * find the Guide page on their own, and remembers being dismissed so it
 * doesn't reappear once someone's actually using the app.
 */
function WelcomeTour({ onDismiss }: any) {
  const steps = [
    { icon: FiDatabase, to: "/dataset", title: "1. Import a dataset", body: "Upload a CSV or Excel file with a date column and a number to forecast." },
    { icon: FiTrendingUp, to: "/predictions", title: "2. Run a forecast", body: "Pick your target column and horizon — a first run trains and scores the model." },
    { icon: FiCompass, to: "/insights", title: "3. Read the verdict", body: "Business Insights turns the numbers into a plain-language recommendation." },
    { icon: FiFileText, to: "/reports", title: "4. Export a report", body: "Every forecast gets an auto-generated report — download it as PDF or CSV." },
  ];

  return (
    <GlassCard>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <FiZap className="h-5 w-5 text-primary" />
          <div>
            <div className="font-semibold">Welcome to Aurai</div>
            <div className="text-xs text-muted-foreground">Four steps from raw data to a forecast you can act on.</div>
          </div>
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Dismiss">
          <FiX className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.to}
              to={s.to}
              className="rounded-xl p-4 border border-border/50 hover:border-primary/50 hover:bg-accent/30 transition-colors group"
            >
              <div
                className="h-8 w-8 rounded-lg grid place-items-center text-white mb-2 group-hover:scale-110 transition-transform"
                style={{ background: "var(--gradient-primary)" }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-sm font-medium">{s.title}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-snug">{s.body}</div>
            </Link>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Link to="/guide" className="text-xs text-primary hover:underline">Read the full User Guide →</Link>
        <Link
          to="/dataset"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white glow"
          style={{ background: "var(--gradient-primary)" }}
        >
          Get started <FiArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </GlassCard>
  );
}

function EmptyState() {
  return (
    <GlassCard>
      <div className="py-10 text-center">
        <div className="text-base font-semibold">No forecasts yet</div>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          Import a dataset, choose the column you want to predict, and Aurai will train a
          Prophet model on it. Your results show up here.
        </p>
        <Link
          to="/dataset"
          className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white glow"
          style={{ background: "var(--gradient-primary)" }}
        >
          Import a dataset <FiArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </GlassCard>
  );
}

const MONTH_LABEL = (ym: string) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "short" });
};

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState("");
  const [tourDismissed, setTourDismissed] = useState(true);
  const { success, info } = useToast();

  useEffect(() => {
    getStats().then(setStats).catch((e) => setError(e.message));
    try { setTourDismissed(localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "true"); } catch { /* ignore */ }
  }, []);

  const dismissTour = () => {
    setTourDismissed(true);
    try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true"); } catch { /* ignore */ }
  };

  if (error) {
    return <GlassCard><div className="text-sm text-destructive">Could not load dashboard: {error}</div></GlassCard>;
  }
  if (!stats) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your datasets, forecasts, and model accuracy.</p>
        </div>
        <SkeletonStatRow />
        <SkeletonChart />
      </div>
    );
  }

  const latest = stats.latest;
  const forecast = latest?.forecast || [];
  const history = latest?.history || [];
  const hasBand = forecast.some((p: any) => p.high !== p.low);
  const volume = (stats.byMonth || []).map((r: any) => ({ month: MONTH_LABEL(r.month), count: Number(r.n) }));

  // Combine history + forecast like Business Insights
  const combined = (() => {
    const past = (history || []).map((h: any) => ({ label: h.label, actual: h.value }));
    const future = (forecast || []).map((f: any) => ({
      label: f.label, value: f.value, low: f.low, high: f.high,
    }));
    if (past.length && future.length) {
      const join = past[past.length - 1];
      future.unshift({ label: join.label, value: join.actual, low: join.actual, high: join.actual });
      past.pop();
      past.push({ label: join.label, actual: join.actual });
    }
    const byLabel = new Map();
    for (const row of [...past, ...future]) {
      byLabel.set(row.label, { ...(byLabel.get(row.label) || {}), ...row });
    }
    return [...byLabel.values()];
  })();

  const boundaryLabel = history?.length ? history[history.length - 1].label : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your datasets, forecasts, and model accuracy.</p>
      </div>

      {stats.datasets === 0 && !tourDismissed && <WelcomeTour onDismiss={dismissTour} />}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile label="Forecasts run" value={stats.predictions} icon={FiTrendingUp} accent="var(--chart-1)" delay={0} />
        <StatTile label="Datasets" value={stats.datasets}
          hint={stats.totalRows ? `${stats.totalRows.toLocaleString()} rows` : null}
          icon={FiDatabase} accent="var(--chart-3)" delay={0.05} />
        <StatTile label="Average accuracy"
          value={stats.avgAccuracy != null ? `${stats.avgAccuracy}%` : "—"}
          hint={stats.avgAccuracy == null ? "No scored forecasts yet" : "Across all forecasts"}
          icon={FiTarget} accent="var(--chart-4)" delay={0.1} />
        <StatTile label="Reports" value={stats.reports} icon={FiActivity} accent="var(--chart-5)" delay={0.15} />
      </div>

      {!latest ? (
        <EmptyState />
      ) : (
        <GlassCard>
          <div className="flex items-end justify-between flex-wrap gap-2 mb-3">
            <div>
              <div className="text-xs text-muted-foreground">Latest forecast</div>
              <div className="text-lg font-semibold">{latest.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {latest.algorithm} · {latest.horizon} {latest.period}
                {latest.accuracy != null && <> · accuracy <span className="text-emerald-400 font-medium">{latest.accuracy}%</span></>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  try {
                    await exportChartAsImage("dashboard-chart", `dashboard-${latest.name || "forecast"}`);
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
              <Link to="/predictions" className="text-xs text-primary hover:underline">View all forecasts</Link>
            </div>
          </div>

          <div id="dashboard-chart">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={combined} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={56} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(l: any) => `Period: ${l}`}
                formatter={(v: any, name: string) => [Number(v).toLocaleString(), name === "actual" ? "Recorded" : name === "value" ? "Forecast" : name === "high" ? "Upper bound" : "Lower bound"]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="actual" name="Recorded" stroke="var(--muted-foreground)" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="value" name="Forecast (Estimate)" stroke="var(--chart-1)" strokeWidth={2} dot={false} connectNulls />
              {hasBand && <Line type="monotone" dataKey="high" name="Upper Bound" stroke="var(--chart-3)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} opacity={0.6} connectNulls />}
              {hasBand && <Line type="monotone" dataKey="low" name="Lower Bound" stroke="var(--chart-4)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} opacity={0.6} connectNulls />}
              {boundaryLabel && (
                <ReferenceLine x={boundaryLabel} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Grey line is recorded history. Blue line is the forecast with upper/lower bounds.
          </div>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <GlassCard className="xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Recent forecasts</div>
            <div className="text-xs text-muted-foreground">{stats.predictions} total</div>
          </div>
          {stats.recent.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">Nothing yet.</div>
          ) : (
            <div className="space-y-2">
              {stats.recent.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between glass rounded-xl px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.algorithm} · {new Date(p.created_at.replace(" ", "T")).toLocaleDateString()}
                    </div>
                  </div>
                  {p.accuracy != null && (
                    <div className="text-xs text-muted-foreground shrink-0 ml-3 tabular-nums">{p.accuracy}%</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <div className="font-semibold mb-1">Forecasts per month</div>
          <div className="text-xs text-muted-foreground mb-2">Last 12 months</div>
          {volume.length === 0 ? (
            <div className="text-xs text-muted-foreground py-10 text-center">No activity yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={volume} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Forecasts"]} cursor={{ fill: "var(--border)", fillOpacity: 0.3 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="var(--chart-1)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
