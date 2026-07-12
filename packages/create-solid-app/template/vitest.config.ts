import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The data layer is environment-agnostic (fetch injected), so the default
    // node environment is enough — no jsdom needed for these unit tests.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
