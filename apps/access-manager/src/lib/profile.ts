// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Fable 5
//
// Requester-profile resolution for the inbox + dashboard: WebID → display name
// + storage root. Foreign display profiles use the SDK's public HTTPS policy,
// bounded reader and explicit pristine public fetch. Owner discovery uses the session seam,
// and every typed read of the FOREIGN profile is guarded (a
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

let cache = new WeakMap<SolidFetch, Map<string, Map<string, Promise<AgentDisplay>>>>();

/** Resolve a public display name, scoped to the viewer. Supply only a pristine public fetch. */
export function resolveAgentDisplay(
  webId: string,
  fetchFn: SolidFetch,
  sessionWebId: string,
): Promise<AgentDisplay> {
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
    hit = doResolve(webId, fetchFn).then((display) => {
      if (!display.resolved) entries.delete(webId);
      return display;
    });
    names.set(webId, hit);
  }
  return hit;
}

/** Drop resolved names on logout/account changes, and between tests. */
export function clearAgentDisplayCache(): void {
  cache = new WeakMap();
}

async function doResolve(webId: string, fetchFn: SolidFetch): Promise<AgentDisplay> {
  const fallback: AgentDisplay = { webId, name: webId, resolved: false };
  try {
    const read = await readRdf(publicHttpsUrl(webId), publicTransport(fetchFn));
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
export async function storageRoots(webId: string, fetchFn: SolidFetch): Promise<string[]> {
  if (!isHttpUrl(webId)) return [];
  try {
    const read = await readRdf(webId, fetchFn);
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
  fetchFn: SolidFetch,
): Promise<string | undefined> {
  const profile = await readRdf(webId, fetchFn);
  return profile ? objectIri(profile.dataset, webId, "http://www.w3.org/ns/ldp#inbox") : undefined;
}
