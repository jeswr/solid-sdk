// AUTHORED-BY Codex GPT-6
import {
  createGuardedFetch,
  type GuardOptions,
  type guardedFetch,
  refuseRedirects,
} from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { ALLOWED_ORIGINS, CALL_TIMEOUT_MS, MAX_BODY, type Transport } from "./providers.js";
import { HelperError } from "./store.js";

/** Trusted test seams; production always uses the Node DNS-pinning transport. */
export interface ProviderTransportOptions {
  readonly transport?: typeof guardedFetch;
  readonly dnsLookup?: GuardOptions["dnsLookup"];
}

/** Official provider origins only, public pinned DNS, bounded bodies/time, and no redirects. */
export function createProviderTransport(options: ProviderTransportOptions = {}): Transport {
  const limits = {
    allowLoopback: false,
    maxRedirects: 0,
    maxBytes: MAX_BODY,
    timeoutMs: CALL_TIMEOUT_MS,
  };
  const transport = options.transport ?? createNodeGuardedFetch(limits);
  const guarded = createGuardedFetch({
    ...limits,
    pinningFetch: refuseRedirects(transport),
    requireDnsPinning: true,
    dnsLookup: options.dnsLookup,
  });
  const allowed = new Set(ALLOWED_ORIGINS);
  return async (url, init) => {
    let target: URL;
    try {
      target = new URL(url);
      if (target.username || target.password || target.hash || !allowed.has(target.origin))
        throw new Error("invalid provider URL");
    } catch {
      throw new HelperError("refused", "not an allowed provider URL");
    }
    try {
      return await guarded(target, { ...init, redirect: "manual" });
    } catch {
      // Guard/transport errors can carry URLs, headers or provider-controlled Location values.
      throw new HelperError("unavailable", "provider request failed");
    }
  };
}
