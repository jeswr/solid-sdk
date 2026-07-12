import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      // Worker + page-client wiring depends on real ServiceWorker / page globals
      // that cannot be exercised headlessly; the decision logic they call is fully
      // covered. See README "Verified vs assumed".
      exclude: ['src/worker.ts', 'src/index.ts', 'src/types.ts'],
    },
  },
});
