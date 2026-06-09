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
 * Dereference a WebID and read its profile. `fetchImpl` is for tests only —
 * production omits it so the auth-patched global `fetch` is used (AGENTS.md
 * §Reading data); passing a fetch bypasses the 401→login upgrade.
 */
export async function loadProfile(webId: string, fetchImpl?: typeof fetch): Promise<SolidProfile> {
  const { dataset } = await fetchRdf(webId, fetchImpl ? { fetch: fetchImpl } : undefined);
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
export function issuesDocumentUrl(storageUrl: string): string {
  return new URL("issue-tracker/issues.ttl", storageUrl).toString();
}

/** Where a person's tracker lives, and whose pod it is. */
export interface TrackerLocation {
  ownerWebId: string;
  issuesUrl: string;
}

/**
 * Locate a person's tracker: prefer their public type-index registration (the
 * interop path — works even if they moved it), else fall back to the conventional
 * path under their `pim:storage`. Used both for the signed-in user's own tracker
 * and to open one shared from another pod.
 */
export async function resolveTracker(webId: string, fetchImpl?: typeof fetch): Promise<TrackerLocation> {
  const registered = await resolveTrackerFromTypeIndex(webId, fetchImpl);
  if (registered) return { ownerWebId: webId, issuesUrl: registered };

  const profile = await loadProfile(webId, fetchImpl);
  const storage = profile.storageUrls[0];
  if (!storage) throw new NoStorageError(webId);
  return { ownerWebId: webId, issuesUrl: issuesDocumentUrl(storage) };
}
