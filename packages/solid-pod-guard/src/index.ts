// AUTHORED-BY Claude Fable 5
/**
 * @jeswr/solid-pod-guard — the authenticated-caller boundary for server-side
 * Solid pod routes (SECURITY-CRITICAL, Node-only).
 *
 * Behavior-preserving extraction of a reviewed reference implementation:
 *   - {@link resolveAuthorizedPod} — the L2 bidirectional `pim:storage`
 *     binding (verbatim);
 *   - {@link createPodRouteGuard} — the L1–L2 fail-closed route pipeline
 *     (verbatim; app handlers removed);
 *   - {@link createServicePodFetch} — the L4 client-credentials service
 *     identity (verbatim).
 *
 * The L3 subject binding (`credentialSubject == webid`) stays a CONSUMER
 * obligation; the trust assumption (owner-only-writable
 * `<pod>profile/card`) is an OPERATOR requirement. Both are documented in
 * SKILL.md — read it before deploying this package.
 */

export { configFromEnv, type PodGuardConfig } from "./config.js";
export {
  type AuthenticatedPodCaller,
  createPodRouteGuard,
  type PodGuardOptions,
  type PodRouteGuard,
  type PodRouteHandler,
} from "./guard.js";
export { type OwnerBindingSeams, resolveAuthorizedPod } from "./owner.js";
export { PodAccessError } from "./pod.js";
export { createServicePodFetch, type ServicePodFetchOptions } from "./service.js";
