import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

/**
 * Read the backend port from backend/.backend_port (written by the CLI
 * when it finds an available port). Falls back to 8000 if the file
 * doesn't exist (backend hasn't started yet or was started manually).
 */
function resolveBackendPort(): number {
  const portFile = path.resolve(__dirname, "backend/.backend_port");
  try {
    const raw = fs.readFileSync(portFile, "utf-8").trim();
    const port = parseInt(raw, 10);
    if (!isNaN(port) && port > 0) return port;
  } catch {
    // file doesn't exist yet — use default
  }
  return 8000;
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  // Backend URL is resolved DYNAMICALLY per request via the `router`
  // hook below. We deliberately don't snapshot the port at config-load
  // time anymore — if the backend restarts on a different port the
  // proxy automatically follows without a Vite reload.
  const dynamicBackendUrl = (): string =>
    `http://localhost:${resolveBackendPort()}`;

  return {
    server: {
      host: "::",
      // Default to 5173 (Vite's own default) instead of 8080. Port 8080 is
      // notoriously contested — Firebase Firestore emulator, Tomcat, Jenkins,
      // most local Java apps default there — and Vite's silent fallback to
      // a free port left users hitting whatever service was actually on 8080
      // and seeing a stale "Ok" response or worse. `strictPort: true` makes
      // a port collision fail loudly so the developer notices.
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          // Placeholder; real target comes from `router` below.
          target: "http://localhost:8000",
          changeOrigin: true,
          router: dynamicBackendUrl,
        },
        "/health": {
          target: "http://localhost:8000",
          changeOrigin: true,
          router: dynamicBackendUrl,
        },
      },
    },
    plugins: [react()],
    define: {
      // We deliberately do NOT bake `VITE_API_URL` in dev mode. The previous
      // version snapshotted the backend port at Vite-server startup and
      // baked `http://localhost:<port>` into every fetch URL — when the
      // backend later moved to a different port (CLI fallback when 8000 was
      // busy, or a stale `.backend_port` written by a side process) the
      // frontend kept hitting the dead port and broke with CORS / network
      // errors that were really stale-bake errors.
      //
      // In dev, the proxy at `server.proxy["/api"]` (above) forwards every
      // `/api/*` request to whatever port the backend is on right now.
      // `getApiUrl()` falls back to `window.location.origin` when
      // `VITE_API_URL` is undefined, so relative URLs work transparently.
      //
      // In production (`make run`) the static `dist/` is served by FastAPI
      // itself, so same-origin works without any env var.
      //
      // The escape hatch is still respected: if a developer exports
      // `VITE_API_URL=...` themselves before running `npm run dev`, Vite
      // will pick it up from `process.env` automatically.
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
