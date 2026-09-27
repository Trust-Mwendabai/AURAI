// @ts-nocheck
import { api } from "@/lib/apiClient";

// Map DB row (snake_case) to legacy camelCase shape used across routes.
function mapDataset(r: any) {
  if (!r) return r;
  // `headers` lives inside meta in the DB; fall back to the first row's keys
  // for datasets saved before it was persisted.
  const headers = r.meta?.headers || Object.keys(r.rows?.[0] || {});
  // The list endpoint omits `rows` — only getDataset() carries them.
  const rowCount = r.row_count ?? r.rows?.length ?? 0;
  return {
    ...r,
    headers,
    rowCount,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}
function mapPrediction(r: any) {
  if (!r) return r;
  return { ...r, datasetId: r.dataset_id, createdAt: new Date(r.created_at).getTime() };
}
function mapReport(r: any) {
  if (!r) return r;
  return { ...r, createdAt: new Date(r.created_at).getTime(), updatedAt: new Date(r.updated_at).getTime() };
}
function mapConversation(r: any) {
  if (!r) return r;
  return { ...r, createdAt: new Date(r.created_at).getTime(), updatedAt: new Date(r.updated_at).getTime() };
}
function mapMessage(r: any) {
  if (!r) return r;
  return { ...r, conversationId: r.conversation_id, createdAt: new Date(r.created_at).getTime() };
}

// ============ DATASETS ============
export async function listDatasets() {
  const data = await api.get("/datasets");
  return (data || []).map(mapDataset);
}
export async function getDataset(id: any) {
  return mapDataset(await api.get(`/datasets/${id}`));
}
export async function addDataset(d: any) {
  const data = await api.post("/datasets", {
    name: d.name || "Untitled",
    rows: d.rows || [],
    meta: { ...(d.meta || {}), headers: d.headers || Object.keys(d.rows?.[0] || {}) },
    storage_path: d.storage_path || null,
  });
  return data?.id;
}
export async function updateDataset(id: any, patch: any) {
  const dbPatch: any = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.rows !== undefined) dbPatch.rows = patch.rows;
  if (patch.meta !== undefined) dbPatch.meta = patch.meta;
  await api.patch(`/datasets/${id}`, dbPatch);
}
export async function deleteDataset(id: any) {
  await api.del(`/datasets/${id}`);
}

// ============ PREDICTIONS ============
export async function listPredictions() {
  const data = await api.get("/predictions");
  return (data || []).map(mapPrediction);
}
export async function addPrediction(p: any) {
  const data = await api.post("/predictions", {
    name: p.name,
    datasetId: p.datasetId || null,
    target: p.target || null,
    horizon: p.horizon ?? null,
    period: p.period || null,
    algorithm: p.algorithm || null,
    modelName: p.modelName || null,
    accuracy: p.accuracy ?? null,
    forecast: p.forecast || [],
  });
  return data?.id;
}

// Trains a Prophet model on the dataset server-side and returns its forecast.
export async function runForecast(opts: any) {
  return api.post("/forecast", {
    datasetId: opts.datasetId,
    target: opts.target,
    dateColumn: opts.dateColumn || null,
    horizon: opts.horizon,
    period: opts.period,
    algorithm: opts.algorithm || undefined,
    tunedParams: opts.tunedParams || undefined,
  });
}
export async function deletePrediction(id: any) {
  await api.del(`/predictions/${id}`);
}

// Trains Prophet, ARIMA, Holt-Winters, and XGBoost on the same holdout split
// so their accuracy can be compared side-by-side. Slower than runForecast()
// (multiple fits per request) — only call this when the user explicitly asks
// to compare models, not on every forecast run.
export async function runModelArena(opts: any) {
  return api.post("/model-arena", {
    datasetId: opts.datasetId,
    target: opts.target,
    dateColumn: opts.dateColumn || null,
    horizon: opts.horizon,
    period: opts.period,
    models: opts.models || undefined,
  });
}

// Searches Prophet's changepoint/seasonality settings for the combination
// that scores best on this dataset's own backtest. Prophet-only — the
// other algorithms don't expose tunable hyperparameters through the same
// grid-search path.
export async function tuneForecast(opts: any) {
  return api.post("/forecast/tune", {
    datasetId: opts.datasetId,
    target: opts.target,
    dateColumn: opts.dateColumn || null,
    period: opts.period,
  });
}

// ============ SCENARIOS (What-If Analysis) ============
// Persisted server-side so a saved scenario survives a page refresh or
// switching forecasts and coming back — previously these lived only in
// React state and vanished the moment the tab closed.
export async function listScenarios(predictionId: string) {
  const data = await api.get(`/scenarios?prediction_id=${predictionId}`);
  return data || [];
}
export async function createScenario(opts: any) {
  return api.post("/scenarios", {
    prediction_id: opts.predictionId,
    name: opts.name,
    description: opts.description || null,
    adjustments: opts.adjustments || [],
    results: opts.results || {},
  });
}
export async function deleteScenarioApi(id: string) {
  await api.del(`/scenarios/${id}`);
}

