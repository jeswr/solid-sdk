// AUTHORED-BY Claude Opus 5.5
/**
 * The bundled app's startup check (MOB-P3 E6). pod-auth needs a secure context, Web Crypto,
 * Web Locks and IndexedDB; a WebView without one of them shows the update screen instead.
 */
export type PlatformFeature = "secure-context" | "web-crypto" | "web-locks" | "indexeddb";

/** The globals the check reads; `globalThis` in the app, a plain object in tests. */
export interface StartupScope {
  isSecureContext?: boolean;
  crypto?: { subtle?: unknown };
  navigator?: { locks?: { request?: unknown } };
  indexedDB?: { open?: unknown };
}

/** The features this WebView lacks, in a fixed order; empty when the app can start. */
export function missingPlatformFeatures(scope: StartupScope): PlatformFeature[] {
  const missing: PlatformFeature[] = [];
  if (scope.isSecureContext !== true) missing.push("secure-context");
  if (typeof scope.crypto?.subtle !== "object" || scope.crypto.subtle === null)
    missing.push("web-crypto");
  if (typeof scope.navigator?.locks?.request !== "function") missing.push("web-locks");
  if (typeof scope.indexedDB?.open !== "function") missing.push("indexeddb");
  return missing;
}
