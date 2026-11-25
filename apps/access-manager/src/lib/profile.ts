// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Codex GPT-6.1-Sol
//
// Requester-profile resolution for the inbox + dashboard: WebID → display name
// + storage root. All profiles use the SDK's public HTTPS policy, bounded
// reader and explicit pristine public fetch, with cancellation and a 10 s deadline.
// Every typed read of a foreign profile is guarded (a
// malformed profile degrades to the WebID string, never throws into the view).

import { publicHttpsUrl, publicTransport } from "@jeswr/pod-access/requests-solid";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import { isHttpUrl, readRdf, type SolidFetch } from "./http.js";
import { objectIri, tryRead } from "./rdf.js";

export interface AgentDisplay {
  webId: string;
  /** foaf:name / vcard:fn when readable; else the WebID itself. */
  name: string;
  /** True when the profile could be dereferenced and parsed. */
  resolved: boolean;
}

interface DisplayLookup {
  controller: AbortController;
  promise: Promise<AgentDisplay>;
  readers: number;
}

let cache = new WeakMap<SolidFetch, Map<string, Map<string, DisplayLookup>>>();

/** Public profiles never need session credentials, including the owner's profile. */
export async function readPublicProfile(
  webId: string,
  publicFetch: SolidFetch,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let rejectRead: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectRead = reject;
  });
  const rejectOnAbort = () => rejectRead(controller.signal.reason);
  controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  try {
    // Race the whole read as well: a stalled injected fetch or body must not retain a cache entry.
    return await Promise.race([
      readRdf(publicHttpsUrl(webId), publicTransport(publicFetch, controller.signal)),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectOnAbort);
  }
}

/** Resolve a public display name, scoped to the viewer. Supply only a pristine public fetch. */
export function resolveAgentDisplay(
  webId: string,
  fetchFn: SolidFetch,
  sessionWebId: string,
  signal?: AbortSignal,
): Promise<AgentDisplay> {
  const fallback: AgentDisplay = { webId, name: webId, resolved: false };
  if (signal?.aborted) return Promise.resolve(fallback);
  let accounts = cache.get(fetchFn);
  if (!accounts) {
    accounts = new Map();
    cache.set(fetchFn, accounts);
  }
  let names = accounts.get(sessionWebId);
  if (!names) {
    names = new Map();
    accounts.set(sessionWebId, names);
  }
  let hit = names.get(webId);
  if (!hit) {
    const entries = names;
    const controller = new AbortController();
    const lookup: DisplayLookup = {
      controller,
      readers: 0,
      promise: doResolve(webId, fetchFn, controller.signal).then((display) => {
        if (!display.resolved && entries.get(webId) === lookup) entries.delete(webId);
        return display;
      }),
    };
    hit = lookup;
    names.set(webId, hit);
  }
  const lookup = hit;
  const entries = names;
  lookup.readers++;
  return new Promise((resolve) => {
    let done = false;
    const finish = (display: AgentDisplay) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", abort);
      lookup.readers--;
      resolve(display);
    };
    const abort = () => {
      finish(fallback);
      // Several labels can share a lookup; stop its fetch only after the last one leaves.
      if (lookup.readers === 0) {
        if (entries.get(webId) === lookup) entries.delete(webId);
        lookup.controller.abort();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    void lookup.promise.then(finish);
  });
}

/** Drop resolved names on logout/account changes, and between tests. */
export function clearAgentDisplayCache(): void {
  cache = new WeakMap();
}

async function doResolve(
  webId: string,
  fetchFn: SolidFetch,
  signal: AbortSignal,
): Promise<AgentDisplay> {
  const fallback: AgentDisplay = { webId, name: webId, resolved: false };
  try {
    const read = await readPublicProfile(webId, fetchFn, signal);
    if (!read) return fallback;
    const agent = new Agent(webId, read.dataset, DataFactory);
    const name = tryRead(() => agent.name) ?? undefined;
    return {
      webId,
      name: typeof name === "string" && name !== "" ? name : webId,
      resolved: true,
    };
  } catch {
    return fallback;
  }
}

/** The profile's advertised storages (pim:storage), guarded; may be empty. */
export async function storageRoots(
  webId: string,
  publicFetch: SolidFetch,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!isHttpUrl(webId)) return [];
  try {
    const read = await readPublicProfile(webId, publicFetch, signal);
    if (!read) return [];
    const agent = new Agent(webId, read.dataset, DataFactory);
    return (tryRead(() => [...agent.storageUrls]) ?? []).filter(isHttpUrl);
  } catch {
    return [];
  }
}

/** Profile discovery for the shell; request listing and parsing belong to the SDK. */
export async function discoverInbox(
  webId: string,
  publicFetch: SolidFetch,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const profile = await readPublicProfile(webId, publicFetch, signal);
  return profile ? objectIri(profile.dataset, webId, "http://www.w3.org/ns/ldp#inbox") : undefined;
}
