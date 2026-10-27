// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Credentialed fetch boundaries: the data path stays under the driver base;
 * notification discovery may address any path on the pod origin. Both delegate
 * redirect refusal and input snapshots to the shared guard.
 */
import { assertWithinPodScope, refuseRedirects, snapshotFetchInput } from "@jeswr/guarded-fetch";
import { assertWithinBase } from "./keys.js";

/** @deprecated Use `RedirectRefusedError` from `@jeswr/guarded-fetch`. */
export { RedirectRefusedError as SolidRedirectError } from "@jeswr/guarded-fetch";

/** Validate the initial target against `base` and refuse all redirects. */
export function createScopedFetch(
  base: string,
  fetchImpl: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const refusing = refuseRedirects(fetchImpl);
  return async (input, init) => {
    // Main forwarded only the checked URL and explicit init, even for Request inputs.
    // Capture without applying init so validation cannot serialize an override body.
    const snapshot = snapshotFetchInput(input, undefined);
    assertWithinBase(base, snapshot.url);
    return refusing(snapshot.url, init);
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
    const snapshot = snapshotFetchInput(input, undefined);
    const target = new URL(snapshot.url);
    assertWithinPodScope(`${origin}/`, target.href);
    return refusing(snapshot.url, init);
  };
}
