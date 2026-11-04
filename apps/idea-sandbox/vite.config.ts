// AUTHORED-BY Claude Opus 5.5
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function basePath(value = "/"): string {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value))
    throw new Error("APP_BASE_PATH must be an absolute path with a trailing slash.");
  return value;
}

export default defineConfig(() => ({
  // scripts/build-pages.mjs passes the Pages base as CLIENT_BASE_PATH (and --base).
  base: basePath(process.env.CLIENT_BASE_PATH || process.env.APP_BASE_PATH),
  plugins: [react()],
  // QuickJS loads its WebAssembly file relative to its own module; keep it out of pre-bundling.
  optimizeDeps: { exclude: ["@jitl/quickjs-wasmfile-release-sync", "quickjs-emscripten-core"] },
  build: { target: "es2023" },
}));
