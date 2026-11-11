// AUTHORED-BY GPT-6.1 Sol
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Unit/component tests run in jsdom with a STUBBED fetch — no server (suite
// convention). E2E lives under e2e/ and runs via Playwright, not vitest.
export default defineConfig({
  plugins: [react()],
  // Component tests consume shared CSS; Next's PostCSS config is for the app build.
  css: { postcss: { plugins: [] } },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Lucide's Node entry is CJS, which bypasses Vite's React deduplication.
      "lucide-react": fileURLToPath(
        new URL(
          "../../packages/suite-ui/node_modules/lucide-react/dist/esm/lucide-react.mjs",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: "jsdom",
    maxWorkers: 2,
    globals: true,
    server: { deps: { inline: [/radix-ui/, /lucide-react/] } },
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
