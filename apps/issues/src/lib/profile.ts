// AUTHORED-BY GPT-6.1 Sol
import { publicFetch } from "@jeswr/app-session";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { WebIdDataset } from "@solid/object";
import { DataFactory } from "n3";
import { resolveTrackerFromTypeIndex } from "./type-index";
import { NoStorageError } from "./errors";

/**
 * A user's Solid profile, reduced to what the app needs. Discovery follows
 * AGENTS.md §WebID profiles: storage comes from `pim:storage` only.
 */
export interface SolidProfile {
  webId: string;
  name: string | null;
  /** Pod root(s) advertised via `pim:storage` (always end in `/`). */
  storageUrls: string[];
}

/**
 * Dereference a WebID with an explicit transport. Public display reads use
 * app-session publicFetch; tracker discovery receives the session fetch.
 */
export async function loadProfile(webId: string, fetchImpl: typeof fetch = publicFetch): Promise<SolidProfile> {
  const { dataset } = await fetchRdf(webId, { headers: { "cache-control": "no-cache" }, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  const agent = new WebIdDataset(dataset, DataFactory).mainSubject;
  return {
    webId,
    name: agent?.name ?? null,
    storageUrls: [...(agent?.storageUrls ?? [])],
  };
}

/**
 * The single document holding the tracker config + all issues, derived from a
 * pod root. One-document layout is the default (solid-scale-and-sharding);
 * milestone 2 may split to per-issue resources for per-issue access control.
 */
export function trackerDocumentUrl(storageUrl: string): string {
  return new URL("issue-tracker/tracker.ttl", storageUrl).toString();
}

/** Where a person's tracker config lives, and whose pod it is. */
export interface TrackerLocation {
  ownerWebId: string;
  /** URL of the tracker config document (the `issues/` container sits beside it). */
  trackerUrl: string;
}

/**
 * Locate a person's tracker: prefer their public type-index registration (the
 * interop path — works even if they moved it), else fall back to the conventional
 * path under their `pim:storage`. Used both for the signed-in user's own tracker
 * and to open one shared from another pod.
 */
export async function resolveTracker(webId: string, fetchImpl?: typeof fetch): Promise<TrackerLocation> {
  const registered = await resolveTrackerFromTypeIndex(webId, fetchImpl);
  if (registered) return { ownerWebId: webId, trackerUrl: registered };

  const profile = await loadProfile(webId, publicFetch);
  const storage = profile.storageUrls[0];
  if (!storage) throw new NoStorageError(webId);
  return { ownerWebId: webId, trackerUrl: trackerDocumentUrl(storage) };
}
