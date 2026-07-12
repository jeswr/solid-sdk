// AUTHORED-BY Claude Fable 5
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Core tests run in node (oauth4webapi + dpop need same-realm WebCrypto /
    // fetch primitives; jsdom's cross-realm typed arrays break them). The React
    // test opts into jsdom per-file via `// @vitest-environment jsdom`.
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
