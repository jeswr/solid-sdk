// AUTHORED-BY Codex GPT-6
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["src/eval/**/*.test.ts"], environment: "node" } });
