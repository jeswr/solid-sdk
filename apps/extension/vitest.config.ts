import { defineConfig } from 'vitest/config';

// The security-critical, browser-shaped core modules (DPoP proof generation, the
// per-origin token boundary, the silent-restore decision wiring) are testable WITHOUT
// a packed extension or a real Solid server. Default to `node` so jose signs with
// Node's spec-complete webcrypto CryptoKey (jsdom's crypto.subtle is incomplete); a
// DOM-needing test opts into jsdom with a `// @vitest-environment jsdom` docblock. The
// chrome.* extension APIs are stubbed per-test; the e2e Playwright suite (against a
// LOCAL CSS) covers the integrated extension. See e2e/playwright.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    globals: false,
    coverage: {
      enabled: true,
      provider: 'v8',
      include: [
        'src/background/core/profile-store.ts',
        'src/background/core/origin-grant.ts',
        'src/background/core/formfill-data.ts',
        'src/content/formfill/*.ts',
        'src/shared/formfill-values.ts',
      ],
      reporter: ['text', 'json'],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
