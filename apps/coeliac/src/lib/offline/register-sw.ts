// AUTHORED-BY Claude Fable 5
/**
 * Guarded service-worker registration for the app-shell offline layer
 * (BUILD-PLAN Brief 4B). Kept free of React and browser-only top-level access so
 * it is unit-testable with an injected `navigator`-like surface — no real
 * browser, no server (the suite unit-test convention).
 *
 * The worker itself (`public/sw.js`) is shell-only and never caches private pod
 * data; this module only decides WHETHER to register it, fail-closed on every
 * unsupported / disabled / errored path (a broken registration must never break
 * the app — the app works fully without the worker).
 */

import { SHELL_CACHE_PREFIX } from "./shell-manifest";

/** The stable, root-scoped worker URL (served from `public/`). */
export const SERVICE_WORKER_URL = "/sw.js";

/** Message a controlling worker understands (see `public/sw.js`). */
export type ServiceWorkerCommand = { type: "purge-shell" };

/** The minimal `ServiceWorkerContainer` surface we depend on (testable). */
export interface ServiceWorkerContainerLike {
  register(
    url: string,
    options?: { scope?: string; updateViaCache?: "none" | "imports" | "all" },
  ): Promise<unknown>;
  getRegistrations?(): Promise<ReadonlyArray<{ unregister(): Promise<boolean> }>>;
  readonly controller?: { postMessage(message: unknown): void } | null;
}

/** The minimal `Navigator` surface (so tests inject a fake instead of a DOM). */
export interface NavigatorLike {
  serviceWorker?: ServiceWorkerContainerLike;
}

export interface RegisterOptions {
  /** Injected navigator (defaults to the global one in the browser). */
  navigator?: NavigatorLike;
  /** Force-disable registration (e.g. a kill-switch / test / dev opt-out). */
  disabled?: boolean;
}

/** Resolve the navigator to use, tolerating non-browser environments. */
function resolveNavigator(explicit?: NavigatorLike): NavigatorLike | undefined {
  if (explicit) return explicit;
  if (typeof navigator === "undefined") return undefined;
  return navigator as NavigatorLike;
}

/**
 * Register the app-shell service worker. Returns the registration on success, or
 * `null` when unsupported/disabled/errored — NEVER throws, so a caller can fire
 * it unconditionally on mount.
 */
export async function registerServiceWorker(
  options: RegisterOptions = {},
): Promise<unknown | null> {
  if (options.disabled) return null;
  const nav = resolveNavigator(options.navigator);
  const container = nav?.serviceWorker;
  if (!container || typeof container.register !== "function") return null;
  try {
    // `updateViaCache: "none"` makes the browser always revalidate the worker
    // script itself, so a new shell version ships promptly.
    return await container.register(SERVICE_WORKER_URL, {
      scope: "/",
      updateViaCache: "none",
    });
  } catch {
    return null;
  }
}

/**
 * Unregister every service worker for this origin. Fail-safe (never throws);
 * used as an escape hatch if the offline layer ever needs to be disabled.
 */
export async function unregisterServiceWorkers(
  options: RegisterOptions = {},
): Promise<void> {
  const nav = resolveNavigator(options.navigator);
  const container = nav?.serviceWorker;
  if (!container || typeof container.getRegistrations !== "function") return;
  try {
    const registrations = await container.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister().catch(() => false)));
  } catch {
    // best-effort
  }
}

/**
 * Ask the controlling worker to drop its shell cache (defence-in-depth on
 * sign-out; the shell holds only public assets). No-op when uncontrolled.
 */
export function purgeShellCache(options: RegisterOptions = {}): void {
  const nav = resolveNavigator(options.navigator);
  const controller = nav?.serviceWorker?.controller;
  if (!controller) return;
  try {
    const command: ServiceWorkerCommand = { type: "purge-shell" };
    controller.postMessage(command);
  } catch {
    // best-effort
  }
}

/** The minimal `CacheStorage` surface used to delete the shell caches (testable). */
export interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/** Resolve the CacheStorage to use, tolerating non-browser environments. */
function resolveCaches(explicit?: CacheStorageLike): CacheStorageLike | undefined {
  if (explicit) return explicit;
  if (typeof caches === "undefined") return undefined;
  return caches as CacheStorageLike;
}

/**
 * Delete every generation of the shell cache directly from the page (does not
 * need a controlling worker). Fail-safe. Used to clean up after a worker is
 * unregistered (e.g. in dev, where the SW must NOT run).
 */
export async function deleteShellCaches(
  options: { caches?: CacheStorageLike } = {},
): Promise<void> {
  const cs = resolveCaches(options.caches);
  if (!cs) return;
  try {
    const names = await cs.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(SHELL_CACHE_PREFIX))
        .map((name) => cs.delete(name).catch(() => false)),
    );
  } catch {
    // best-effort
  }
}

export interface PolicyOptions extends RegisterOptions {
  /** Injected CacheStorage (defaults to the global one in the browser). */
  caches?: CacheStorageLike;
  /**
   * Whether this is a production build. Defaults to
   * `process.env.NODE_ENV === "production"`. In dev the worker must NOT run — it
   * would cache Next dev route documents + `/_next` chunks and cause stale
   * chunks / hydration mismatches across reloads.
   */
  production?: boolean;
}

/**
 * Apply the service-worker policy for the current environment:
 *  - production → register the app-shell worker (unchanged behaviour);
 *  - non-production → do NOT register, and actively clean up any worker + shell
 *    caches a previous production/localhost session may have left behind, so a
 *    developer isn't stuck with a stale SW.
 * Fail-safe throughout; returns the registration in production, else `null`.
 */
export async function applyServiceWorkerPolicy(
  options: PolicyOptions = {},
): Promise<unknown | null> {
  const production = options.production ?? process.env.NODE_ENV === "production";
  if (!production) {
    await unregisterServiceWorkers(options);
    await deleteShellCaches(options);
    return null;
  }
  return registerServiceWorker(options);
}
