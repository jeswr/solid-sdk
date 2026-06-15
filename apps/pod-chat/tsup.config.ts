import { defineConfig } from "tsup";

// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// Library build: ESM only (the suite is pure ESM), with .d.ts, tree-shaken.
//
// Two entries:
//   - `src/index.ts`     — the React-free data layer (the `.` export).
//   - `src/ui/index.ts`  — the OPTIONAL React view (the `./ui` export). React +
//     react-dom are *peer* dependencies and are EXTERNALIZED here so they are
//     never bundled into `dist/ui/` — the host app supplies its single React
//     copy (bundling a second one would break hooks). `react/jsx-runtime` is
//     externalized too (the automatic JSX runtime the .tsx emits import from).
//
// The full Next.js UI / create-solid-app scaffold remains a deliberate follow-up
// and lives in its own package; this `./ui` surface is the framework-agnostic
// view component it (or any React app) drops in.
export default defineConfig({
  entry: ["src/index.ts", "src/ui/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "node20",
  external: ["react", "react-dom", "react/jsx-runtime"],
});
