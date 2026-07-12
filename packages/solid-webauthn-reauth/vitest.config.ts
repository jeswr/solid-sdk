import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure unit tests — no server, no network, no ports. The WebAuthn ceremony
    // (`navigator.credentials.*`), `fetch`, and `PublicKeyCredential` are stubbed
    // per-test via `vi.stubGlobal`, so the suite runs in the default Node env,
    // fast and parallel-safe.
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 20_000,
  },
});
