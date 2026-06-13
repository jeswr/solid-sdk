/**
 * Vitest global setup. Installs `fake-indexeddb` so the metadata store can run
 * fully headless (no browser). The Cache API + fetch are mocked per-test (see
 * `test/mocks.ts`) because they only need a tiny, deterministic surface.
 */
import 'fake-indexeddb/auto';
