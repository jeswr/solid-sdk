// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// discoverAgent(...) — the CONSUME side. Given a WebID (or any profile document
// URL), read the person→agent pointer ("the agent that represents you"), then
// resolve + verify that agent's ANP Agent Description. Plus well-known helpers:
// the ANP `.well-known/agent-descriptions` and A2A `.well-known/agent-card.json`
// URLs for a given origin (roadmap M1: align to ANP's well-known path, treat the
// A2A path as a pinned constant). Parsing via @jeswr/fetch-rdf; extraction via the
// typed wrappers.

import { fetchRdf } from "@jeswr/fetch-rdf";
import { classifyFetchError, describeError } from "./internal/errors.js";
import type { AgentDiscovery, AgentPointer } from "./types.js";
import { verifyDataset } from "./verify.js";
import { WELL_KNOWN_AGENT_CARD, WELL_KNOWN_AGENT_DESCRIPTIONS } from "./vocab.js";
import { wrapProfile } from "./wrappers.js";

/** Options for {@link discoverAgent}. */
export interface DiscoverOptions {
  /**
   * A `fetch` implementation (e.g. an authenticated Solid fetch).
   *
   * SECURITY — this fetch is the SSRF boundary. `discoverAgent` follows the
   * agent-pointer IRI read from a (possibly untrusted) WebID profile and fetches
   * it. In a **server / Node** context the default `globalThis.fetch` is NOT
   * SSRF-guarded, so a hostile profile could point the second fetch at an
   * internal address (e.g. cloud metadata). Callers resolving UNTRUSTED WebIDs on
   * a server SHOULD inject an SSRF-guarded fetch (e.g. `@jeswr/guarded-fetch`'s
   * node fetch, with DNS-pinning). In a browser, CORS only limits which
   * cross-origin RESPONSES your code can read — it does not stop the request
   * being issued to an internal target — so treat untrusted browser-side
   * discovery as only partially guarded. (This is distinct from the
   * subject-binding spoofing guard, which prevents a descriptor from *claiming* a
   * different agent IRI, not SSRF.)
   */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * When `true` (the default), follow the discovered agent pointer, fetch the
   * agent's Agent Description and verify it. When `false`, return the pointer(s)
   * only (no second fetch).
   */
  readonly resolveDescriptor?: boolean;
}

/**
 * Discover the agent that represents the holder of `webId`.
 *
 * 1. Fetch + parse the WebID profile (Turtle / JSON-LD conneg).
 * 2. Read the person→agent pointer(s) across the standard predicates
 *    (`interop:hasAuthorizationAgent`, then `schema:agent`).
 * 3. Unless `resolveDescriptor === false`, fetch the first agent's Agent
 *    Description and verify it.
 *
 * @param webId - the person's WebID (or profile document URL).
 * @returns the pointer(s) found, plus the resolved + verified descriptor.
 */
export async function discoverAgent(
  webId: string,
  options: DiscoverOptions = {},
): Promise<AgentDiscovery> {
  if (!webId) {
    throw new TypeError("discoverAgent: webId is required.");
  }
  const fetchOpts = options.fetch ? { fetch: options.fetch } : {};

  let profileDataset: import("@rdfjs/types").DatasetCore;
  try {
    const fetched = await fetchRdf(webId, fetchOpts);
    profileDataset = fetched.dataset;
  } catch (err) {
    // A profile that does not resolve yields no pointers (and no thrown error —
    // discovery is best-effort). The caller sees an empty `pointers` list.
    void err;
    return { webId, pointers: [] };
  }

  const profile = wrapProfile(profileDataset);
  const rawPointers = profile.agentPointers(webId);
  const pointers: AgentPointer[] = [];
  for (const { predicate, agent } of rawPointers) {
    // A person→agent pointer must be an IRI; a literal / blank node is malformed
    // and is skipped (not a valid agent endpoint).
    if (agent.termType !== "NamedNode") {
      continue;
    }
    pointers.push({ webId, agent: agent.value, predicate });
  }

  if (pointers.length === 0 || options.resolveDescriptor === false) {
    return { webId, pointers };
  }

  // Resolve the FIRST pointer (priority-ordered by predicate). The agent IRI is
  // typically the document; verifyDescriptor re-fetches + verifies it. We bind
  // the description subject to the agent IRI (the spoofing guard).
  const agentIri = pointers[0]?.agent as string;
  let descriptorDataset: import("@rdfjs/types").DatasetCore;
  try {
    const fetched = await fetchRdf(agentIri, fetchOpts);
    descriptorDataset = fetched.dataset;
  } catch (err) {
    return {
      webId,
      pointers,
      verification: {
        valid: false,
        issues: [{ code: classifyFetchError(err), message: describeError(err), subject: agentIri }],
      },
    };
  }

  const verification = verifyDataset(descriptorDataset, agentIri, { requireSubjectMatch: true });
  return {
    webId,
    pointers,
    ...(verification.descriptor !== undefined && { descriptor: verification.descriptor }),
    verification,
  };
}

/**
 * The ANP Agent Description discovery URL for an origin — `<origin>` +
 * `/.well-known/agent-descriptions`. Aligned with ANP (NOT a bespoke path).
 *
 * @param origin - a pod / host URL; any path/query/fragment is discarded.
 */
export function agentDescriptionsUrl(origin: string): string {
  return new URL(WELL_KNOWN_AGENT_DESCRIPTIONS, originOf(origin)).toString();
}

/**
 * The A2A Agent Card discovery URL for an origin — `<origin>` +
 * `/.well-known/agent-card.json` (RFC 8615). A pinned watch item (the A2A path /
 * schema is LF-governed and fast-moving).
 */
export function agentCardUrl(origin: string): string {
  return new URL(WELL_KNOWN_AGENT_CARD, originOf(origin)).toString();
}

/** The scheme+authority of a URL (drops path/query/fragment), with a trailing slash. */
function originOf(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/`;
}
