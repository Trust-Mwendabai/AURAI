// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, ComposedChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FiTrendingUp, FiTrendingDown, FiPieChart, FiLayers, FiSearch } from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import { SkeletonStatRow, SkeletonChart } from "@/components/Skeleton";
import { renderBold } from "@/lib/markdown";
import { listDatasets, getDataset, runAnalytics } from "@/lib/db";

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
};

const looksLikeDate = (v: any) =>
  typeof v === "string" && (/^\d{4}-\d{2}(-\d{2})?$/.test(v.trim()) || /^\d{4}$/.test(v.trim()));

/**
 * Picks a sensible column to group by: the categorical one with the fewest
 * distinct values.
 *
 * A date column is non-numeric too, but grouping by it yields one "segment"
 * per row, which says nothing. Real categories — store, product, region —
 * repeat across rows, so low cardinality is the signal.
 */
function defaultSegmentColumn(cols: string[], numeric: string[], rows: any[]) {
  const candidates = cols
    .filter((h) => !numeric.includes(h))
    .filter((h) => !rows.slice(0, 10).every((r) => looksLikeDate(r[h])))
    .map((h) => ({ h, distinct: new Set(rows.map((r) => r[h])).size }))
    .filter((c) => c.distinct > 1 && c.distinct < rows.length)
    .sort((a, b) => a.distinct - b.distinct);

  return candidates[0]?.h || cols.find((h) => !numeric.includes(h)) || cols[0] || "";
}

const fmt = (n: number) =>
  Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(n);

