// @ts-nocheck
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiBookOpen, FiDatabase, FiTrendingUp, FiCompass, FiSliders, FiFileText,
  FiUsers, FiSettings, FiHelpCircle, FiChevronRight, FiChevronDown, FiChevronLeft, FiZap, FiAlertTriangle,
  FiInfo, FiCheckCircle, FiDownload, FiCpu, FiMenu, FiX, FiLayers,
} from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";

const SECTIONS = [
  { id: "getting-started", label: "Getting Started", icon: FiZap },
  { id: "datasets", label: "Datasets", icon: FiDatabase },
  { id: "predictions", label: "Running Forecasts", icon: FiTrendingUp },
  { id: "model-arena", label: "Model Arena", icon: FiLayers },
  { id: "reading-charts", label: "Reading the Charts", icon: FiCompass },
  { id: "insights", label: "Business Insights", icon: FiCompass },
  { id: "whatif", label: "What-If Analysis", icon: FiSliders },
  { id: "reports", label: "Reports & Exports", icon: FiFileText },
  { id: "workspaces", label: "Workspaces & Team Access", icon: FiUsers },
  { id: "ai-assistant", label: "Aurai AI Assistant", icon: FiCpu },
  { id: "settings", label: "Settings & Profile", icon: FiSettings },
  { id: "troubleshooting", label: "Troubleshooting & FAQ", icon: FiHelpCircle },
];

