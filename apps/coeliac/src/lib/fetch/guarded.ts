// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The foreign-origin fetch boundary. Every request to a THIRD-PARTY origin
 * (OpenFoodFacts, and later CTGov/EPMC/openFDA) goes through the
 * `@jeswr/guarded-fetch` browser policy — https-only, no-userinfo,
 * private/loopback/link-local/metadata-blocking, redirect re-validation, size
 * cap + timeout (DESIGN §1 / §9).
 *
 * The underlying fetch MUST be the credential-free **pristine** `publicFetch`
 * (captured before reactive-auth patches `globalThis.fetch`) so the user's
 * DPoP-bound token can never ride along to a foreign host. `credentials:"omit"`
 * is forced on every request as belt-and-braces.
 *
 * In the browser DNS-pinning is impossible (the browser owns DNS), so the
 * syntactic DNS-less posture IS the browser policy; `allowUnresolvedHosts` lets
 * the public host through the DNS-less branch (browsers do not fail-closed on a
 * public hostname). `null` `dnsLookup` forces that branch deterministically in
 * jsdom too, so tests never touch real DNS.
 */
import { createGuardedFetch } from "@jeswr/guarded-fetch";

/** Wrap a pristine credential-free fetch in the suite's browser SSRF policy. */
export function foreignFetch(base: typeof globalThis.fetch): typeof globalThis.fetch {
  const guarded = createGuardedFetch({
    fetch: base,
    dnsLookup: null,
    allowUnresolvedHosts: true,
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 12_000,
  });
  return (input, init) => guarded(input, { ...init, credentials: "omit" });
}
