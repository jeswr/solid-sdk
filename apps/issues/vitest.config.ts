import { defineConfig } from "vitest/config";

// Unit/integration tests for the data layer (src/lib). Playwright e2e lives in
// e2e/*.spec.ts and is run separately via `npm run test:e2e` — excluded here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    environment: "node",
    passWithNoTests: true,
  },
});
