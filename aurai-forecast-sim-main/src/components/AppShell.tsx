// @ts-nocheck
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiGrid, FiDatabase, FiTrendingUp, FiCpu, FiFileText, FiBarChart2,
  FiSettings, FiUser, FiLogOut, FiMenu, FiZap, FiCompass, FiX,
  FiChevronLeft, FiChevronRight, FiSliders, FiBookOpen, FiLayers,
} from "react-icons/fi";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalSearch } from "./GlobalSearch";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { getCurrentUser, logout } from "@/lib/auth";
import { getSettings, initSettings } from "@/lib/settings";
import { requestNotificationPermission } from "@/lib/notifications";
import { useToast } from "@/contexts/ToastContext";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: FiGrid, description: "Overview of your datasets, forecasts, and model accuracy." },
  { to: "/dataset", label: "Dataset", icon: FiDatabase, description: "Upload, preview, and manage the data you forecast from." },
  { to: "/predictions", label: "Predictions", icon: FiTrendingUp, description: "Run a forecast on a dataset and view the results." },
  { to: "/analytics", label: "Analytics", icon: FiBarChart2, description: "Deeper metrics and analysis across your forecasts." },
  { to: "/insights", label: "Business Insights", icon: FiCompass, description: "A written verdict on what a forecast means for your business." },
  { to: "/whatif", label: "What-If Analysis", icon: FiSliders, description: "Model best/worst-case scenarios against a forecast." },
  { to: "/model-arena", label: "Model Arena", icon: FiLayers, description: "Compare Prophet, ARIMA, Holt-Winters, and XGBoost on the same data." },
  { to: "/aurai", label: "Aurai AI", icon: FiCpu, description: "Ask questions about your data and forecasts in plain language." },
  { to: "/reports", label: "Reports", icon: FiFileText, description: "Auto-generated reports — download as PDF, CSV, or text." },
  { to: "/guide", label: "User Guide", icon: FiBookOpen, description: "How to use Aurai, step by step, with troubleshooting tips." },
  { to: "/settings", label: "Settings", icon: FiSettings, description: "Default forecast options, appearance, and system preferences." },
  { to: "/profile", label: "Profile", icon: FiUser, description: "Your account details and password." },
];

