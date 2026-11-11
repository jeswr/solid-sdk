// AUTHORED-BY Codex GPT-6
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";

const testTransports = new WeakSet<typeof fetch>();

export function isTestOutboundFetch(fetch: typeof globalThis.fetch): boolean {
  return testTransports.has(fetch);
}

/** DNS-pinned, credential-free transport. Only a test harness may enable loopback. */
export function createRelayOutboundFetch(options: { allowLoopbackForTests?: boolean } = {}) {
  const guarded = createNodeGuardedFetch({
    maxBytes: 262_144,
    timeoutMs: 5_000,
    maxRedirects: 3,
    allowLoopback: options.allowLoopbackForTests === true,
  });
  if (options.allowLoopbackForTests === true) testTransports.add(guarded);
  return guarded;
}
