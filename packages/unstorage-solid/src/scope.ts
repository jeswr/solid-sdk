// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Credentialed fetch boundaries: the data path stays under the driver base;
 * notification discovery may address any path on the pod origin. Both delegate
 * redirect refusal to the shared guard and preserve the original Request input.
 */
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { assertWithinBase } from "./keys.js";

/** @deprecated Use `RedirectRefusedError` from `@jeswr/guarded-fetch`. */
export { RedirectRefusedError as SolidRedirectError } from "@jeswr/guarded-fetch";

/** Read the target for scope validation; forward the original input to fetch. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Validate the initial target against `base` and refuse all redirects. */
export function createScopedFetch(
  base: string,
  fetchImpl: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const refusing = refuseRedirects(fetchImpl);
  return async (input, init) => {
    const url = urlOf(input);
    assertWithinBase(base, url);
    // URL objects are mutable: forward the checked snapshot so a caller cannot
    // retarget an authenticated fetch while it awaits a token. Requests retain
    // their body and policy fields and have an immutable internal URL.
    return refusing(input instanceof URL ? url : input, init);
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
    const url = urlOf(input);
    const target = new URL(url);
    assertWithinPodScope(`${origin}/`, target.href);
    return refusing(input instanceof URL ? url : input, init);
  };
}
