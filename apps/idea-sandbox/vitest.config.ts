// AUTHORED-BY Claude Opus 5.5
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", include: ["test/**/*.test.tsx"], testTimeout: 30_000 },
});