function Delta({ value }: any) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${up ? "text-emerald-400" : "text-rose-400"}`}>
      {up ? <FiTrendingUp className="h-3 w-3" /> : <FiTrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}{value}%
    </span>
  );
}

export default function AnalyticsPage() {
  const [datasets, setDatasets] = useState<any[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [numericHeaders, setNumericHeaders] = useState<string[]>([]);
  const [segmentColumn, setSegmentColumn] = useState("");
  const [valueColumn, setValueColumn] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [segmentQuery, setSegmentQuery] = useState("");

  useEffect(() => { listDatasets().then(setDatasets); }, []);

  // Loading the dataset is what tells us which columns are numeric, which
  // decides what can be measured versus what can only be grouped by.
  useEffect(() => {
    if (!datasetId) return;
    setResult(null);
    setError("");
    getDataset(datasetId).then((ds: any) => {
      const rows = ds?.rows || [];
      const cols = ds?.headers || Object.keys(rows[0] || {});
      const numeric = cols.filter((h: string) => rows.some((r: any) => typeof r[h] === "number"));
      setHeaders(cols);
      setNumericHeaders(numeric);
      setSegmentColumn(defaultSegmentColumn(cols, numeric, rows));
      setValueColumn(numeric[0] || "");
    });
  }, [datasetId]);

  const analyse = async () => {
    setLoading(true); setError(""); setResult(null);
    try {
      setResult(await runAnalytics({ datasetId, segmentColumn, valueColumn }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(
    () => (result?.segments || []).slice(0, 12).map((s: any) => ({ ...s, name: s.segment })),
    [result],
  );

  // A dataset can hold up to 200 segments, which is far too many to read as
  // one table — so the list is filtered and paged. The chart above still shows
  // the top 12 by total, which is the summary view.
  const visibleSegments = useMemo(() => {
    const q = segmentQuery.trim().toLowerCase();
    const all = result?.segments || [];
    return q ? all.filter((s: any) => String(s.segment).toLowerCase().includes(q)) : all;
  }, [result, segmentQuery]);

  const pageCount = Math.max(1, Math.ceil(visibleSegments.length / pageSize));
  // Clamped rather than stored blindly: filtering or resizing can leave the
  // current page beyond the end of the list.
  const safePage = Math.min(page, pageCount);
  const rangeStart = visibleSegments.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, visibleSegments.length);
  const pagedSegments = visibleSegments.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Back to the first page whenever the list underneath changes.
  useEffect(() => { setPage(1); }, [result, segmentQuery, pageSize]);

  const palette = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-2)"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Compare performance across products, regions, stores or any other grouping in your data.
        </p>
      </div>

      <GlassCard>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <label className="text-xs">
            Dataset
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}
              className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm">
              <option value="">Choose a dataset…</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="text-xs">
            Group by
            <select value={segmentColumn} onChange={(e) => setSegmentColumn(e.target.value)} disabled={!datasetId}
              className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm disabled:opacity-50">
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className="text-xs">
            Measure
            <select value={valueColumn} onChange={(e) => setValueColumn(e.target.value)} disabled={!datasetId}
              className="mt-1 w-full glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm disabled:opacity-50">
              {numericHeaders.length === 0 && <option value="">No numeric columns</option>}
              {numericHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <button
            onClick={analyse}
            disabled={!datasetId || !segmentColumn || !valueColumn || loading}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white glow disabled:opacity-40"
            style={{ background: "var(--gradient-primary)" }}
          >
            {loading ? "Analysing…" : "Analyse"}
          </button>
        </div>
        {error && <div className="mt-3 text-sm text-destructive">{error}</div>}
      </GlassCard>

      {loading && (
        <>
          <SkeletonStatRow />
          <SkeletonChart />
        </>
      )}

      {!result && !loading && (
        <GlassCard>
          <div className="py-10 text-center text-sm text-muted-foreground max-w-lg mx-auto">
            Pick a dataset, choose a column to group by — product, region, store, channel — and a numeric
            column to measure. Aurai works out who leads, who is growing, who is declining, and how
            concentrated the total is.
          </div>
        </GlassCard>
      )}

      {result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <GlassCard>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Total {result.valueColumn}</div>
                  <div className="text-2xl font-semibold mt-1 tabular-nums">{fmt(result.grandTotal)}</div>
                  <div className="text-xs text-muted-foreground mt-1">{result.rowsAnalysed} rows</div>
                </div>
                <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0"
                  style={{ background: "color-mix(in oklab, var(--chart-1) 18%, transparent)", color: "var(--chart-1)" }}>
                  <FiLayers className="h-4 w-4" />
                </div>
              </div>
            </GlassCard>

            <GlassCard delay={0.05}>
              <div className="text-xs text-muted-foreground">Largest {result.segmentColumn}</div>
              <div className="text-lg font-semibold mt-1 truncate">{result.leader?.segment ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">{result.leader?.share}% of total</div>
            </GlassCard>

            <GlassCard delay={0.1}>
              <div className="text-xs text-muted-foreground">Fastest growing</div>
              <div className="text-lg font-semibold mt-1 truncate">{result.fastestGrowing?.segment ?? "—"}</div>
              <div className="mt-1"><Delta value={result.fastestGrowing?.growth} /></div>
            </GlassCard>

            <GlassCard delay={0.15}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Concentration</div>
                  <div className="text-2xl font-semibold mt-1 tabular-nums">
                    {result.concentration.segmentsFor80Percent}/{result.concentration.totalSegments}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">segments make 80%</div>
                </div>
                <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0"
                  style={{ background: "color-mix(in oklab, var(--chart-4) 18%, transparent)", color: "var(--chart-4)" }}>
                  <FiPieChart className="h-4 w-4" />
                </div>
              </div>
            </GlassCard>
          </div>

          {result.summary && (
            <GlassCard>
              <div className="text-xs text-muted-foreground mb-2">What this means</div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {renderBold(result.summary)}
              </div>
            </GlassCard>
          )}

          <GlassCard>
            <div className="text-xs text-muted-foreground">
              {result.valueColumn} by {result.segmentColumn}
              {result.segments.length > 12 && <> — top 12 of {result.segments.length}</>}
            </div>
            <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 34)}>
              <ComposedChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={11}
                  tickLine={false} axisLine={false} width={110} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--border)", fillOpacity: 0.25 }}
                  formatter={(v: any, key: string) => [fmt(Number(v)), key === "total" ? result.valueColumn : key]} />
                <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                  {chartData.map((_: any, i: number) => (
                    <Cell key={i} fill={palette[i % palette.length]} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </GlassCard>

          {result.timeline.length > 1 && (
            <GlassCard>
              <div className="text-xs text-muted-foreground">Total {result.valueColumn} over time</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Grouped by month from <span className="font-medium">{result.dateColumn}</span>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={result.timeline} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="period" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={56} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmt(Number(v)), result.valueColumn]} />
                  <Line type="monotone" dataKey="total" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </GlassCard>
          )}

          <GlassCard>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className="font-semibold">Every {result.segmentColumn}</div>
              <div className="flex items-center gap-2">
                <div className="glass rounded-lg flex items-center gap-2 px-2.5 py-1.5">
                  <FiSearch className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={segmentQuery}
                    onChange={(e) => setSegmentQuery(e.target.value)}
                    placeholder={`Filter ${result.segmentColumn}…`}
                    className="bg-transparent outline-none text-xs w-32"
                    aria-label={`Filter by ${result.segmentColumn}`}
                  />
                </div>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="glass rounded-lg px-2 py-1.5 bg-transparent outline-none text-xs"
                  aria-label="Rows per page"
                >
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n} per page</option>)}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">{result.segmentColumn}</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Share</th>
                    <th className="px-3 py-2 text-right">Average</th>
                    <th className="px-3 py-2 text-right">Growth</th>
                    <th className="px-3 py-2 text-right">Volatility</th>
                    <th className="px-3 py-2">Peak</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSegments.map((s: any) => (
                    <tr key={s.segment} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{s.segment}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(s.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.share}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(s.average)}</td>
                      <td className="px-3 py-2 text-right"><Delta value={s.growth} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {s.volatility === null ? "—" : `${s.volatility}%`}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{s.peakPeriod ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleSegments.length === 0 && (
              <div className="text-xs text-muted-foreground py-6 text-center">
                No {result.segmentColumn} matches “{segmentQuery}”.
              </div>
            )}

            {/* The count shows whenever a filter is active, not only when there
                are several pages — otherwise a filter that narrows to one page
                leaves no indication of how many matched. */}
            {(pageCount > 1 || segmentQuery.trim()) && visibleSegments.length > 0 && (
              <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                <div className="text-xs text-muted-foreground">
                  Showing {rangeStart}–{rangeEnd} of {visibleSegments.length}
                  {visibleSegments.length !== result.segments.length && <> (filtered from {result.segments.length})</>}
                </div>
                <div className={`flex items-center gap-1 ${pageCount > 1 ? "" : "hidden"}`}>
                  <button
                    onClick={() => setPage((n: number) => Math.max(1, n - 1))}
                    disabled={safePage === 1}
                    className="glass rounded-lg px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >Previous</button>
                  <span className="text-xs text-muted-foreground px-2 tabular-nums">Page {safePage} of {pageCount}</span>
                  <button
                    onClick={() => setPage((n: number) => Math.min(pageCount, n + 1))}
                    disabled={safePage === pageCount}
                    className="glass rounded-lg px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >Next</button>
                </div>
              </div>
            )}

            <div className="text-[11px] text-muted-foreground mt-2">
              Growth compares the later half of each segment's history against the earlier half.
              Volatility is how far it swings around its own average.
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );
}
