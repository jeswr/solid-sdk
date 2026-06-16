// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vite config for the Pod Mail static host shell. It bundles the LOCAL
// `@jeswr/pod-mail/ui` React source directly (no pre-built dist/ui needed —
// Vite/esbuild compile the TS source on the fly), wraps it in a standalone Solid
// login, and emits a fully static `dist/` (index.html + clientid.jsonld +
// callback.html + hashed assets) servable by any file server (Caddy file_server).
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Resolve the @jeswr/pod-mail library to its LOCAL TypeScript SOURCE, so Vite
// compiles `../src/ui` (and the data-layer core) directly — no pre-built dist/ui
// is needed, and the host always tracks the library's current source. The source
// uses NodeNext-style `.js` extension imports (e.g. `./store.js`); Vite's
// resolver maps those to the sibling `.ts` files when bundling.
const podMailSrc = (rel: string) =>
  fileURLToPath(new URL(`../src/${rel}`, import.meta.url));

// The library SOURCE lives OUTSIDE web/ (in ../src), so when Rollup bundles it,
// its bare imports (@jeswr/fetch-rdf, @solid/object, n3, …) would resolve against
// ../src's nearest node_modules — which doesn't exist. Pin those runtime deps to
// THIS host's node_modules so the out-of-root source resolves them.
const hostModule = (pkg: string) =>
  fileURLToPath(new URL(`./node_modules/${pkg}`, import.meta.url));

export default defineConfig({
  // tailwindcss() compiles the `@import "tailwindcss"` + the app-shell `@theme`
  // mapping in src/styles.css; react() compiles JSX (host + bundled library).
  plugins: [tailwindcss(), react()],
  resolve: {
    // Order matters: the more specific "/ui" subpath alias must precede the
    // bare-package alias so it is matched first. The trailing-slash forms pin the
    // library's runtime deps (imported from the out-of-root source) to web/.
    alias: [
      { find: "@jeswr/pod-mail/ui", replacement: podMailSrc("ui/index.ts") },
      { find: "@jeswr/pod-mail", replacement: podMailSrc("index.ts") },
      { find: "@jeswr/fetch-rdf", replacement: hostModule("@jeswr/fetch-rdf") },
      { find: "@solid/object", replacement: hostModule("@solid/object") },
      { find: "@rdfjs/wrapper", replacement: hostModule("@rdfjs/wrapper") },
      { find: "n3", replacement: hostModule("n3") },
      // The library declares React as an OPTIONAL peer dep; bundling its source
      // from out-of-root, Vite would otherwise stub React out. Pin react/react-dom
      // (and their subpaths, e.g. react/jsx-runtime) to the host's single copy.
      { find: /^react$/, replacement: hostModule("react") },
      { find: /^react\//, replacement: `${hostModule("react")}/` },
      { find: /^react-dom$/, replacement: hostModule("react-dom") },
      { find: /^react-dom\//, replacement: `${hostModule("react-dom")}/` },
    ],
    // Guarantee a single React instance across the host + the bundled library +
    // the @jeswr/app-shell package. app-shell is a SYMLINKED file: dep, so Vite
    // resolves its deps against the package's own realpath node_modules by
    // default — which would pull a SECOND copy of react/react-dom (invalid-hook-
    // call) and of Radix/lucide. Deduping these forces ONE copy from the host's
    // node_modules (where they are installed as direct deps), regardless of the
    // symlink. react/react-dom are also alias-pinned above for the bundled library.
    dedupe: [
      "react",
      "react-dom",
      "@radix-ui/react-avatar",
      "@radix-ui/react-dropdown-menu",
      "lucide-react",
    ],
  },
  // Let Vite read the library source one directory up from the host root, AND
  // the @jeswr/app-shell package (a symlinked file: dep whose realpath lives
  // outside this repo tree — the dev server must be allowed to serve it).
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL("..", import.meta.url)),
        fileURLToPath(new URL("./node_modules/@jeswr/app-shell", import.meta.url)),
      ],
    },
  },
  // `base: "./"` makes the built asset URLs relative, so the static bundle works
  // when served from a domain root (the per-subdomain deploy) without rewriting.
  base: "./",
  build: {
    outDir: "dist",
    // Surface oversized bundles in CI without failing the build.
    chunkSizeWarningLimit: 1500,
  },
});
