// AUTHORED-BY Claude Fable 5
"use client";

import { useEffect, useState } from "react";

/**
 * Live-status probes: client-side fetches to each zone's same-origin `/api/health` route
 * (proxied through the shell's multi-zone rewrites), with periodic refresh and honest
 * degradation — an unreachable zone is reported as "not deployed", never hidden.
 */
export type ServiceStatus = "checking" | "live" | "not-deployed";

export const REFRESH_INTERVAL_MS = 30_000;
/** Per-probe budget: a stalled zone must not hold the others at "checking". */
export const PROBE_TIMEOUT_MS = 5_000;

async function probe(healthPath: string, signal: AbortSignal): Promise<ServiceStatus> {
  try {
    const response = await fetch(healthPath, { cache: "no-store", signal });
    if (!response.ok) return "not-deployed";
    const payload: unknown = await response.json();
    const ok =
      typeof payload === "object" && payload !== null && (payload as { ok?: unknown }).ok === true;
    return ok ? "live" : "not-deployed";
  } catch {
    return "not-deployed";
  }
}

/** Poll the given health paths; keys of the result are the health paths themselves. */
export function useServiceStatuses(healthPaths: string[]): Record<string, ServiceStatus> {
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  // Deterministic serialization keeps the effect key stable for equal arrays without
  // embedding delimiter characters in the source (paths never contain quotes).
  const pathsKey = JSON.stringify(healthPaths);

  useEffect(() => {
    const paths = JSON.parse(pathsKey) as string[];
    let cancelled = false;
    const inFlight = new Set<string>();
    const controllers = new Set<AbortController>();

    async function refreshPath(path: string) {
      // Per-endpoint guard, held until the underlying fetch ACTUALLY settles: at most
      // one outstanding request per endpoint, ever. A zone whose fetch ignores its abort
      // signal must not accumulate a new zombie request on every interval, and one
      // endpoint's pending probe never gates any other.
      if (inFlight.has(path)) return;
      inFlight.add(path);
      const controller = new AbortController();
      controllers.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settled = probe(path, controller.signal);
        // The timeout SETTLES the race as well as aborting the fetch, so the endpoint's
        // status is published within budget regardless of the zone.
        const status = await Promise.race([
          settled,
          new Promise<ServiceStatus>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve("not-deployed");
            }, PROBE_TIMEOUT_MS);
          }),
        ]);
        if (!cancelled) {
          setStatuses((previous) =>
            previous[path] === status ? previous : { ...previous, [path]: status },
          );
        }
        // A late result is discarded — "live" requires answering within budget — but the
        // guard stays held until the request is truly finished; polling for this
        // endpoint resumes on the first interval after it settles.
        await settled;
      } finally {
        clearTimeout(timer);
        controllers.delete(controller);
        inFlight.delete(path);
      }
    }

    function refreshAll() {
      for (const path of paths) void refreshPath(path);
    }

    refreshAll();
    const interval = setInterval(refreshAll, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      for (const controller of controllers) controller.abort();
    };
  }, [pathsKey]);

  return statuses;
}

export const STATUS_LABELS: Record<ServiceStatus, string> = {
  checking: "Checking…",
  live: "Live",
  "not-deployed": "Not deployed",
};
