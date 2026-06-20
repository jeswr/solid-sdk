// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vite config for the Solid App Store static SPA. Unlike the pod-apps, the store
// bundles NO out-of-root data-layer library — it is a self-contained SPA whose data is
// the committed web/data/apps.json (+ the generated catalog). So this config is the
// pod-app recipe MINUS the library aliasing: the app-shell single-React dedupe (to
// avoid a nested 2nd React → invalid-hook-call), the tailwind plugin, and the
// `__APP_VERSION__` define for the header FeedbackButton's diagnostics.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// BUILD VERSION for the header FeedbackButton diagnostics. Prefer the short git SHA
// (so a filed issue pins the exact deployed commit); fall back to the package version
// when git is unavailable (a tarball build). Resolved at config-eval time + injected
// via `define` as a string literal. `git` failures are swallowed — diagnostic-only.
const buildVersion = (() => {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.env.npm_package_version ?? "dev";
  }
})();

export default defineConfig({
  // tailwindcss() compiles `@import "tailwindcss"` + the app-shell `@theme` mapping in
  // src/styles.css; react() compiles JSX.
  plugins: [tailwindcss(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
  },
  resolve: {
    // Guarantee a SINGLE React instance across the host + @jeswr/app-shell +
    // @jeswr/solid-elements. A published package can resolve react/react-dom + Radix/
    // lucide/lit against its OWN nested node_modules, pulling a SECOND copy
    // (invalid-hook-call / two Lit runtimes). Deduping forces ONE copy from the host's
    // node_modules (where they are installed as direct deps).
    dedupe: [
      "react",
      "react-dom",
      "@radix-ui/react-avatar",
      "@radix-ui/react-dropdown-menu",
      "lucide-react",
      "lit",
      "@lit/react",
    ],
  },
  // `base: "./"` makes the built asset URLs relative, so the static bundle works when
  // served from a domain root (the per-subdomain deploy) without rewriting.
  base: "./",
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1500,
  },
});
