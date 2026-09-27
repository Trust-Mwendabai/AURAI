// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { FiPlus, FiTrash2, FiSave, FiRotateCcw, FiTrendingUp, FiTrendingDown, FiZap, FiImage, FiCheck } from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import { listPredictions, listScenarios, createScenario, deleteScenarioApi } from "@/lib/db";
import { useToast } from "@/contexts/ToastContext";
import { exportChartAsImage } from "@/lib/export";
import { SkeletonChart } from "@/components/Skeleton";

export default function WhatIfPage() {
  const [predictions, setPredictions] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [scenarioName, setScenarioName] = useState("");
  const [loading, setLoading] = useState(true);
  const [chartExported, setChartExported] = useState(false);
  const { success, info } = useToast();

  useEffect(() => {
    loadPredictions();
  }, []);

  // Scenarios are saved per-forecast server-side, so switching which
  // forecast is selected reloads the scenarios that belong to it — they
  // used to live only in React state and vanished on refresh.
  useEffect(() => {
    if (!selectedId) { setScenarios([]); return; }
    loadScenarios(selectedId);
  }, [selectedId]);

  const loadPredictions = async () => {
    try {
      const data = await listPredictions();
      setPredictions(data);
      if (data.length > 0) setSelectedId(data[0].id);
    } catch (e) {
      info('Failed to load forecasts', String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadScenarios = async (predictionId: string) => {
    setScenariosLoading(true);
    try {
      const rows = await listScenarios(predictionId);
      const forecastFor = predictions.find((p) => p.id === predictionId)?.forecast || [];
      setScenarios(rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        // The DB stores adjustments (deltas) and the metrics snapshot, not
        // the full forecast — reconstruct the per-period values here the
        // same way the live editor does, so the chart and comparison table
        // can render a reloaded scenario identically to a freshly-made one.
        forecast: forecastFor.map((point: any, idx: number) => {
          const adj = (r.adjustments || []).find((a: any) => a.period === idx);
          return { ...point, value: adj ? adj.value : point.value };
        }),
        metrics: r.results || null,
      })));
    } catch (e) {
      info('Could not load saved scenarios', String(e));
    } finally {
      setScenariosLoading(false);
    }
  };

  const selected = predictions.find((p) => p.id === selectedId);
  const originalForecast = selected?.forecast || [];

  const editingData = editing || {
    name: "New Scenario",
    adjustments: {},
  };

  const adjustedForecast = useMemo(() => {
    return originalForecast.map((point: any, idx: number) => ({
      ...point,
      original: point.value,
      value: editingData.adjustments?.[idx]?.value ?? point.value,
      adjustment: (editingData.adjustments?.[idx]?.value ?? point.value) - point.value,
      pct: ((editingData.adjustments?.[idx]?.value ?? point.value) - point.value) / point.value * 100,
    }));
  }, [originalForecast, editingData.adjustments]);

  const metrics = useMemo(() => {
    if (adjustedForecast.length === 0) return null;

    const originalTotal = originalForecast.reduce((s: number, p: any) => s + (p.value || 0), 0);
    const originalLow = originalForecast.reduce((s: number, p: any) => s + (p.low || 0), 0);
    const originalHigh = originalForecast.reduce((s: number, p: any) => s + (p.high || 0), 0);

    const adjustedTotal = adjustedForecast.reduce((s: number, p: any) => s + (p.value || 0), 0);
    const adjustedLow = adjustedForecast.reduce((s: number, p: any) => s + (p.low || 0), 0);
    const adjustedHigh = adjustedForecast.reduce((s: number, p: any) => s + (p.high || 0), 0);

    const difference = adjustedTotal - originalTotal;
    const percentChange = (difference / originalTotal) * 100;

    const originalAvg = originalTotal / originalForecast.length;
    const adjustedAvg = adjustedTotal / adjustedForecast.length;

    return {
      originalTotal,
      originalLow,
      originalHigh,
      adjustedTotal,
      adjustedLow,
      adjustedHigh,
      difference,
      percentChange,
      originalAvg,
      adjustedAvg,
    };
  }, [originalForecast, adjustedForecast]);

  const chartData = useMemo(() => {
    const history = selected?.history || [];
    const past = (history || []).map((h: any) => ({ label: h.label, actual: h.value }));
    const future = originalForecast.map((point: any, idx: number) => ({
      label: point.label,
      original: point.value,
      adjusted: adjustedForecast[idx]?.value || point.value,
      low: point.low,
      high: point.high,
    }));

    if (past.length && future.length) {
      const join = past[past.length - 1];
      future.unshift({
        label: join.label,
        original: join.actual,
        adjusted: join.actual,
        low: join.actual,
        high: join.actual,
      });
      past.pop();
      past.push({ label: join.label, actual: join.actual });
    }

    const byLabel = new Map();
    for (const row of [...past, ...future]) {
      byLabel.set(row.label, { ...(byLabel.get(row.label) || {}), ...row });
    }
    return [...byLabel.values()];
  }, [originalForecast, adjustedForecast, selected?.history]);

  const startScenario = () => {
    setEditing({
      name: `Scenario: ${selected?.name || ""}`,
      adjustments: {},
    });
    setScenarioName(editingData.name);
  };

  const updateAdjustment = (idx: number, value: number) => {
    setEditing({
      ...editingData,
      adjustments: {
        ...editingData.adjustments,
        [idx]: { value: Math.max(0, value) },
      },
    });
  };

  const resetAdjustments = () => {
    setEditing({
      ...editingData,
      adjustments: {},
    });
  };

  const saveScenario = async () => {
    if (!scenarioName.trim()) {
      info('Scenario name required', '');
      return;
    }
    // Adjustments go to the API as a period+value array (the format
    // scenarios.php expects), not the {idx: {value}} map the editor uses.
    const adjustmentsArray = Object.entries(editingData.adjustments || {}).map(([period, v]: any) => ({
      period: Number(period),
      value: v.value,
    }));

    try {
      const saved = await createScenario({
        predictionId: selectedId,
        name: scenarioName,
        adjustments: adjustmentsArray,
        results: metrics,
      });
      setScenarios([...scenarios, {
        id: saved.id,
        name: scenarioName,
        forecast: adjustedForecast,
        metrics,
      }]);
      setEditing(null);
      setScenarioName("");
      success('Scenario Saved', scenarioName);
    } catch (e: any) {
      info('Could not save scenario', String(e.message || e));
    }
  };

  const exportChart = async () => {
    try {
      await exportChartAsImage("whatif-chart", `whatif-${selected?.name || "scenario"}`);
      setChartExported(true);
      success("Chart exported", "PNG image downloaded");
      setTimeout(() => setChartExported(false), 2000);
    } catch (e) {
      info("Export failed", String(e));
    }
  };

  const deleteScenario = async (id: string) => {
    try {
      await deleteScenarioApi(id);
      setScenarios(scenarios.filter((s) => s.id !== id));
    } catch (e: any) {
      info('Could not delete scenario', String(e.message || e));
    }
  };

  const applyGlobalAdjustment = (percent: number) => {
    setEditing({
      ...editingData,
      adjustments: Object.fromEntries(
        originalForecast.map((_, idx) => [idx, { value: Math.max(0, originalForecast[idx].value * (1 + percent / 100)) }])
      ),
    });
  };

  const applyPreset = (name: string, percent: number) => {
    applyGlobalAdjustment(percent);
    setScenarioName(name);
  };

  const compareChart = useMemo(() => {
    if (scenarios.length === 0) return chartData;

    return chartData.map((point, idx) => {
      const obj: any = { ...point };
      scenarios.forEach((scenario, sIdx) => {
        obj[`scenario${sIdx}`] = scenario.forecast[idx]?.value;
      });
      return obj;
    });
  }, [chartData, scenarios]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">What-If Analysis</h1>
          <p className="text-sm text-muted-foreground">Explore forecast scenarios and measure impact.</p>
        </div>
        <SkeletonChart height={200} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">What-If Analysis</h1>
        <p className="text-sm text-muted-foreground">Adjust forecast values and see the impact on totals, averages, and trends.</p>
      </div>

      {predictions.length === 0 ? (
        <GlassCard className="text-center py-12">
          <p className="text-muted-foreground mb-4">No forecasts yet.</p>
          <p className="text-sm text-muted-foreground">Create a forecast on the Predictions tab first.</p>
        </GlassCard>
      ) : (
        <>
          {/* Top Toolbar */}
          <GlassCard>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-2">Select Forecast</label>
                <select
                  value={selectedId || ''}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    setEditing(null);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/50 outline-none focus:border-primary/50 text-sm"
                >
                  {predictions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.algorithm} • {p.accuracy}%)
                    </option>
                  ))}
                </select>
              </div>

              {selected && !editing && (
                <div className="flex gap-2 pt-2 border-t border-border/30 flex-wrap">
                  <button
                    onClick={() => applyPreset('Best Case (+15%)', 15)}
                    className="px-3 py-2 rounded-lg text-xs font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                  >
                    <FiTrendingUp className="inline h-3 w-3 mr-1" /> Best Case (+15%)
                  </button>
                  <button
                    onClick={() => applyPreset('Worst Case (-20%)', -20)}
                    className="px-3 py-2 rounded-lg text-xs font-medium bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-colors"
                  >
                    <FiTrendingDown className="inline h-3 w-3 mr-1" /> Worst Case (-20%)
                  </button>
                  <button
                    onClick={() => applyPreset('Neutral (+0%)', 0)}
                    className="px-3 py-2 rounded-lg text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          </GlassCard>

          {selected && (
            <>
              {/* Global Adjustment Slider - shown when editing */}
              {editing && (
                <GlassCard>
                  <div className="space-y-3">
                    <label className="block text-xs text-muted-foreground font-medium">Global Adjustment</label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="-50"
                        max="50"
                        step="1"
                        defaultValue="0"
                        onChange={(e) => applyGlobalAdjustment(parseFloat(e.target.value))}
                        className="flex-1 h-2 bg-muted/30 rounded-lg appearance-none cursor-pointer accent-primary"
                      />
                      <div className="text-xs text-muted-foreground min-w-12">
                        {editingData.adjustments && Object.values(editingData.adjustments).length > 0
                          ? `Adjusted`
                          : 'Original'}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Drag to apply a global percentage change to all forecast values.</p>
                  </div>
                </GlassCard>
              )}

              {/* Delta Summary Bar */}
              <div className="grid grid-cols-4 gap-3">
                <GlassCard>
                  <div className="text-xs text-muted-foreground mb-1">Original</div>
                  <div className="text-lg font-semibold">{metrics?.originalTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  <div className="text-xs text-muted-foreground mt-1">Lower: {metrics?.originalLow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  <div className="text-xs text-muted-foreground">Upper: {metrics?.originalHigh.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                </GlassCard>
                <GlassCard>
                  <div className="text-xs text-muted-foreground mb-1">Scenario</div>
                  <div className="text-lg font-semibold">{metrics?.adjustedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  <div className="text-xs text-muted-foreground mt-1">Lower: {metrics?.adjustedLow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  <div className="text-xs text-muted-foreground">Upper: {metrics?.adjustedHigh.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                </GlassCard>
                <GlassCard className="flex flex-col justify-center items-center">
                  <div className="text-xs text-muted-foreground mb-1">Difference</div>
                  <div className={`text-2xl font-bold ${metrics?.difference >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {metrics?.difference >= 0 ? '+' : ''}{metrics?.difference.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </GlassCard>
                <GlassCard className="flex flex-col justify-center items-center">
                  <div className="text-xs text-muted-foreground mb-1">% Change</div>
                  <div className={`text-2xl font-bold ${metrics?.percentChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {metrics?.percentChange >= 0 ? '+' : ''}{metrics?.percentChange.toFixed(1)}%
                  </div>
                </GlassCard>
              </div>

              {/* Chart */}
              <GlassCard>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs text-muted-foreground">Forecast Comparison with History</div>
                  <button
                    onClick={exportChart}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    title="Export chart as PNG"
                  >
                    {chartExported ? <FiCheck className="h-4 w-4 text-emerald-400" /> : <FiImage className="h-4 w-4" />}
                  </button>
                </div>
                <div id="whatif-chart">
                <ResponsiveContainer width="100%" height={400}>
                  <ComposedChart data={editing ? chartData : compareChart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} minTickGap={28} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={10} width={58} />
                    <Tooltip
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: any) => {
                        const names: any = { actual: "Recorded", original: "Original (Est)", adjusted: "Scenario (Est)", low: "Lower Bound", high: "Upper Bound" };
                        return [v?.toLocaleString(undefined, { maximumFractionDigits: 0 }), names[v] || v];
                      }}
                      labelFormatter={(label) => `Period: ${label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />

                    <Line type="monotone" dataKey="actual" name="Recorded History" stroke="var(--muted-foreground)" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="original" name="Original (Estimate)" stroke="var(--muted-foreground)" strokeWidth={2.5} dot={false} connectNulls />
                    <Line type="monotone" dataKey="adjusted" name="Scenario (Estimate)" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} connectNulls />
                    <Line type="monotone" dataKey="high" name="Upper Bound" stroke="var(--chart-3)" strokeWidth={2} strokeDasharray="4 4" dot={false} opacity={0.7} connectNulls />
                    <Line type="monotone" dataKey="low" name="Lower Bound" stroke="var(--chart-4)" strokeWidth={2} strokeDasharray="4 4" dot={false} opacity={0.7} connectNulls />
                    {scenarios.map((scenario, idx) => (
                      <Line
                        key={scenario.id}
                        type="monotone"
                        dataKey={`scenario${idx}`}
                        name={scenario.name}
                        stroke={['var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'][idx % 4]}
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                        connectNulls
                      />
                    ))}
                    {selected?.history?.length && (
                      <ReferenceLine x={selected.history[selected.history.length - 1].label} stroke="var(--muted-foreground)" strokeDasharray="4 4" opacity={0.5} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Grey line is recorded history. Blue lines are scenario forecasts with confidence bounds (green/red dashed lines).
                </div>
              </GlassCard>

              {/* Editor & Controls */}
              {editing ? (
                <div className="space-y-4">
                  {/* Scenario Name & Controls */}
                  <GlassCard>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Scenario Name</label>
                        <input
                          type="text"
                          value={scenarioName}
                          onChange={(e) => setScenarioName(e.target.value)}
                          placeholder="e.g., Q4 Aggressive Hiring Plan"
                          className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/50 outline-none focus:border-primary/50 text-sm"
                        />
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={resetAdjustments}
                          className="flex-1 min-w-32 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors inline-flex items-center justify-center gap-2"
                        >
                          <FiRotateCcw className="h-4 w-4" /> Reset
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="flex-1 min-w-32 px-3 py-2 rounded-lg text-sm border border-border/50 hover:bg-muted/30 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveScenario}
                          className="flex-1 min-w-32 px-3 py-2 rounded-lg text-sm font-medium text-white glow inline-flex items-center justify-center gap-2"
                          style={{ background: 'var(--gradient-primary)' }}
                        >
                          <FiSave className="h-4 w-4" /> Save Scenario
                        </button>
                      </div>
                    </div>
                  </GlassCard>

                  {/* Value Editor Table */}
                  <GlassCard>
                    <div className="text-xs text-muted-foreground mb-3 font-medium">Adjust Forecast Values - Click cells to edit</div>
                    <div className="overflow-x-auto rounded-lg border border-border/50">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/20">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium">Period</th>
                            <th className="text-right px-3 py-2 font-medium">Lower Bound</th>
                            <th className="text-right px-3 py-2 font-medium">Original</th>
                            <th className="text-right px-3 py-2 font-medium bg-primary/10">Adjusted</th>
                            <th className="text-right px-3 py-2 font-medium">Upper Bound</th>
                            <th className="text-right px-3 py-2 font-medium">Change %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adjustedForecast.map((point: any, idx: number) => (
                            <tr key={idx} className="border-t border-border/30 hover:bg-muted/10 transition-colors">
                              <td className="px-3 py-2 font-medium text-foreground">{point.label}</td>
                              <td className="text-right px-3 py-2 text-rose-400/70">{point.low.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td className="text-right px-3 py-2 text-muted-foreground">{point.original.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td className="text-right px-3 py-2 bg-primary/10">
                                <input
                                  type="number"
                                  value={point.value}
                                  onChange={(e) => updateAdjustment(idx, parseFloat(e.target.value) || 0)}
                                  className="w-20 px-2 py-1 rounded text-xs bg-muted/30 border border-border/50 outline-none focus:border-primary/50 text-right font-medium"
                                />
                              </td>
                              <td className="text-right px-3 py-2 text-emerald-400/70">{point.high.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td className={`text-right px-3 py-2 font-medium ${point.adjustment >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {point.pct >= 0 ? '+' : ''}{point.pct.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </GlassCard>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={startScenario}
                    className="flex-1 px-4 py-3 rounded-lg text-sm font-medium text-white glow inline-flex items-center justify-center gap-2"
                    style={{ background: 'var(--gradient-primary)' }}
                  >
                    <FiPlus className="h-4 w-4" /> Create New Scenario
                  </button>
                  {scenarios.length > 0 && (
                    <button
                      onClick={async () => {
                        await Promise.all(scenarios.map((s) => deleteScenarioApi(s.id).catch(() => {})));
                        setScenarios([]);
                      }}
                      className="px-4 py-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      Clear All Scenarios
                    </button>
                  )}
                </div>
              )}

              {/* Scenario Comparison */}
              {scenarios.length > 0 && (
                <GlassCard>
                  <div className="mb-4">
                    <h3 className="font-semibold text-sm mb-1">Scenario Comparison</h3>
                    <p className="text-xs text-muted-foreground">Every saved scenario against the original forecast, side by side.</p>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-border/50">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/20">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Scenario</th>
                          <th className="text-right px-3 py-2 font-medium">Total</th>
                          <th className="text-right px-3 py-2 font-medium">Avg / Period</th>
                          <th className="text-right px-3 py-2 font-medium">Lower Bound</th>
                          <th className="text-right px-3 py-2 font-medium">Upper Bound</th>
                          <th className="text-right px-3 py-2 font-medium">vs Original</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-border/30">
                          <td className="px-3 py-2 font-medium text-foreground">Original</td>
                          <td className="text-right px-3 py-2">{metrics?.originalTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="text-right px-3 py-2 text-muted-foreground">{metrics?.originalAvg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="text-right px-3 py-2 text-rose-400/70">{metrics?.originalLow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="text-right px-3 py-2 text-emerald-400/70">{metrics?.originalHigh.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="text-right px-3 py-2 text-muted-foreground">—</td>
                          <td className="px-3 py-2"></td>
                        </tr>
                        {scenarios.map((scenario) => (
                          <tr key={scenario.id} className="border-t border-border/30 hover:bg-muted/10 transition-colors">
                            <td className="px-3 py-2 font-medium text-foreground truncate max-w-[160px]">{scenario.name}</td>
                            <td className="text-right px-3 py-2">{scenario.metrics?.adjustedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            <td className="text-right px-3 py-2 text-muted-foreground">{scenario.metrics?.adjustedAvg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            <td className="text-right px-3 py-2 text-rose-400/70">{scenario.metrics?.adjustedLow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            <td className="text-right px-3 py-2 text-emerald-400/70">{scenario.metrics?.adjustedHigh.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            <td className={`text-right px-3 py-2 font-medium ${scenario.metrics?.percentChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {scenario.metrics?.percentChange >= 0 ? '+' : ''}{scenario.metrics?.percentChange.toFixed(1)}%
                            </td>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => deleteScenario(scenario.id)}
                                className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                                title="Remove scenario"
                              >
                                <FiTrash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {scenarios.length > 1 && (() => {
                    const best = scenarios.reduce((a, b) => (b.metrics?.adjustedTotal > a.metrics?.adjustedTotal ? b : a));
                    const worst = scenarios.reduce((a, b) => (b.metrics?.adjustedTotal < a.metrics?.adjustedTotal ? b : a));
                    return (
                      <div className="mt-3 flex flex-wrap gap-3 text-xs">
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400">
                          Highest total: <b>{best.name}</b>
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-400">
                          Lowest total: <b>{worst.name}</b>
                        </span>
                      </div>
                    );
                  })()}
                </GlassCard>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
