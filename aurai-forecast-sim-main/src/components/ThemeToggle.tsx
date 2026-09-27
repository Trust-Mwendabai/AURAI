// @ts-nocheck
import { useEffect, useState } from "react";
import { FiSun, FiMoon } from "react-icons/fi";
import { getTheme, setTheme } from "@/lib/settings";

export function ThemeToggle() {
  const [theme, setT] = useState("dark");
  useEffect(() => { const t = getTheme(); setT(t); setTheme(t); }, []);
  const toggle = () => { const n = theme === "dark" ? "light" : "dark"; setT(n); setTheme(n); };
  return (
    <button onClick={toggle} className="glass rounded-full p-2.5 hover:glow transition-all" aria-label="Toggle theme">
      {theme === "dark" ? <FiSun className="h-4 w-4" /> : <FiMoon className="h-4 w-4" />}
    </button>
  );
}
