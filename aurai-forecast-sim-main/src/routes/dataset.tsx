// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FiUploadCloud, FiTrash2, FiEdit2, FiDownload, FiFile, FiAlertTriangle, FiX, FiCheck, FiPlusCircle } from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import { addDataset, listDatasets, getDataset, deleteDataset, updateDataset } from "@/lib/db";


function parseCSV(text: string) {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((l) => {
    const cells = l.split(",");
    const obj: any = {};
    headers.forEach((h, i) => { const v = (cells[i] ?? "").trim(); obj[h] = isNaN(Number(v)) || v === "" ? v : Number(v); });
    return obj;
  });
  return { headers, rows };
}

// Excel serial dates are days since 1899-12-30. SheetJS hands them back as
// Date objects when cellDates is on; this normalizes those to ISO day strings
// so the forecasting service can parse them like any other date column.
function normalizeCell(v: any) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  return v;
}

async function parseSpreadsheet(file: File) {
  // Imported lazily so the ~400KB parser is only fetched when someone
  // actually opens a spreadsheet.
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("That workbook has no sheets.");

  const sheet = wb.Sheets[sheetName];
  const raw: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  if (!raw.length) throw new Error(`Sheet "${sheetName}" is empty.`);

  const rows = raw.map((r) => {
    const o: any = {};
    for (const k of Object.keys(r)) o[String(k).trim()] = normalizeCell(r[k]);
    return o;
  });
  return { headers: Object.keys(rows[0] || {}), rows, sheetName, sheetCount: wb.SheetNames.length };
}

function parseDelimitedOrJson(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        if (file.name.toLowerCase().endsWith(".json")) {
          const arr = JSON.parse(text);
          const rows = Array.isArray(arr) ? arr : [arr];
          resolve({ headers: Object.keys(rows[0] || {}), rows });
        } else {
          resolve(parseCSV(text));
        }
      } catch (e) { reject(e); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function parseFile(file: File): Promise<any> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
    return parseSpreadsheet(file);
  }
  return parseDelimitedOrJson(file);
}

const CLEAN_LABELS: Record<string, string> = {
  removeNulls: "Remove null values",
  replaceNulls: "Replace nulls with 0",
  removeDuplicates: "Remove duplicates",
  trim: "Trim whitespace",
};

// Per-column missing-value fill strategies, as an alternative to the blanket
// removeNulls/replaceNulls above — a time series usually loses less signal by
// inferring a gap from its neighbors than by dropping the row or zeroing it.
const IMPUTE_LABELS: Record<string, string> = {
  linearInterpolate: "Linear interpolation",
  rollingMeanFill: "Rolling mean fill",
  forwardFill: "Forward fill",
  backwardFill: "Backward fill",
};

const isMissing = (v: any) => v === "" || v === null || v === undefined;
const asNum = (v: any) => (typeof v === "number" && isFinite(v) ? v : null);

// Fills gaps by walking straight lines between the nearest real values on
// either side — the right default for a trending series. A gap open on one
// edge (no earlier or later value to anchor to) falls back to carrying the
// one anchor it does have, rather than leaving it unfilled.
function linearInterpolate(rows: any[], column: string) {
  const out = rows.map((r) => ({ ...r }));
  const n = out.length;
  let i = 0;
  while (i < n) {
    if (!isMissing(out[i][column])) { i++; continue; }
    let j = i;
    while (j < n && isMissing(out[j][column])) j++;
    const left = i > 0 ? asNum(out[i - 1][column]) : null;
    const right = j < n ? asNum(out[j][column]) : null;
    const span = j - (i - 1);
    for (let k = i; k < j; k++) {
      if (left !== null && right !== null) {
        const t = (k - (i - 1)) / span;
        out[k][column] = Math.round((left + (right - left) * t) * 1e6) / 1e6;
      } else if (left !== null) out[k][column] = left;
      else if (right !== null) out[k][column] = right;
    }
    i = j;
  }
  return out;
}

// Fills each gap with the mean of the nearest real values within `window`
// periods on either side — smooths through a gap using local level rather
// than assuming a straight trend, useful when the series is noisy.
function rollingMeanFill(rows: any[], column: string, window = 5) {
  const out = rows.map((r) => ({ ...r }));
  const half = Math.floor(window / 2);
  for (let i = 0; i < out.length; i++) {
    if (!isMissing(out[i][column])) continue;
    const start = Math.max(0, i - half);
    const end = Math.min(out.length - 1, i + half);
    const vals: number[] = [];
    for (let k = start; k <= end; k++) { const v = asNum(out[k][column]); if (v !== null) vals.push(v); }
    if (vals.length) out[i][column] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1e6) / 1e6;
  }
  return out;
}