function Section({ active, id, title, icon: Icon, children }: any) {
  if (!active) return null;
  return (
    <motion.section
      key={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <div className="h-8 w-8 rounded-lg grid place-items-center text-white shrink-0" style={{ background: "var(--gradient-primary)" }}>
            <Icon className="h-4 w-4" />
          </div>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <div className="space-y-3 text-sm text-foreground/90 leading-relaxed">
          {children}
        </div>
      </GlassCard>
    </motion.section>
  );
}

function Step({ n, children }: any) {
  return (
    <div className="flex gap-3">
      <div className="h-6 w-6 rounded-full grid place-items-center text-xs font-semibold text-white shrink-0 mt-0.5" style={{ background: "var(--gradient-primary)" }}>
        {n}
      </div>
      <div className="flex-1 pt-0.5">{children}</div>
    </div>
  );
}

function Note({ tone = "info", children }: any) {
  const styles: any = {
    info: "border-primary/30 bg-primary/5 text-foreground/90",
    warn: "border-amber-500/40 bg-amber-500/5 text-amber-200",
    tip: "border-emerald-500/40 bg-emerald-500/5 text-emerald-200",
  };
  const icons: any = { info: FiInfo, warn: FiAlertTriangle, tip: FiCheckCircle };
  const Icon = icons[tone];
  return (
    <div className={`rounded-xl border p-3 text-xs flex gap-2 ${styles[tone]}`}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
      <div>{children}</div>
    </div>
  );
}

function FaqItem({ q, children }: any) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        <span className="font-medium text-sm">{q}</span>
        <FiChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="px-3.5 pb-3.5 text-sm text-muted-foreground leading-relaxed">{children}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function GuidePage() {
  const [active, setActive] = useState("getting-started");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const goTo = (id: string) => {
    setActive(id);
    setDrawerOpen(false);
  };

  const idx = SECTIONS.findIndex((s) => s.id === active);
  const current = SECTIONS[idx];
  const CurrentIcon = current.icon;
  const prev = SECTIONS[idx - 1];
  const next = SECTIONS[idx + 1];

  return (
    <div className="relative space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FiBookOpen className="h-6 w-6 text-primary" /> User Guide
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything you need to go from raw data to a forecast you can act on.
        </p>
      </div>

      {/* Top bar: opens the section list as a drawer instead of a
          persistent sidebar, and shows only the active section below. */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setDrawerOpen(true)}
          className="rounded-xl h-10 px-3.5 inline-flex items-center gap-2 border border-border bg-card/80 hover:bg-accent/40 transition-colors text-sm font-medium shrink-0"
        >
          <FiMenu className="h-4 w-4" />
          <span className="hidden sm:inline">Contents</span>
        </button>
        <div className="flex-1 min-w-0 rounded-xl border border-border bg-card/50 h-10 px-3 flex items-center gap-2">
          <CurrentIcon className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">{current.label}</span>
          <span className="text-xs text-muted-foreground ml-auto shrink-0">{idx + 1} / {SECTIONS.length}</span>
        </div>
      </div>

      {/* Drawer overlay */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              key="guide-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-40 bg-background/60 backdrop-blur-[2px]"
            />
            <motion.div
              key="guide-drawer"
              initial={{ x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed inset-y-0 left-0 z-50 w-[300px] max-w-[85%] p-3"
            >
              <div className="bg-background border border-border rounded-2xl h-full flex flex-col p-4 shadow-2xl">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-border shrink-0">
                  <div className="text-sm font-semibold">On this page</div>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="rounded-lg h-7 w-7 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent/40"
                    aria-label="Close contents" title="Close"
                  >
                    <FiX className="h-4 w-4" />
                  </button>
                </div>
                <nav className="mt-3 space-y-1 overflow-auto scrollbar-thin flex-1 min-h-0">
                  {SECTIONS.map((s) => {
                    const Icon = s.icon;
                    const isActive = active === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => goTo(s.id)}
                        className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-left transition-colors ${
                          isActive ? "text-primary-foreground glow" : "text-foreground/70 hover:text-foreground hover:bg-accent/40"
                        }`}
                        style={isActive ? { background: "var(--gradient-primary)" } : undefined}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1">{s.label}</span>
                        <FiChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                      </button>
                    );
                  })}
                </nav>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Active section only */}
      <AnimatePresence mode="wait">
        <div className="space-y-4">
          <Section active={active === "getting-started"} id="getting-started" title="Getting Started" icon={FiZap}>
            <p>Aurai turns a spreadsheet of historical numbers into a forecast in four steps:</p>
            <Step n={1}>Upload a dataset (CSV or Excel) on the <b>Dataset</b> page.</Step>
            <Step n={2}>Pick the column you want to predict and run a forecast on <b>Predictions</b>.</Step>
            <Step n={3}>Read the written verdict on <b>Business Insights</b> — it tells you what the numbers mean, not just what they are.</Step>
            <Step n={4}>Export a professional PDF, CSV, or JSON report from the <b>Reports</b> page.</Step>
            <Note>
              Every account starts empty. If the Dashboard looks blank, that's expected — head to <b>Dataset</b> first.
            </Note>
          </Section>

          <Section active={active === "datasets"} id="datasets" title="Datasets" icon={FiDatabase}>
            <p>A dataset is a table with at least one <b>date column</b> and one <b>numeric column</b> — e.g. month + revenue, day + units sold.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Upload CSV or Excel (.xlsx) files directly from the Dataset page.</li>
              <li>Aurai auto-detects the date column, but you can override it when running a forecast.</li>
              <li>You can add extra numeric columns as <b>regressors</b> (e.g. marketing spend) so the model can account for them.</li>
              <li>Editing or replacing a dataset invalidates any cached forecasts tied to it — the next run retrains from scratch.</li>
            </ul>
            <Note tone="warn">
              Missing or non-numeric values in your target column are dropped before training. If a forecast looks off, check your data for stray text or blank cells first.
            </Note>
            <p className="pt-1">The <b>Cleaning</b> tab on a dataset offers per-column ways to fill gaps instead of dropping the row:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Linear interpolation</b> — draws a straight line between the values on either side of a gap. Best for a steadily trending series.</li>
              <li><b>Rolling mean fill</b> — averages nearby values. Smooths through a gap in a noisy series better than a straight line would.</li>
              <li><b>Forward / backward fill</b> — carries the last (or next) known value across the gap. Right for a value that only changes on real events.</li>
            </ul>
            <p>Every column that has missing numeric values gets its own set of buttons — pick the method per column, preview the exact count of cells it will fill, and apply. Past choices are listed underneath so you can see what was done and when.</p>
          </Section>

          <Section active={active === "predictions"} id="predictions" title="Running Forecasts" icon={FiTrendingUp}>
            <p>The Predictions page walks you through a short wizard:</p>
            <Step n={1}>Choose a dataset.</Step>
            <Step n={2}>Choose the target column (what you want to predict) and, optionally, regressor columns.</Step>
            <Step n={3}>Set the horizon (how many periods ahead) and period (Daily, Weekly, Monthly, Quarterly, Yearly).</Step>
            <Step n={4}>Pick an <b>Algorithm</b> — Prophet, ARIMA (auto), Holt-Winters, XGBoost, or LightGBM. Prophet is the default and the only one with one-click auto-tuning.</Step>
            <Step n={5}>Click <b>Run Prediction</b>. A first run trains the model (roughly a minute for Prophet); repeat runs on the same data/target/algorithm reuse the trained model and return almost instantly.</Step>
            <p className="pt-1">Each run also shows:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Accuracy</b> — how well the model predicted held-back historical data (not the future).</li>
              <li><b>MAPE</b> — mean absolute percentage error on that same holdout.</li>
              <li>A warning if the model didn't beat a naive "assume no change" baseline — a sign the series may be too short or too noisy to model reliably.</li>
            </ul>
            <p>With Prophet selected, an <b>Auto-tune</b> panel appears — it grid-searches changepoint and seasonality settings against the default and tells you whether the tuned version actually improved accuracy before you apply it.</p>
            <p>A PNG export button (image icon) on the chart lets you grab a snapshot for slides or docs.</p>
            <Note tone="tip">
              Repeat runs on the same dataset, target, horizon, and algorithm reuse the cached result for 24 hours — you don't need to avoid re-running a forecast to save time.
            </Note>
          </Section>

          <Section active={active === "model-arena"} id="model-arena" title="Model Arena" icon={FiLayers}>
            <p>Model Arena runs every algorithm on the same dataset and target at once, so you can see which one actually fits your data best instead of guessing:</p>
            <Step n={1}>Pick a dataset, target column, horizon, and period, then click <b>Compare Models</b>.</Step>
            <Step n={2}>A training progress checklist shows each model as it fits — Prophet, ARIMA, Holt-Winters, XGBoost, LightGBM, and a weighted Ensemble of the two best backtest performers.</Step>
            <Step n={3}>Ranking cards show each model's accuracy and MAPE, with the top performer marked <b>BEST</b>. The overlay chart plots every model's forecast against history — the best one solid and thick, the rest dashed.</Step>
            <Step n={4}>Click <b>Use this model</b> on any card to save that result as a real prediction, exactly as if you'd run it from the Predictions page.</Step>
            <Note>
              Model Arena fits several models in parallel, so it takes longer than a single Predictions run — expect it to take a bit longer than training one model alone, not instant.
            </Note>
          </Section>

          <Section active={active === "reading-charts"} id="reading-charts" title="Reading the Charts" icon={FiCompass}>
            <p>Every forecast chart across the app follows the same convention:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Solid grey line</b> — recorded history, what actually happened.</li>
              <li><b>Solid/dashed colored line</b> — the model's best-estimate forecast.</li>
              <li><b>Upper &amp; lower dashed lines</b> — the confidence interval. The true future value is expected to land in this range most of the time.</li>
              <li><b>Vertical dashed marker</b> — the boundary where history ends and the forecast begins.</li>
            </ul>
            <Note>
              A wide gap between the upper and lower bounds means the model is less certain — treat far-future periods and wide bands with more caution than near-term, tight ones.
            </Note>
          </Section>

          <Section active={active === "insights"} id="insights" title="Business Insights" icon={FiCompass}>
            <p>This page answers <i>"what should I do about this?"</i> rather than just re-displaying numbers.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>A written verdict leads the page — generated once per forecast and reused, so opening the page is instant.</li>
              <li>Click <b>Regenerate</b> if you want a fresh take, or change the tone (balanced, optimistic, cautious) before rewriting it.</li>
              <li>Key metrics — peak, trough, swing, and volatility — sit below the verdict as the evidence behind it.</li>
              <li>Use the chart's export button to grab a PNG, or open the PDF report builder for a full executive summary.</li>
            </ul>
          </Section>

          <Section active={active === "whatif"} id="whatif" title="What-If Analysis" icon={FiSliders}>
            <p>Model scenarios without touching your real forecast:</p>
            <Step n={1}>Pick a forecast, then click <b>Create New Scenario</b>.</Step>
            <Step n={2}>Use a quick preset (Best Case +15%, Worst Case −20%) or the global adjustment slider, or edit individual period values directly in the table.</Step>
            <Step n={3}>Save the scenario to compare it against the original on the same chart.</Step>
            <p>The delta summary bar shows the total and percentage difference between your scenario and the original forecast at a glance.</p>
            <Note tone="tip">
              Save a "Best Case" and "Worst Case" scenario side by side, then use the comparison table to see which one moves your total the most before presenting either to stakeholders.
            </Note>
          </Section>

          <Section active={active === "reports"} id="reports" title="Reports & Exports" icon={FiFileText}>
            <p>A report is auto-generated every time you run a forecast — no manual step needed. On the Reports page you can:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Preview</b> — read the full written summary (forecast range, average per period, confidence interval commentary).</li>
              <li><b>Download as JSON</b> — the raw summary and full record.</li>
              <li><FiDownload className="inline h-3 w-3" /> <b>Download as CSV</b> — recorded history plus forecast values with upper/lower bounds, ready for a spreadsheet.</li>
              <li><FiFileText className="inline h-3 w-3" /> <b>Download as PDF</b> — a formatted, professional report with a title page, key metrics table, an embedded forecast chart, and the written commentary. This is the one to attach to an email or share with stakeholders.</li>
              <li><b>Regenerate</b> — rebuild the written summary if the underlying forecast changed.</li>
            </ul>
            <Note>
              If a forecast has no report yet (older runs, or one that failed to auto-generate), it shows up under <b>Generate Reports</b> at the bottom of the page with a one-click button.
            </Note>
          </Section>

          <Section active={active === "workspaces"} id="workspaces" title="Workspaces & Team Access" icon={FiUsers}>
            <p>Workspaces let a team share datasets, forecasts, and reports under one roof with role-based permissions:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Owner</b> — full control, including deleting the workspace and managing members.</li>
              <li><b>Editor</b> — can create and edit forecasts/datasets, and invite viewers or commenters.</li>
              <li><b>Commenter</b> — can view and comment, not edit.</li>
              <li><b>Viewer</b> — read-only access.</li>
            </ul>
            <p>Switch or create a workspace from the selector in the top header. Every workspace action (invites, role changes, deletions) is written to an audit log an owner or editor can review.</p>
          </Section>

          <Section active={active === "ai-assistant"} id="ai-assistant" title="Aurai AI Assistant" icon={FiCpu}>
            <p>Ask questions in plain language about your forecasts, datasets, or general planning — the Aurai AI page keeps a running conversation and can reference your most recent forecast automatically when you ask a follow-up like "why?" or "what about next quarter?".</p>
          </Section>

          <Section active={active === "settings"} id="settings" title="Settings & Profile" icon={FiSettings}>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Settings</b> — default forecast horizon/period, system name, and appearance (light/dark theme).</li>
              <li><b>Profile</b> — update your name and email, and change your password from its own dedicated section.</li>
            </ul>
            <p className="pt-1">The Settings page also has <b>Scheduled Refreshes</b> — pick a dataset, a target column, and a cadence (daily/weekly/monthly), and that forecast re-runs automatically, saved as a new prediction with its own report.</p>
            <Note tone="warn">
              There's no background job running this — a due schedule executes the next time anyone on the account opens the app, not at a fixed time of day. If nobody visits for a while, it simply waits and catches up on the next visit.
            </Note>
          </Section>

          <Section active={active === "troubleshooting"} id="troubleshooting" title="Troubleshooting & FAQ" icon={FiHelpCircle}>
            <div className="space-y-2">
              <FaqItem q="My forecast looks like a flat line.">
                Usually means the series is too short or too noisy for Prophet to find a pattern. Check the accuracy warning banner — if it says the model didn't beat a naive baseline, add more history if you can.
              </FaqItem>
              <FaqItem q="A report I generated isn't showing up.">
                Reports generate automatically right after a forecast completes. If one's missing, open Reports and look under "Generate Reports" — every forecast without a report gets a one-click button there.
              </FaqItem>
              <FaqItem q="Why did my second run of the same forecast come back instantly?">
                Aurai caches forecast results for 24 hours per dataset + target + horizon combination. That's expected — it's what makes repeat runs fast. Changing the dataset invalidates the cache automatically.
              </FaqItem>
              <FaqItem q="I can't see a workspace member's changes.">
                Confirm you're viewing the same workspace they were working in — the selector in the header can switch between workspaces you belong to.
              </FaqItem>
              <FaqItem q="PDF export is missing the chart.">
                Give the page a moment before exporting — the chart needs to fully render before it can be captured. If it's still missing, refresh the page and try again.
              </FaqItem>
            </div>
          </Section>
        </div>
      </AnimatePresence>

      {/* Prev / next navigation between sections */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => prev && goTo(prev.id)}
          disabled={!prev}
          className="flex-1 rounded-xl border border-border bg-card/50 h-10 px-3 flex items-center gap-1.5 text-sm text-left disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/40 transition-colors truncate"
        >
          <FiChevronLeft className="h-4 w-4 shrink-0" />
          <span className="truncate">{prev ? prev.label : "Start"}</span>
        </button>
        <button
          onClick={() => next && goTo(next.id)}
          disabled={!next}
          className="flex-1 rounded-xl border border-border bg-card/50 h-10 px-3 flex items-center justify-end gap-1.5 text-sm text-right disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/40 transition-colors truncate"
        >
          <span className="truncate">{next ? next.label : "End"}</span>
          <FiChevronRight className="h-4 w-4 shrink-0" />
        </button>
      </div>
    </div>
  );
}
