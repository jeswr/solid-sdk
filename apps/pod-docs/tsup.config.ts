import { defineConfig } from "tsup";

// Library build: ESM only (the suite is pure ESM), with .d.ts, tree-shaken.
//
// Two entries → two exports:
//   - `.`     the React-free data-layer core (src/index.ts)
//   - `./ui`  the OPTIONAL React view layer (src/ui/index.ts), built as a
//             separate chunk so a data-layer-only consumer never pulls it in.
//             React stays `external` (a peer dependency) — it is the host app's,
//             never bundled here.
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
