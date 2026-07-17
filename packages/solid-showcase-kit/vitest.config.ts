// AUTHORED-BY Claude Fable 5
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Default environment is node (branding/insignia suites); component suites opt into
// jsdom per-file via `// @vitest-environment jsdom`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
