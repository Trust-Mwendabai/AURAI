import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "@/contexts/ToastContext";
import { ToastContainer } from "@/components/Toast";
import "./styles.css";

const queryClient = new QueryClient();

const theme = localStorage.getItem("aurai_theme") || "dark";
document.documentElement.classList.toggle("dark", theme === "dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {/* HashRouter keeps deep links working from any htdocs subfolder without
            Apache rewrite rules. Swap for BrowserRouter if you serve the app
            from its own vhost root and add a rewrite to index.html. */}
        <HashRouter>
          <App />
        </HashRouter>
        <ToastContainer />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Register service worker for PWA support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((registration) => {
        console.log("Service Worker registered:", registration);
        // Check for updates periodically
        setInterval(() => {
          registration.update();
        }, 60000); // Check every minute
      })
      .catch((error) => {
        console.warn("Service Worker registration failed:", error);
      });
  });
}
