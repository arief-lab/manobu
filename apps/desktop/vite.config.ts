import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackRouter({
      autoCodeSplitting: true,
      target: "react",
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3001,
    // TASK-116: dev-only fallback. With VITE_SERVER_URL unset the SPA calls
    // same-origin /rpc and /ws and this forwards them to a server booted with
    // BUN_PORT=3000. It is NOT on the normal dev path: apps/desktop/.env sets
    // VITE_SERVER_URL=http://localhost:4317 and apps/server/.env sets
    // BUN_PORT=4317 (the sidecar port), so the browser hits the server
    // cross-origin and CORS_ORIGIN carries it. Production (Tauri) never hits
    // the vite dev server.
    proxy: {
      "/rpc": {
        changeOrigin: true,
        target: "http://127.0.0.1:3000",
      },
      "/ws": {
        changeOrigin: true,
        target: "ws://127.0.0.1:3000",
        ws: true,
      },
    },
  },
});
