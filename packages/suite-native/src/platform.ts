// AUTHORED-BY Claude Opus 5.5

/** The subset of the injected `window.Capacitor` global this package reads. */
export interface CapacitorRuntime {
  isNativePlatform(): boolean;
  getPlatform(): string;
}

export type Platform = "ios" | "android" | "web";

function runtime(): CapacitorRuntime | undefined {
  const candidate = (globalThis as { Capacitor?: Partial<CapacitorRuntime> }).Capacitor;
  if (typeof candidate?.isNativePlatform !== "function") return undefined;
  if (typeof candidate.getPlatform !== "function") return undefined;
  return candidate as CapacitorRuntime;
}

/**
 * Where the suite is running. Reads the `Capacitor` global the native shell injects, so web bundles
 * need no Capacitor import; pass `cap` in tests.
 */
export function platform(cap: CapacitorRuntime | undefined = runtime()): Platform {
  if (!cap?.isNativePlatform()) return "web";
  const name = cap.getPlatform();
  return name === "ios" || name === "android" ? name : "web";
}

/** True inside the iOS or Android app shell. */
export function isNativeApp(cap?: CapacitorRuntime): boolean {
  return platform(cap) !== "web";
}
