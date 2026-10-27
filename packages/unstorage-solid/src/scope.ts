// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Credentialed fetch boundaries: the data path stays under the driver base;
 * notification discovery may address any path on the pod origin. Both delegate
 * redirect refusal to the shared guard and validate an owned native Request snapshot.
 */
import { assertWithinPodScope, refuseRedirects, snapshotRequest } from "@jeswr/guarded-fetch";
import { assertWithinBase } from "./keys.js";

/** @deprecated Use `RedirectRefusedError` from `@jeswr/guarded-fetch`. */
export { RedirectRefusedError as SolidRedirectError } from "@jeswr/guarded-fetch";

/** Preserve native policy and body slots without trusting shadowed Request properties. */
function snapshotInput(input: RequestInfo | URL, init?: RequestInit): string | Request {
  if (typeof input === "string" || input instanceof URL) return String(input);
  return snapshotRequest(input, init);
}

/** Validate the initial target against `base` and refuse all redirects. */
export function createScopedFetch(
  base: string,
  fetchImpl: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const refusing = refuseRedirects(fetchImpl);
  return async (input, init) => {
    const snapshot = snapshotInput(input, init);
    const url = typeof snapshot === "string" ? snapshot : snapshot.url;
    assertWithinBase(base, url);
    return typeof snapshot === "string" ? refusing(new URL(url).href, init) : refusing(snapshot);
  };
}

/**
 * Notification discovery may leave the base path, but never the pod origin.
 * Using the origin root as scope allows storage descriptions and subscription
 * endpoints while applying the same audited credential and URL checks.
 */
export function createSameOriginRedirectRefusingFetch(
  origin: string,
  fetchImpl: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const refusing = refuseRedirects(fetchImpl);
  return async (input, init) => {
    // Preserve the old absolute-target contract before the shared relative resolver.
    const snapshot = snapshotInput(input, init);
    const url = typeof snapshot === "string" ? snapshot : snapshot.url;
    const target = new URL(url);
    const checked = assertWithinPodScope(`${origin}/`, target.href);
    return typeof snapshot === "string" ? refusing(checked, init) : refusing(snapshot);
  };
}
