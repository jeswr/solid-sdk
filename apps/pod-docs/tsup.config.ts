import { defineConfig } from "tsup";

// Library build: ESM only (the suite is pure ESM), with .d.ts, tree-shaken.
// The data layer is the only entry; the Next.js UI / create-solid-app scaffold
// is a deliberate follow-up and lives in its own package.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "node20",
});
