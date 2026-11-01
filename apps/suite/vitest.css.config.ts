import { defineConfig } from "vitest/config";

// Explicit integration gate; run against a disposable, writable CSS root.
export default defineConfig({
  test: { environment: "node", include: ["test/tasks/css.integration.ts"] },
});