// Carries the last known value forward through a gap — the standard choice
// for a value that only changes on real events (price lists, headcount).
function forwardFill(rows: any[], column: string) {
  const out = rows.map((r) => ({ ...r }));
  let last: any = null;
  for (const r of out) {
    if (isMissing(r[column])) { if (last !== null) r[column] = last; }
    else last = r[column];
  }
  return out;
}

function backwardFill(rows: any[], column: string) {
  const out = rows.map((r) => ({ ...r }));
  let next: any = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (isMissing(out[i][column])) { if (next !== null) out[i][column] = next; }
    else next = out[i][column];
  }
  return out;
}

const IMPUTE_FNS: Record<string, (rows: any[], column: string) => any[]> = {
  linearInterpolate, rollingMeanFill, forwardFill, backwardFill,
};

/**
 * Per-column profile, so data quality can be judged before a forecast is run.
 *
 * Forecast quality is mostly decided by the input: a column that is half empty,
 * constant, or riddled with outliers will not produce a usable model, and it is
 * far cheaper to see that here than after a minute of training.
 */
function columnStats(rows: any[], headers: string[]) {
  const total = rows.length;

  return headers.map((h) => {
    const raw = rows.map((r) => r[h]);
    const present = raw.filter((v) => v !== "" && v !== null && v !== undefined);
    const missing = total - present.length;
    const distinct = new Set(present.map((v) => String(v))).size;
    const numbers = present.filter((v) => typeof v === "number" && isFinite(v)) as number[];
    const isNumeric = numbers.length > 0 && numbers.length >= present.length * 0.8;

    const base = {
      column: h,
      type: isNumeric ? "number" : "text",
      missing,
      missingPct: total ? Math.round((missing / total) * 1000) / 10 : 0,
      distinct,
      // Flags worth acting on before forecasting.
      constant: distinct === 1 && present.length > 1,
      allUnique: distinct === present.length && present.length > 1,
    };

    if (!isNumeric) {
      const counts = new Map<string, number>();
      for (const v of present) counts.set(String(v), (counts.get(String(v)) || 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return { ...base, mostCommon: top ? top[0] : null, mostCommonCount: top ? top[1] : 0 };
    }

    const sorted = [...numbers].sort((a, b) => a - b);
    const sum = numbers.reduce((a, b) => a + b, 0);
    const mean = sum / numbers.length;
    const median = sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const variance = numbers.reduce((s, v) => s + (v - mean) ** 2, 0) / numbers.length;
    const std = Math.sqrt(variance);

    // Values more than three standard deviations out. A handful is normal;
    // many usually means the column mixes units or contains error codes.
    const outliers = std > 0 ? numbers.filter((v) => Math.abs(v - mean) > 3 * std).length : 0;

    return {
      ...base,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean,
      median,
      std,
      outliers,
    };
  });
}

/**
 * Compares newly appended rows against the baseline established by the
 * dataset's existing rows — a static per-column check (columnStats above)
 * can only say "this column has outliers", it can't distinguish rows that
 * were always there from rows that just landed and don't fit the pattern.
 *
 * Returns per-column drift info only for numeric columns present in both
 * the baseline and the incoming rows, sorted worst-first so the banner can
 * lead with the column that deviates the most.
 */
function detectDrift(baselineRows: any[], newRows: any[], headers: string[]) {
  if (!baselineRows.length || !newRows.length) return [];

  return headers
    .map((h) => {
      const baseNums = baselineRows.map((r) => r[h]).filter((v) => typeof v === "number" && isFinite(v)) as number[];
      const newNums = newRows.map((r) => r[h]).filter((v) => typeof v === "number" && isFinite(v)) as number[];
      if (baseNums.length < 5 || newNums.length === 0) return null;

      const mean = baseNums.reduce((a, b) => a + b, 0) / baseNums.length;
      const variance = baseNums.reduce((s, v) => s + (v - mean) ** 2, 0) / baseNums.length;
      const std = Math.sqrt(variance);
      if (std === 0) return null;

      const flagged = newNums
        .map((v) => ({ value: v, z: Math.abs(v - mean) / std }))
        .filter((p) => p.z > 3)
        .sort((a, b) => b.z - a.z);

      const newMean = newNums.reduce((a, b) => a + b, 0) / newNums.length;
      const meanShiftPct = mean !== 0 ? ((newMean - mean) / Math.abs(mean)) * 100 : 0;

      if (flagged.length === 0 && Math.abs(meanShiftPct) < 25) return null;

      return {
        column: h,
        baselineMean: mean,
        baselineStd: std,
        newMean,
        meanShiftPct,
        flaggedCount: flagged.length,
        worst: flagged[0] || null,
        totalNew: newNums.length,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (b.worst?.z || 0) - (a.worst?.z || 0));
}

const num = (v: any, digits = 2) =>
  typeof v === "number" && isFinite(v)
    ? (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
                           : Number(v.toFixed(digits)).toString())
    : "—";

function stats(rows: any[], headers: string[]) {
  const numericCols = headers.filter((h) => rows.some((r) => typeof r[h] === "number"));
  let missing = 0;
  rows.forEach((r) => headers.forEach((h) => { if (r[h] === "" || r[h] === null || r[h] === undefined) missing++; }));
  return { rows: rows.length, cols: headers.length, missing, numeric: numericCols.length };
}

export default function DatasetPage() {
  const [datasets, setDatasets] = useState<any[]>([]);
  const [current, setCurrent] = useState<any>(null);
  const [tab, setTab] = useState("preview");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [pendingClean, setPendingClean] = useState<any>(null);
  const [cleanNotice, setCleanNotice] = useState<any>(null);
  const [valueKey, setValueKey] = useState("");
  const [labelKeyChoice, setLabelKeyChoice] = useState("");
  const [pendingAppend, setPendingAppend] = useState<any>(null);
  const [driftNotice, setDriftNotice] = useState<any>(null);
  const [appending, setAppending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);

  // The list carries metadata only, so opening a dataset fetches its rows.
  const selectDataset = async (d: any) => {
    if (!d) return setCurrent(null);
    setCurrent({ ...d, rows: [], loading: true });
    setPage(1);
    const full = await getDataset(d.id);
    setCurrent(full);
  };

  const refresh = async () => {
    const d = await listDatasets();
    setDatasets(d);
    if (!current && d[0]) selectDataset(d[0]);
  };
  useEffect(() => { refresh(); }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    setImportError("");
    setImporting(true);
    try {
      for (const f of Array.from(files)) {
        const parsed = await parseFile(f);
        if (!parsed.rows?.length) throw new Error(`${f.name} contained no rows.`);
        const id = await addDataset({ name: f.name, headers: parsed.headers, rows: parsed.rows });
        setCurrent({ id, name: f.name, headers: parsed.headers, rows: parsed.rows, createdAt: Date.now() });
        // A workbook can hold several sheets; only the first is imported.
        if (parsed.sheetCount > 1) {
          setImportError(`Imported sheet "${parsed.sheetName}" from ${f.name}. The other ${parsed.sheetCount - 1} sheet(s) were skipped — save them separately to import them.`);
        }
      }
      refresh();
    } catch (e: any) {
      setImportError(e.message || "That file could not be read.");
    } finally {
      setImporting(false);
    }
  };

  // Appending to an existing dataset (rather than always creating a new
  // one) is the case drift detection actually matters for — the incoming
  // rows have a baseline to be compared against. A drifted append always
  // stops for confirmation first; a clean one merges immediately.
  const onAppendFiles = async (files: FileList | null) => {
    if (!files || !current) return;
    setImportError("");
    setAppending(true);
    try {
      const file = files[0];
      const parsed = await parseFile(file);
      if (!parsed.rows?.length) throw new Error(`${file.name} contained no rows.`);

      const baselineRows = current.rows || [];
      const headers = current.headers || [];
      const drift = detectDrift(baselineRows, parsed.rows, headers);

      if (drift.length > 0) {
        setPendingAppend({ rows: parsed.rows, fileName: file.name, drift });
      } else {
        await commitAppend(parsed.rows, file.name, []);
      }
    } catch (e: any) {
      setImportError(e.message || "That file could not be read.");
    } finally {
      setAppending(false);
    }
  };

  const commitAppend = async (newRows: any[], fileName: string, drift: any[]) => {
    const merged = [...(current.rows || []), ...newRows];
    setCurrent({ ...current, rows: merged });
    await updateDataset(current.id, { rows: merged });
    refresh();
    setDriftNotice({ fileName, addedCount: newRows.length, drift });
    setPendingAppend(null);
  };

  const filteredRows = useMemo(() => {
    if (!current) return [];
    let rs = current.rows || [];
    if (q) rs = rs.filter((r: any) => Object.values(r).some((v: any) => String(v).toLowerCase().includes(q.toLowerCase())));
    if (sortKey) rs = [...rs].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * (sortDir === "asc" ? 1 : -1);
    });
    return rs;
  }, [current, q, sortKey, sortDir]);

  const pageSize = 10;
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const stat = current ? stats(current.rows || [], current.headers || []) : null;

  // Column profile plus the quality problems worth acting on. Computed from
  // rows already in memory, so opening the tab costs nothing.
  const columnProfile = useMemo(() => {
    if (!current?.rows?.length) return [];
    return columnStats(current.rows, current.headers || []).map((c: any) => {
      const warnings: string[] = [];
      if (c.missingPct >= 25) warnings.push(`${c.missingPct}% of values are missing`);
      else if (c.missingPct > 0 && c.missingPct < 25) warnings.push(`${c.missing} missing value${c.missing === 1 ? "" : "s"}`);
      if (c.constant) warnings.push("every row has the same value, so it carries no signal");
      if (c.allUnique && c.type !== "number") warnings.push("every value is unique — likely an identifier rather than something to forecast");
      if (c.outliers > 0) warnings.push(`${c.outliers} value${c.outliers === 1 ? "" : "s"} more than 3 standard deviations out`);
      return { ...c, warnings };
    });
  }, [current]);

  // Columns worth plotting, and a sensible default when the user hasn't picked.
  const numericCols = useMemo(
    () => (current?.headers || []).filter((h: string) => (current?.rows || []).some((r: any) => typeof r[h] === "number")),
    [current],
  );
  const defaultNumeric = numericCols[0];
  const defaultLabel = (current?.headers || []).find((h: string) => h !== defaultNumeric) || current?.headers?.[0];

  // The picked column is only honoured while it exists in this dataset, so
  // switching datasets falls back rather than plotting a missing column.
  const numericKey = numericCols.includes(valueKey) ? valueKey : defaultNumeric;
  const labelKey = (current?.headers || []).includes(labelKeyChoice) ? labelKeyChoice : defaultLabel;

  const chartData = useMemo(() => {
    if (!current || !numericKey) return [];
    return (current.rows || []).slice(0, 24).map((r: any, i: number) => ({ label: r[labelKey] ?? i, value: Number(r[numericKey]) || 0 }));
  }, [current, numericKey, labelKey]);

  const pieData = chartData.slice(0, 6);
  const PIE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--primary)"];

  const onDelete = async (id: any) => { await deleteDataset(id); if (current?.id === id) setCurrent(null); refresh(); };
  const onRename = async (ds: any) => { const n = prompt("Rename dataset", ds.name); if (n) { await updateDataset(ds.id, { name: n }); refresh(); } };
  const onExport = async (ds: any) => {
    // The list omits rows, so fetch the full dataset before exporting it.
    const full = ds.rows ? ds : await getDataset(ds.id);
    const blob = new Blob([JSON.stringify(full.rows || [], null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${ds.name}.json`; a.click();
  };

  const [target, setTarget] = useState("");
  useEffect(() => { if (current) localStorage.setItem(`aurai_target_${current.id}`, target); }, [current, target]);

  // Pure — computes the result of a cleaning operation without touching state,
  // so the effect can be previewed before it is written.
  const applyCleaning = (op: string, source: any[], headers: string[]) => {
    let rows = [...source];
    if (op === "removeNulls") rows = rows.filter((r) => headers.every((h) => r[h] !== "" && r[h] !== null && r[h] !== undefined));
    if (op === "replaceNulls") rows = rows.map((r) => { const o: any = { ...r }; headers.forEach((h) => { if (o[h] === "" || o[h] === null || o[h] === undefined) o[h] = 0; }); return o; });
    if (op === "removeDuplicates") { const seen = new Set(); rows = rows.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }); }
    if (op === "trim") rows = rows.map((r) => { const o: any = { ...r }; headers.forEach((h) => { if (typeof o[h] === "string") o[h] = o[h].trim(); }); return o; });
    return rows;
  };

  // Cleaning rewrites the stored dataset, so it asks first and reports exactly
  // what it will change — "removes 3 rows" rather than an unexplained edit.
  const requestCleaning = (op: string) => {
    if (!current) return;
    const source = current.rows || [];
    const headers = current.headers || [];
    const rows = applyCleaning(op, source, headers);

    const removed = source.length - rows.length;
    const changed = removed === 0
      ? rows.reduce((n, r, i) => n + (JSON.stringify(r) === JSON.stringify(source[i]) ? 0 : 1), 0)
      : 0;

    if (removed === 0 && changed === 0) {
      setCleanNotice({ text: "Nothing to change — this dataset is already clean.", undo: null });
      return;
    }
    setPendingClean({
      op,
      rows,
      summary: removed > 0
        ? `${CLEAN_LABELS[op]} will remove ${removed} of ${source.length} rows.`
        : `${CLEAN_LABELS[op]} will modify ${changed} of ${source.length} rows.`,
    });
  };

  // Same preview-then-confirm flow as requestCleaning, but scoped to one
  // column's missing values rather than the whole dataset.
  const requestImputation = (column: string, method: string) => {
    if (!current) return;
    const source = current.rows || [];
    const before = source.filter((r: any) => isMissing(r[column])).length;
    if (before === 0) return;
    const rows = IMPUTE_FNS[method](source, column);
    const after = rows.filter((r: any) => isMissing(r[column])).length;
    setPendingClean({
      op: method,
      column,
      rows,
      summary: `${IMPUTE_LABELS[method]} will fill ${before - after} of ${before} missing "${column}" value${before === 1 ? "" : "s"}${after > 0 ? ` (${after} at the very edge of the series have no neighbor to infer from and stay blank)` : ""}.`,
    });
  };

  const confirmCleaning = async () => {
    if (!current || !pendingClean) return;
    const before = current.rows || [];
    const { rows, op, column } = pendingClean;
    setPendingClean(null);
    setCurrent({ ...current, rows });

    // Imputation is column-scoped, so it's worth remembering which method
    // was used on which column — reproducibility the backlog asked for,
    // and a trail if a later run's numbers look different than expected.
    const meta = column
      ? {
          ...(current.meta || {}),
          imputationHistory: [
            ...((current.meta?.imputationHistory || [])),
            { column, method: op, appliedAt: new Date().toISOString() },
          ].slice(-50),
        }
      : undefined;

    await updateDataset(current.id, meta ? { rows, meta } : { rows });
    if (meta) setCurrent((c: any) => (c ? { ...c, meta } : c));
    refresh();

    // Undo restores the exact prior rows, so a mistaken clean is recoverable.
    setCleanNotice({
      text: column
        ? `${IMPUTE_LABELS[op]} applied to "${column}".`
        : `${CLEAN_LABELS[op]} applied — ${before.length} rows became ${rows.length}.`,
      undo: async () => {
        setCurrent((c: any) => (c ? { ...c, rows: before, meta: current.meta } : c));
        await updateDataset(current.id, { rows: before, meta: current.meta || {} });
        setCleanNotice({ text: "Reverted.", undo: null });
        refresh();
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Datasets</h1>
          <p className="text-sm text-muted-foreground">Import, preview, clean, and target your time series data.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard className="lg:col-span-2">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer border-2 border-dashed border-border rounded-2xl p-10 text-center hover:bg-accent/30 transition"
          >
            <FiUploadCloud className="h-8 w-8 mx-auto text-primary" />
            <div className="mt-2 font-medium">{importing ? "Reading file…" : "Drop files or click to import"}</div>
            <div className="text-xs text-muted-foreground">Excel (.xlsx, .xls, .xlsm), .csv and .json</div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.json,.xlsx,.xls,.xlsm"
              multiple
              hidden
              onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
            />
          </div>
          {importError && (
            <div className="mt-3 text-xs rounded-xl border border-border px-3 py-2 text-muted-foreground">{importError}</div>
          )}
          {current && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2">
              <div className="text-xs text-muted-foreground">
                Have new rows for <span className="font-medium text-foreground">{current.name}</span>? Append instead of creating a new dataset.
              </div>
              <button
                onClick={() => appendInputRef.current?.click()}
                disabled={appending}
                className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent/40 hover:bg-accent/60 transition-colors disabled:opacity-50"
              >
                <FiPlusCircle className="h-3.5 w-3.5" /> {appending ? "Checking…" : "Append data"}
              </button>
              <input
                ref={appendInputRef}
                type="file"
                accept=".csv,.json,.xlsx,.xls,.xlsm"
                hidden
                onChange={(e) => { onAppendFiles(e.target.files); e.target.value = ""; }}
              />
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <div className="font-semibold mb-2">Your datasets</div>
          <div className="space-y-1.5 max-h-64 overflow-auto scrollbar-thin">
            {datasets.length === 0 && <div className="text-xs text-muted-foreground">No datasets yet.</div>}
            {datasets.map((d) => (
              <div key={d.id} className={`flex items-center justify-between rounded-xl px-3 py-2 cursor-pointer ${current?.id === d.id ? "bg-primary/15" : "hover:bg-accent/30"}`} onClick={() => selectDataset(d)}>
                <div className="flex items-center gap-2 min-w-0"><FiFile className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><div className="truncate text-sm">{d.name}</div></div>
                <div className="flex gap-1 text-muted-foreground">
                  <button onClick={(e) => { e.stopPropagation(); onRename(d); }} className="hover:text-foreground p-1"><FiEdit2 className="h-3.5 w-3.5" /></button>
                  <button onClick={(e) => { e.stopPropagation(); onExport(d); }} className="hover:text-foreground p-1"><FiDownload className="h-3.5 w-3.5" /></button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(d.id); }} className="hover:text-destructive p-1"><FiTrash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {current && (
        <>
          {/* Pending append with drift — stops for confirmation before
              anything is written, since a bad merge is much harder to
              spot after it's mixed into the dataset than before. */}
          {pendingAppend && (
            <GlassCard className="border-amber-500/40">
              <div className="flex items-start gap-3">
                <FiAlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">
                    {pendingAppend.rows.length} new row{pendingAppend.rows.length === 1 ? "" : "s"} from "{pendingAppend.fileName}" don't match this dataset's historical pattern
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {pendingAppend.drift.map((d: any) => (
                      <div key={d.column} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{d.column}</span>:{" "}
                        {d.flaggedCount > 0 && (
                          <>{d.flaggedCount} value{d.flaggedCount === 1 ? "" : "s"} more than 3σ from the historical mean ({num(d.baselineMean)})
                            {d.worst && <> — furthest is {num(d.worst.value)}</>}
                            {d.meanShiftPct && Math.abs(d.meanShiftPct) >= 25 ? "; " : ""}
                          </>
                        )}
                        {Math.abs(d.meanShiftPct) >= 25 && (
                          <>the new rows' average ({num(d.newMean)}) is {d.meanShiftPct > 0 ? "up" : "down"} {Math.abs(d.meanShiftPct).toFixed(0)}% from the historical average ({num(d.baselineMean)})</>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    This can mean a genuine shift (a real spike, a new pricing tier) or a data problem (wrong units, a typo, mixed currencies). Check the numbers before adding them.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => commitAppend(pendingAppend.rows, pendingAppend.fileName, pendingAppend.drift)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors inline-flex items-center gap-1"
                    >
                      <FiCheck className="h-3.5 w-3.5" /> Add anyway
                    </button>
                    <button
                      onClick={() => setPendingAppend(null)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent/40 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </GlassCard>
          )}

          {/* Persisted after a completed append, so the drift finding isn't
              lost the moment the confirmation dialog closes. */}
          {driftNotice && !pendingAppend && (
            <GlassCard className={driftNotice.drift.length > 0 ? "border-amber-500/40" : "border-emerald-500/40"}>
              <div className="flex items-start gap-3">
                {driftNotice.drift.length > 0
                  ? <FiAlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                  : <FiCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0 text-sm">
                  Added {driftNotice.addedCount} row{driftNotice.addedCount === 1 ? "" : "s"} from "{driftNotice.fileName}"
                  {driftNotice.drift.length > 0
                    ? <> — flagged in <span className="font-medium">{driftNotice.drift.map((d: any) => d.column).join(", ")}</span>, added anyway.</>
                    : " — matched the historical pattern, no drift detected."}
                </div>
                <button onClick={() => setDriftNotice(null)} className="text-muted-foreground hover:text-foreground shrink-0"><FiX className="h-4 w-4" /></button>
              </div>
            </GlassCard>
          )}

          {/* Whole-dataset quality banner — promoted from the per-column
              table on the Columns tab, since a problem worth fixing before
              forecasting deserves to be seen without switching tabs. */}
          {columnProfile.some((c: any) => c.warnings.length > 0) && (
            <GlassCard className="border-border/80">
              <div className="flex items-start gap-3">
                <FiAlertTriangle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">
                    {columnProfile.filter((c: any) => c.warnings.length > 0).length} column{columnProfile.filter((c: any) => c.warnings.length > 0).length === 1 ? "" : "s"} worth a look before forecasting
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {columnProfile.filter((c: any) => c.warnings.length > 0).map((c: any) => (
                      <div key={c.column} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.column}</span> — {c.warnings.join("; ")}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setTab("columns")} className="mt-2 text-xs text-primary hover:underline">
                    View column details →
                  </button>
                </div>
              </div>
            </GlassCard>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[["Rows", stat!.rows],["Columns", stat!.cols],["Missing", stat!.missing],["Numeric Cols", stat!.numeric]].map(([l, v]: any, i) => (
              <GlassCard key={l} delay={i * 0.04}>
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="text-2xl font-semibold mt-1">{v}</div>
              </GlassCard>
            ))}
          </div>

          <GlassCard>
            <div className="flex items-center gap-2 border-b border-border pb-2">
              {["preview","columns","cleaning","target"].map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`text-xs px-3 py-1.5 rounded-lg capitalize ${tab === t ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-accent/40"}`}>{t}</button>
              ))}
              <div className="ml-auto flex gap-2">
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="glass rounded-lg px-3 py-1.5 text-xs bg-transparent outline-none" />
              </div>
            </div>

            {tab === "preview" && (
              <div className="mt-4 space-y-5">
                {/* Which columns to plot, rather than always the first numeric
                    one — a wide dataset otherwise has most of it invisible. */}
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs">
                    Plot value
                    <select
                      value={numericKey || ""}
                      onChange={(e) => setValueKey(e.target.value)}
                      className="mt-1 block glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm"
                    >
                      {numericCols.length === 0 && <option value="">No numeric columns</option>}
                      {numericCols.map((h: string) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                  <label className="text-xs">
                    Against
                    <select
                      value={labelKey || ""}
                      onChange={(e) => setLabelKeyChoice(e.target.value)}
                      className="mt-1 block glass rounded-xl px-3 py-2 bg-transparent outline-none text-sm"
                    >
                      {(current.headers || []).map((h: string) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                  <div className="text-xs text-muted-foreground pb-2">Showing the first 24 rows.</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="glass rounded-xl p-3">
                    <div className="text-xs text-muted-foreground mb-1">Line</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                        <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} /><YAxis stroke="var(--muted-foreground)" fontSize={10} />
                        <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                        <Line type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="glass rounded-xl p-3">
                    <div className="text-xs text-muted-foreground mb-1">Bar</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                        <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} /><YAxis stroke="var(--muted-foreground)" fontSize={10} />
                        <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                        <Bar dataKey="value" fill="var(--chart-2)" radius={[6,6,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="glass rounded-xl p-3">
                    <div className="text-xs text-muted-foreground mb-1">Area</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                        <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} /><YAxis stroke="var(--muted-foreground)" fontSize={10} />
                        <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                        <Area type="monotone" dataKey="value" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.3} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="glass rounded-xl p-3">
                    <div className="text-xs text-muted-foreground mb-1">Pie</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart><Pie data={pieData} dataKey="value" nameKey="label" innerRadius={40} outerRadius={70} paddingAngle={3}>
                        {pieData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie><Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} /></PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>{current.headers.map((h: string) => (
                        <th key={h} className="text-left px-3 py-2 font-medium cursor-pointer" onClick={() => { setSortKey(h); setSortDir(sortKey === h && sortDir === "asc" ? "desc" : "asc"); }}>
                          {h}{sortKey === h ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                        </th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r: any, i: number) => (
                        <tr key={i} className="border-t border-border">
                          {current.headers.map((h: string) => <td key={h} className="px-3 py-2">{String(r[h] ?? "")}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="text-muted-foreground">{filteredRows.length} rows</div>
                  <div className="flex gap-1">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} className="glass rounded-lg px-3 py-1">Prev</button>
                    <span className="px-3 py-1">{page} / {Math.max(1, Math.ceil(filteredRows.length / pageSize))}</span>
                    <button onClick={() => setPage((p) => p + 1)} className="glass rounded-lg px-3 py-1">Next</button>
                  </div>
                </div>
              </div>
            )}

            {tab === "columns" && (
              <div className="mt-4 space-y-3">
                <div className="text-xs text-muted-foreground">
                  What each column contains, so you can judge whether it's worth forecasting before you spend a minute training on it.
                </div>

                {columnProfile.some((c: any) => c.warnings.length > 0) && (
                  <div className="rounded-xl border border-border p-3 space-y-1">
                    <div className="text-xs font-medium">Worth a look</div>
                    {columnProfile.filter((c: any) => c.warnings.length > 0).map((c: any) => (
                      <div key={c.column} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.column}</span> — {c.warnings.join("; ")}
                      </div>
                    ))}
                  </div>
                )}

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2">Column</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2 text-right">Missing</th>
                        <th className="px-3 py-2 text-right">Distinct</th>
                        <th className="px-3 py-2 text-right">Min</th>
                        <th className="px-3 py-2 text-right">Max</th>
                        <th className="px-3 py-2 text-right">Mean</th>
                        <th className="px-3 py-2 text-right">Median</th>
                        <th className="px-3 py-2 text-right">Std dev</th>
                        <th className="px-3 py-2 text-right">Outliers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columnProfile.map((c: any) => (
                        <tr key={c.column} className="border-t border-border">
                          <td className="px-3 py-2 font-medium">{c.column}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.type === "number" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                              {c.type}
                            </span>
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${c.missingPct > 10 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {c.missing === 0 ? "—" : `${c.missing} (${c.missingPct}%)`}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.distinct}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(c.min)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(c.max)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(c.mean)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(c.median)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{num(c.std)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${c.outliers > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {c.type === "number" ? (c.outliers || "—") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Outliers are values more than three standard deviations from the mean. A few are normal;
                  a lot usually means the column mixes units or carries error codes.
                </div>
              </div>
            )}

            {tab === "cleaning" && (
              <div className="mt-4 space-y-3">
                {pendingClean && (
                  <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                    <div className="text-sm font-medium">{pendingClean.summary}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      This rewrites the stored dataset. You can undo it straight afterwards.
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={confirmCleaning}
                        className="rounded-xl px-4 py-2 text-sm font-semibold text-white glow"
                        style={{ background: "var(--gradient-primary)" }}
                      >
                        Apply
                      </button>
                      <button onClick={() => setPendingClean(null)} className="glass rounded-xl px-4 py-2 text-sm">Cancel</button>
                    </div>
                  </div>
                )}

                {cleanNotice && !pendingClean && (
                  <div className="rounded-xl border border-border p-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">{cleanNotice.text}</div>
                    <div className="flex gap-2 shrink-0">
                      {cleanNotice.undo && (
                        <button onClick={cleanNotice.undo} className="glass rounded-lg px-3 py-1.5 text-xs font-medium">Undo</button>
                      )}
                      <button onClick={() => setCleanNotice(null)} className="text-xs text-muted-foreground hover:text-foreground px-2">Dismiss</button>
                    </div>
                  </div>
                )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  ["Remove null values","removeNulls"],
                  ["Replace nulls with 0","replaceNulls"],
                  ["Remove duplicates","removeDuplicates"],
                  ["Trim whitespace","trim"],
                ].map(([label, op]) => (
                  <button key={op} onClick={() => requestCleaning(op as string)} className="glass rounded-xl px-4 py-3 text-left hover:glow transition">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">Preview the change before applying</div>
                  </button>
                ))}
                <GlassCard className="md:col-span-2">
                  <div className="text-xs text-muted-foreground">Current dataset</div>
                  <div className="grid grid-cols-4 gap-3 mt-2">
                    {Object.entries(stat!).map(([k, v]) => (
                      <div key={k} className="glass rounded-xl p-3"><div className="text-[10px] text-muted-foreground uppercase">{k}</div><div className="text-lg font-semibold">{v as any}</div></div>
                    ))}
                  </div>
                </GlassCard>
              </div>

              {/* Per-column imputation — an alternative to removeNulls/replaceNulls
                  above for numeric time series, where inferring a gap from its
                  neighbors usually keeps more signal than dropping or zeroing it. */}
              {columnProfile.some((c: any) => c.type === "number" && c.missing > 0) && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Fill missing values (numeric columns)</div>
                  <div className="space-y-2">
                    {columnProfile.filter((c: any) => c.type === "number" && c.missing > 0).map((c: any) => (
                      <div key={c.column} className="glass rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{c.column}</div>
                          <div className="text-xs text-muted-foreground">{c.missing} missing ({c.missingPct}%)</div>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {Object.entries(IMPUTE_LABELS).map(([method, label]) => (
                            <button
                              key={method}
                              onClick={() => requestImputation(c.column, method)}
                              className="rounded-lg px-2.5 py-1.5 text-xs glass hover:glow transition"
                              title={`Preview: ${label} on "${c.column}"`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {current.meta?.imputationHistory?.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Imputation history</div>
                  <div className="space-y-1">
                    {[...current.meta.imputationHistory].reverse().slice(0, 8).map((h: any, i: number) => (
                      <div key={i} className="text-xs text-muted-foreground glass rounded-lg px-3 py-1.5">
                        {IMPUTE_LABELS[h.method] || h.method} on <span className="text-foreground">"{h.column}"</span> — {new Date(h.appliedAt).toLocaleString()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            )}

            {tab === "target" && (
              <div className="mt-4 space-y-3">
                <div className="text-xs text-muted-foreground">Select your forecast target column</div>
                <div className="flex flex-wrap gap-2">
                  {current.headers.map((h: string) => (
                    <button key={h} onClick={() => setTarget(h)} className={`px-3 py-1.5 rounded-lg text-xs ${target === h ? "text-white glow" : "glass"}`} style={target === h ? { background: "var(--gradient-primary)" } : undefined}>{h}</button>
                  ))}
                </div>
                {target && (
                  <GlassCard className="mt-3">
                    <div className="text-xs text-muted-foreground">Selected target</div>
                    <div className="text-2xl font-semibold gradient-text">{target}</div>
                  </GlassCard>
                )}
              </div>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
