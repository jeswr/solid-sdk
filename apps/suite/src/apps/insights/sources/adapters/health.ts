// AUTHORED-BY Codex (GPT-6.1 Sol)
import { loadMeasurements } from "@/apps/health/lib/data/metrics";
import { createHealthDataStore } from "@/apps/health/lib/data/store";
import type { PodSession } from "@/lib/session/pod-session";

export function readHealthMeasurements(session: PodSession, range: { start: Date; end: Date }) {
  return loadMeasurements(
    createHealthDataStore(session.fetch, session.storageUrl, session.webId),
    range,
  );
}
// Demo-only bridges: remove together when the observation store moves to the SDK.
export { ensureSample as seedHealth } from "@/apps/health/demo/sample";
export { writeSamples } from "@/apps/health/lib/data/import";
export { loadMeasurements } from "@/apps/health/lib/data/metrics";
export { createHealthDataStore } from "@/apps/health/lib/data/store";
export type { Measurement } from "@/apps/health/lib/model";
