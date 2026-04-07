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
  const backendPort = resolveBackendPort();
  const backendUrl = `http://localhost:${backendPort}`;

  return {
    server: {
      host: "::",
      port: 8080,
      strictPort: false,
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: true,
        },
        "/health": {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    define: {
      // Make the backend URL available at build time for dev mode.
      // In production (make run), the frontend is served from the backend
      // itself so same-origin works automatically.
      ...(command === "serve" && !process.env.VITE_API_URL
        ? { "import.meta.env.VITE_API_URL": JSON.stringify(backendUrl) }
        : {}),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
