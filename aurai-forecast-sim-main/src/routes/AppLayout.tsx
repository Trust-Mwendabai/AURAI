// @ts-nocheck
import { Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { refreshSession } from "@/lib/auth";

export default function AppLayout() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    refreshSession().then((user) => {
      if (!mounted) return;
      if (!user) navigate("/login", { replace: true });
      else setReady(true);
    });
    return () => { mounted = false; };
  }, []);

  if (!ready) return null;
  return <AppShell><Outlet /></AppShell>;
}