// ============ ANOMALIES ============
// Compares a forecast against actuals that have since arrived in its
// dataset (e.g. after an Append) and records anything outside the
// forecasted range. Safe to call repeatedly — already-recorded dates are
// skipped, not duplicated.
export async function detectAnomalies(predictionId: string) {
  return api.post("/anomalies/detect", { prediction_id: predictionId });
}
export async function listAnomalies(predictionId: string) {
  return api.get(`/anomalies?prediction_id=${predictionId}`);
}
export async function acknowledgeAnomaly(id: string, acknowledged = true) {
  return api.patch(`/anomalies/${id}`, { acknowledged });
}

// ============ ASSISTANT ============
// conversationId lets the server resolve follow-ups ("why?", "tell me more")
// against what was already being discussed in this thread.
export async function askAssistant(question: string, conversationId?: string) {
  const res = await api.post("/assistant", { question, conversationId: conversationId || null });
  return res.answer;
}

// Written business advice for a forecast — growth against recent actuals,
// peaks, volatility and how much the model's accuracy justifies acting on it.
// Omit the id to advise on the most recent run.
export async function getInsights(predictionId?: string) {
  const res = await api.post("/insights", { predictionId: predictionId || null });
  return res.advice;
}

// Everything the Business Insights page renders: the same advice, plus the
// figures behind it and the series to chart. One request rather than several,
// so the verdict and the chart can never describe different runs.
//
// Advice is written once per forecast and stored, so opening the page again is
// a database read. Pass refresh to ask for it to be written afresh — which
// costs a model request, and is why it is never the default.
export async function getInsightsPage(predictionId?: string, refresh = false) {
  return api.post("/insights", { predictionId: predictionId || null, refresh });
}

// ============ ANALYTICS ============
// Segment comparison over a dataset: totals, share, growth and volatility per
// product / region / store, computed server-side from the stored rows.
export async function runAnalytics(opts: any) {
  return api.post("/analytics", {
    datasetId: opts.datasetId,
    segmentColumn: opts.segmentColumn,
    valueColumn: opts.valueColumn,
    dateColumn: opts.dateColumn || null,
  });
}

// ============ DASHBOARD STATS ============
export async function getStats() {
  return api.get("/stats");
}

// ============ SETTINGS ============
export async function loadSettings() {
  return api.get("/settings");
}
export async function persistSettings(prefs: any) {
  await api.put("/settings", prefs);
}

// ============ REPORTS ============
// The auto-generated reports users actually see on the Reports page live in
// `saved_reports` (see reports.tsx), not the legacy `reports` table below —
// this reads from the same place so profile stats and global search agree
// with what the Reports page shows.
export async function listReports() {
  const data = await api.get("/saved-reports");
  return (data || []).map((r: any) => ({
    ...mapReport(r),
    title: r.name,
    excerpt: r.description,
  }));
}
export async function getReport(id: any) {
  return mapReport(await api.get(`/reports/${id}`));
}
export async function saveReport(r: any) {
  const data = await api.post("/reports", {
    id: r.id,
    title: r.title || "Untitled report",
    body: r.body || "",
  });
  return data?.id;
}
export async function deleteReport(id: any) {
  await api.del(`/reports/${id}`);
}

// ============ CONVERSATIONS / MESSAGES ============
export async function listConversations() {
  const data = await api.get("/conversations");
  return (data || []).map(mapConversation);
}
export async function addConversation(c: any) {
  const data = await api.post("/conversations", { title: c.title || "New chat" });
  return data?.id;
}
export async function renameConversation(id: any, title: any) {
  await api.patch(`/conversations/${id}`, { title });
}
export async function deleteConversation(id: any) {
  await api.del(`/conversations/${id}`);
}
export async function listMessages(conversationId: any) {
  const data = await api.get(`/conversations/${conversationId}/messages`);
  return (data || []).map(mapMessage);
}
export async function addMessage(m: any) {
  const data = await api.post("/messages", {
    conversationId: m.conversationId,
    role: m.role,
    content: m.content || "",
  });
  return data?.id;
}

// ============ SCHEDULED REFRESHES ============
// Re-runs a forecast on a cadence without a real cron daemon — due schedules
// are picked up opportunistically by the server whenever /stats is called
// (i.e. on a dashboard load), not by a background process. See
// api/schedules.php for why.
export async function listSchedules() {
  return (await api.get("/schedules")) || [];
}
export async function createSchedule(opts: any) {
  return api.post("/schedules", {
    datasetId: opts.datasetId,
    target: opts.target,
    dateColumn: opts.dateColumn || null,
    horizon: opts.horizon,
    period: opts.period,
    algorithm: opts.algorithm || "prophet",
    name: opts.name || "",
    frequency: opts.frequency || "weekly",
  });
}
export async function updateSchedule(id: string, patch: any) {
  return api.patch(`/schedules/${id}`, patch);
}
export async function deleteSchedule(id: string) {
  await api.del(`/schedules/${id}`);
}
export async function runScheduleNow(id: string) {
  return api.post(`/schedules/${id}/run`, {});
}
