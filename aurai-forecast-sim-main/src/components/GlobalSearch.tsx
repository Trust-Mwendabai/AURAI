// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiSearch, FiDatabase, FiTrendingUp, FiFileText, FiX } from "react-icons/fi";
import { listDatasets, listPredictions, listReports } from "@/lib/db";

/**
 * Searches the things the user actually has — datasets, forecasts and reports —
 * and navigates to whichever they pick.
 *
 * The three lists are small and are fetched once on first use, then filtered in
 * memory: a request per keystroke would be far more traffic for no benefit at
 * this size. They are refetched whenever the box is reopened, so newly created
 * items appear.
 */
const GROUPS = [
  { key: "dataset", label: "Datasets", icon: FiDatabase, route: "/dataset" },
  { key: "prediction", label: "Forecasts", icon: FiTrendingUp, route: "/predictions" },
  { key: "report", label: "Reports", icon: FiFileText, route: "/reports" },
];

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const [datasets, predictions, reports] = await Promise.all([
        listDatasets(), listPredictions(), listReports(),
      ]);
      setItems([
        ...datasets.map((d) => ({ type: "dataset", id: d.id, label: d.name, hint: `${d.rowCount ?? 0} rows` })),
        ...predictions.map((p) => ({
          type: "prediction", id: p.id, label: p.name,
          hint: p.accuracy != null ? `${p.accuracy}% accuracy` : p.algorithm || "",
        })),
        ...reports.map((r) => ({ type: "report", id: r.id, label: r.title, hint: r.excerpt?.slice(0, 60) || "" })),
      ]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // ⌘K / Ctrl+K focuses the box, which is what the hint beside it promises.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close when focus or a click moves elsewhere.
  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => i.label?.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, query]);

  useEffect(() => { setActive(0); }, [query]);

  const go = (item) => {
    const group = GROUPS.find((g) => g.key === item.type);
    if (!group) return;
    setOpen(false);
    setQuery("");
    navigate(group.route);
  };

  const onKeyDown = (e) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
  };

  return (
    <div ref={boxRef} className="relative flex-1 max-w-xl">
      <div className="flex items-center gap-2">
        <FiSearch className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); load(); }}
          onKeyDown={onKeyDown}
          className="bg-transparent outline-none text-sm flex-1 min-w-0 placeholder:text-muted-foreground"
          placeholder="Search datasets, forecasts, reports…"
          aria-label="Search"
          role="combobox"
          aria-expanded={open && !!query}
        />
        {query ? (
          <button onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Clear search">
            <FiX className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0">⌘K</kbd>
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
          {loading && <div className="px-3 py-3 text-xs text-muted-foreground">Searching…</div>}

          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              Nothing matches “{query}”.
            </div>
          )}

          {!loading && results.map((item, i) => {
            const group = GROUPS.find((g) => g.key === item.type);
            const Icon = group?.icon ?? FiSearch;
            return (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => go(item)}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 ${i === active ? "bg-accent/50" : "hover:bg-accent/30"}`}
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{item.label}</span>
                  {item.hint && <span className="block text-[11px] text-muted-foreground truncate">{item.hint}</span>}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">{group?.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
