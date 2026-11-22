// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import { DataFactory } from "n3";
import { loadMeasurements } from "@/apps/health/lib/data/metrics";
import { createHealthDataStore as createStore } from "@/apps/health/lib/data/store";
import { HealthDocument } from "@/apps/health/lib/model";
import type { PodSession } from "@/lib/session/pod-session";

export function readHealthMeasurements(
  session: PodSession,
  range: { start: Date; end: Date },
  signal?: AbortSignal,
) {
  return loadMeasurements(
    createHealthDataStore(session.fetch, session.storageUrl, session.webId, signal),
    range,
  );
}

export function createHealthDataStore(
  fetch: typeof globalThis.fetch,
  root: string,
  owner: string,
  signal?: AbortSignal,
) {
  const store = createStore(fetch, root, owner);
  const scoped = createPodScopedFetch(store.base, { fetch: refuseRedirects(fetch) });
  return {
    ...store,
    async read(path: string) {
      const { dataset, etag, url } = await fetchRdf(assertWithinPodScope(store.base, path), {
        fetch: scoped,
        ...(signal && { signal }),
      });
      return { document: new HealthDocument(dataset, DataFactory), etag, url };
    },
  };
}
// Demo-only bridges: remove together when the observation store moves to the SDK.
export { ensureSample as seedHealth } from "@/apps/health/demo/sample";
export { writeSamples } from "@/apps/health/lib/data/import";
export { loadMeasurements } from "@/apps/health/lib/data/metrics";
export type { Measurement } from "@/apps/health/lib/model";
