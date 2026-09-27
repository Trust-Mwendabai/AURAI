import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  // Relative asset paths so the built app works from any subfolder under
  // htdocs (e.g. /Aurai/aurai-forecast-sim-main/dist) without a rebuild.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    // The dev server is a different origin from Apache, so /api requests would
    // 404 here. Forward them to the PHP backend instead, which means `npm run
    // dev` needs no .env. Override the target with VITE_API_PROXY if Apache
    // serves the project from a different path or port.
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY || "http://localhost",
        changeOrigin: true,
        rewrite: (p) =>
          process.env.VITE_API_PROXY ? p : p.replace(/^\/api/, "/Aurai/aurai-forecast-sim-main/api"),
      },
    },
  },
});
