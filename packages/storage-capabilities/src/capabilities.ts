// AUTHORED-BY Claude Opus 5.5
import { CapabilitiesError } from "./errors.js";
import { deriveFeatures } from "./features.js";
import { probe } from "./probe.js";
import { defaultCache, resolveStorageDescription } from "./resolve.js";
import type { Features, ResolveOptions } from "./types.js";

/**
 * Resolve the storage of `url`, probe a Solid root only when the description leaves
 * `accessControl` or `patch` unknown, and derive the features. The probe is cached with the
 * description, so a fresh hit needs no network. LWS storages are never probed.
 * A failed probe is not fatal: the affected features stay `unknown` and the next call retries.
 * @throws {CapabilitiesError} When the description itself cannot be resolved.
 */
export async function capabilities(url: string, options: ResolveOptions): Promise<Features> {
  const cache = options.cache ?? defaultCache;
  const description = await resolveStorageDescription(url, { ...options, cache });
  const cached = await cache.get(description.id);
  const known = cached?.probe;
  const features = deriveFeatures(description, known);
  if (
    description.protocol !== "solid" ||
    known !== undefined ||
    (features.accessControl.state !== "unknown" && features.patch.state !== "unknown")
  ) {
    return features;
  }
  let result: Awaited<ReturnType<typeof probe>>;
  try {
    result = await probe(description.root, options.fetch, {
      signal: options.signal,
      now: options.now,
    });
  } catch (error) {
    if (options.signal?.aborted || !(error instanceof CapabilitiesError)) throw error;
    return features;
  }
  // Only attach the probe to the same cache generation: if the record was deleted (logout,
  // invalidation) or replaced while the probe was in flight, do not resurrect or overwrite it.
  // A cache without the atomic attachProbe() is never written: the probe is simply repeated.
  await cache.attachProbe?.(description.id, description, result);
  return deriveFeatures(description, result);
}
