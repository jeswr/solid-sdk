// AUTHORED-BY Claude Fable 5
//
// Requester-profile resolution for the inbox + dashboard: WebID → display name
// + storage root. SSRF-conscious: only http(s) IRIs are ever dereferenced, the
// fetch goes through the INJECTED seam (the app's session fetch — never an
// ambient global), and every typed read of the FOREIGN profile is guarded (a
// malformed profile degrades to the WebID string, never throws into the view).

import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import { isHttpUrl, readRdf, type SolidFetch } from "./http.js";
import { tryRead } from "./rdf.js";

export interface AgentDisplay {
  webId: string;
  /** foaf:name / vcard:fn when readable; else the WebID itself. */
  name: string;
  /** True when the profile could be dereferenced and parsed. */
  resolved: boolean;
}

const cache = new Map<string, Promise<AgentDisplay>>();

/** Resolve (and memoise) a display name for an agent WebID. */
export function resolveAgentDisplay(webId: string, fetchFn: SolidFetch): Promise<AgentDisplay> {
  let hit = cache.get(webId);
  if (!hit) {
    hit = doResolve(webId, fetchFn);
    cache.set(webId, hit);
  }
  return hit;
}

/** Test hook: drop the memo (module-level cache would leak across tests). */
export function clearAgentDisplayCache(): void {
  cache.clear();
}

async function doResolve(webId: string, fetchFn: SolidFetch): Promise<AgentDisplay> {
  const fallback: AgentDisplay = { webId, name: webId, resolved: false };
  if (!isHttpUrl(webId)) return fallback;
  try {
    const read = await readRdf(webId, fetchFn);
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
