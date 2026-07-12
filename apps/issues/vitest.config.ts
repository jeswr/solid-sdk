import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit/integration tests for the data layer (src/lib) + the app route handlers
// (e.g. src/app/clientid.jsonld/route.ts). Playwright e2e lives in e2e/*.spec.ts
// and is run separately via `npm run test:e2e` — excluded here.
export default defineConfig({
  // Mirror the tsconfig `@/* → ./src/*` path alias so tests can import app code
  // exactly as the app does (e.g. the clientid route's `@/lib/app-origin`).
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // `.test.ts` is the data-layer/route default (node env); `.test.tsx` covers
    // React component tests, which opt into jsdom via a per-file
    // `// @vitest-environment jsdom` pragma (keeps the rest fast in node).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**"],
    environment: "node",
    passWithNoTests: true,
  },
});
