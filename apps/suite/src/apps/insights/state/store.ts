// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../demo/sample";
import { loadSources, type Source } from "../lib/sources";
export interface InsightsSnapshot {
  status: "loading" | "ready" | "error";
  sources: Source[];
  refreshing: boolean;
  now: Date;
}
export interface StoreDependencies {
  seed: typeof ensureSample;
  load: typeof loadSources;
  now: () => Date;
}
/** Session-owned state; late reads and unmounted sessions can never publish results. */
export function createInsightsStore(
  session: PodSession,
  timeZone: string,
  dependencies: StoreDependencies = {
    seed: ensureSample,
    load: loadSources,
    now: () => new Date(),
  },
) {
  let snapshot: InsightsSnapshot = {
    status: "loading",
    sources: [],
    refreshing: false,
    now: dependencies.now(),
  };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: InsightsSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel() {
      generation++;
      if (snapshot.refreshing) publish({ ...snapshot, refreshing: false });
    },
    async refresh() {
      const captured = ++generation;
      publish({ ...snapshot, refreshing: true });
      try {
        const now = dependencies.now();
        await dependencies.seed(session, now);
        const sources = await dependencies.load({ session, now, timeZone });
        if (captured !== generation) return;
        const readable = sources.filter((s) => s.status !== "unavailable");
        publish({
          status:
            readable.length > 0 && readable.every((s) => s.status === "error") ? "error" : "ready",
          sources,
          now,
          refreshing: false,
        });
      } catch {
        if (captured === generation)
          publish({ ...snapshot, status: "error", sources: [], refreshing: false });
      }
    },
  };
}