export function AppShell({ children }: any) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // Tooltip is portaled to <body> so it isn't clipped by the nav's own
  // overflow-y-auto — setting one overflow axis forces the other to clip too.
  const [hoveredNav, setHoveredNav] = useState<{ item: any; rect: DOMRect } | null>(null);
  const [user, setUser] = useState<any>(null);
  const [settings, setSettings] = useState<any>(getSettings());
  const [currentWorkspace, setCurrentWorkspace] = useState<any>(null);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const { info } = useToast();

  useEffect(() => {
    setUser(getCurrentUser());
    initSettings().then(setSettings);

    // Request notification permission on app load
    if (localStorage.getItem("notifications_prompted") !== "true") {
      requestNotificationPermission().then((granted) => {
        localStorage.setItem("notifications_prompted", "true");
        if (granted) {
          info("Notifications enabled", "You'll receive updates about your forecasts and insights");
        }
      });
    }
  }, [info]);

  // Close mobile drawer when navigating
  useEffect(() => { setMobileDrawerOpen(false); }, [pathname]);

  const onLogout = async () => { await logout(); navigate("/login", { replace: true }); };

  return (
    // One gutter value for the outer margin and every gap between panels, so
    // the sidebar, header and content all line up. On mobile, reduce padding.
    <div className="flex min-h-screen w-full gap-4 p-3 md:p-4">
      {/* Sidebar — hidden on mobile, shown on md and up */}
      <motion.aside
        animate={{ width: collapsed ? 68 : 240 }}
        transition={{ type: "spring", stiffness: 220, damping: 28 }}
        className="sticky top-4 h-[calc(100vh-2rem)] shrink-0 hidden md:block"
      >
        <div className="glass-strong h-full rounded-3xl flex flex-col p-3 border border-border/80">
          {/* Header with brand and collapse button */}
          <div className="flex items-center justify-between gap-2 px-2 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-xl grid place-items-center text-white shrink-0" style={{ background: "var(--gradient-primary)" }}>
                <FiZap className="h-4 w-4" />
              </div>
              <AnimatePresence>
                {!collapsed && (
                  <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="leading-tight min-w-0">
                    <div className="font-semibold text-sm truncate">{settings.systemName}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{settings.companyName}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="text-foreground/60 hover:text-foreground transition-colors shrink-0"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <FiChevronRight className="h-4 w-4" /> : <FiChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          {/* Navigation - all items scrollable */}
          <nav className="mt-4 flex-1 space-y-1 overflow-y-auto scrollbar-hover">
            {NAV_ITEMS.map((item) => {
              const active = pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <div key={item.to} className="group relative">
                  <Link to={item.to}
                    onMouseEnter={(e) => setHoveredNav({ item, rect: e.currentTarget.getBoundingClientRect() })}
                    onMouseLeave={() => setHoveredNav((h) => (h?.item === item ? null : h))}
                    className={`flex items-center rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
                      collapsed ? "justify-center" : "gap-3"
                    } ${
                      active
                        ? "text-primary-foreground glow"
                        : "text-foreground/60 hover:text-foreground" + (collapsed ? " md:hover:bg-accent/50" : " hover:bg-accent/50")
                    }`}
                    style={active ? { background: "var(--gradient-primary)" } : undefined}
                  >
                    <Icon className={`h-4 w-4 shrink-0 transition-all duration-200 ${
                      active ? "" : "group-hover:scale-125"
                    }`} />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                </div>
              );
            })}
          </nav>
        </div>
      </motion.aside>

      {/* Nav tooltip, portaled to <body> and positioned from the hovered
          item's own bounding rect — rendering it inside the sidebar would
          get clipped by the nav's overflow-y-auto (overflow-x clips too,
          per the CSS spec, once either axis is non-visible). */}
      {hoveredNav && createPortal(
        <div
          className="fixed z-[100] pointer-events-none"
          style={{ left: hoveredNav.rect.right + 12, top: hoveredNav.rect.top + hoveredNav.rect.height / 2, transform: "translateY(-50%)" }}
        >
          <div className="glass-strong rounded-lg px-3 py-2 w-56 border border-border/80 shadow-lg glow">
            <div className="text-sm font-semibold text-foreground">{hoveredNav.item.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{hoveredNav.item.description}</div>
          </div>
        </div>,
        document.body
      )}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <header className="sticky top-4 z-30">
          <div className="glass-strong rounded-2xl flex items-center gap-3 px-4 py-2.5 border border-border/80">
            {/* Mobile menu button */}
            <button
              onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
              className="md:hidden text-foreground hover:text-primary"
              aria-label="Toggle menu"
            >
              <FiMenu className="h-5 w-5" />
            </button>
            {/* Workspace selector */}
            <WorkspaceSelector
              currentWorkspace={currentWorkspace}
              onSelectWorkspace={setCurrentWorkspace}
              onCreateWorkspace={() => setShowCreateWorkspace(true)}
            />
            <div className="w-px h-6 bg-border/30" />
            <GlobalSearch />
            {/* Spacer to push user section to the right */}
            <div className="flex-1" />
            {/* User profile section at far right */}
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <div className="glass rounded-full pl-1 pr-3 py-1 flex items-center gap-2">
                <div className="h-7 w-7 rounded-full grid place-items-center text-white text-xs font-semibold" style={{ background: "var(--gradient-primary)" }}>
                  {(user?.name || "U").slice(0, 1).toUpperCase()}
                </div>
                <div className="leading-tight hidden md:block">
                  <div className="text-xs font-semibold">{user?.name || "Guest"}</div>
                  <div className="text-[10px] text-muted-foreground">{user?.email || ""}</div>
                </div>
                <button onClick={onLogout} className="ml-1 text-muted-foreground hover:text-foreground" aria-label="Logout">
                  <FiLogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Mobile drawer overlay and navigation */}
        <AnimatePresence>
          {mobileDrawerOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileDrawerOpen(false)}
                className="fixed inset-0 bg-black/50 md:hidden z-40"
              />
              {/* Drawer */}
              <motion.div
                initial={{ x: -256 }}
                animate={{ x: 0 }}
                exit={{ x: -256 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="fixed left-0 top-0 h-screen w-64 z-50 md:hidden"
              >
                <div className="glass-strong h-full rounded-r-3xl flex flex-col p-3 border-r border-border/80">
                  <div className="flex items-center justify-between px-2 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl grid place-items-center text-white" style={{ background: "var(--gradient-primary)" }}>
                        <FiZap className="h-4 w-4" />
                      </div>
                      <div className="leading-tight">
                        <div className="font-semibold text-sm">{settings.systemName}</div>
                        <div className="text-[11px] text-muted-foreground">{settings.companyName}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => setMobileDrawerOpen(false)}
                      className="text-foreground/60 hover:text-foreground transition-colors"
                      aria-label="Close menu"
                    >
                      <FiX className="h-5 w-5" />
                    </button>
                  </div>

                  <nav className="mt-6 flex-1 space-y-1 overflow-y-auto scrollbar-hover">
                    {NAV_ITEMS.map((item) => {
                      const active = pathname.startsWith(item.to);
                      const Icon = item.icon;
                      return (
                        <Link key={item.to} to={item.to}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 group ${
                            active
                              ? "text-primary-foreground glow"
                              : "text-foreground/60 hover:text-foreground hover:bg-accent/50"
                          }`}
                          style={active ? { background: "var(--gradient-primary)" } : undefined}
                        >
                          <Icon className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                            active ? "" : "group-hover:scale-110"
                          }`} />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </nav>

                  <nav className="mt-auto space-y-1 border-t border-border/20 pt-2">
                    <button onClick={onLogout} className="rounded-xl px-3 py-2 text-xs text-destructive hover:bg-destructive/10 w-full flex items-center gap-2 justify-start">
                      <FiLogOut className="h-4 w-4" /> Logout
                    </button>
                  </nav>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <main className="flex-1 min-w-0 pb-2 md:pb-2 mb-20 md:mb-0">
          <AnimatePresence mode="wait">
            <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile bottom navigation */}
        <div className="fixed bottom-0 left-0 right-0 md:hidden bg-gradient-to-t from-background via-background to-background/80 border-t border-border/50">
          <nav className="flex items-center justify-around px-1 py-2 safe-area-inset-bottom">
            {NAV_ITEMS.slice(0, 5).map((item) => {
              const active = pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all duration-200 ${
                    active
                      ? "text-primary"
                      : "text-foreground/60 hover:text-foreground"
                  }`}
                >
                  <Icon className={`h-5 w-5 mb-1 transition-transform ${active ? "scale-110" : ""}`} />
                  <span className="text-[10px] font-medium whitespace-nowrap">{item.label}</span>
                </Link>
              );
            })}
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="flex flex-col items-center justify-center py-2 px-3 rounded-lg text-foreground/60 hover:text-foreground transition-colors"
            >
              <FiMenu className="h-5 w-5 mb-1" />
              <span className="text-[10px] font-medium">More</span>
            </button>
          </nav>
        </div>
      </div>

      <CreateWorkspaceModal
        isOpen={showCreateWorkspace}
        onClose={() => setShowCreateWorkspace(false)}
        onCreated={(workspace) => {
          setCurrentWorkspace(workspace);
          info('Workspace created', `${workspace.name} is ready to use`);
        }}
      />
    </div>
  );
}
