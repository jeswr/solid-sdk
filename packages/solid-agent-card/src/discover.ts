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
import { safeHttpIri } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { fetchOrGuarded } from "./internal/default-fetch.js";
import { classifyFetchError, describeError } from "./internal/errors.js";
import type { AgentDiscovery, AgentPointer, VerificationResult } from "./types.js";
import { verifyDataset } from "./verify.js";
import { AD_OWNER, WELL_KNOWN_AGENT_CARD, WELL_KNOWN_AGENT_DESCRIPTIONS } from "./vocab.js";
import { wrapProfile } from "./wrappers.js";

/** Options for {@link discoverAgent}. */
export interface DiscoverOptions {
  /**
   * A `fetch` implementation (e.g. an authenticated Solid fetch).
   *
   * SECURITY — this fetch is the SSRF boundary. `discoverAgent` follows the
   * agent-pointer IRI read from a (possibly untrusted) WebID profile and fetches
   * it. When omitted under Node, both fetches use `@jeswr/guarded-fetch`'s
   * DNS-pinned fetch (loaded lazily), which refuses private, loopback and
   * link-local targets (including via redirects) and bounds body size and time.
   * In a browser the default is `globalThis.fetch`: CORS only limits which
   * responses a page can read, not which requests it issues, so untrusted
   * browser-side discovery is only partially guarded. An injected fetch replaces
   * either default, so it must enforce its own SSRF policy when the WebID is
   * untrusted. (This is distinct from the subject-binding spoofing guard, which
   * prevents a descriptor from *claiming* a different agent IRI, not SSRF.)
   *
   * Independently of the injected fetch, `discoverAgent` REJECTS (skips) any
   * pointer whose object is not a well-formed absolute http(s) IRI — `file:`,
   * `javascript:`, `data:`, scheme-relative and authority-deficient forms never
   * reach the fetch at all. The injected guard is then responsible only for the
   * remaining http(s) SSRF surface (private ranges, DNS rebinding, redirects).
   */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * When `true` (the default), follow the discovered agent pointer, fetch the
   * agent's Agent Description and verify it. When `false`, return the pointer(s)
   * only (no second fetch).
   */
  readonly resolveDescriptor?: boolean;
  /**
   * When `true`, require the resolved descriptor to carry EXACTLY ONE `ad:owner`
   * IRI equal to the WebID discovery started from — the check is exact AND
   * order-independent. Fail-closed on every deviation: zero owners, two-or-more
   * owners (ambiguous, even if one matches), a non-IRI owner term, or a single
   * non-matching owner. This is the OWNER BACK-LINK guard, the
   * bidirectional binding the accountability chain needs: the profile says
   * "this agent represents me" AND the agent's own description says "I
   * represent this WebID". Without it, a profile can point at any third
   * party's (well-formed) agent description and discovery still reports
   * `valid` — the descriptor never claimed to represent this WebID, but
   * nothing checked. Defaults to `false` (backwards compatible); either way
   * the result carries {@link AgentDiscovery.ownerMatchesWebId} so callers can
   * check cheaply. NOTE the equality is exact — `https://jeswr.org/#me` and
   * `https://www.jeswr.org/#me` are different IRIs; the descriptor's
   * `ad:owner` must use the canonical WebID spelling.
   */
  readonly requireOwnerMatch?: boolean;
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
  const fetchOpts = { fetch: await fetchOrGuarded(options.fetch) };

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
    // SCHEME GUARD (fail-closed): the pointer object comes from a possibly
    // UNTRUSTED profile document and is the IRI the descriptor fetch below is
    // issued against. Only well-formed absolute http(s) IRIs are accepted —
    // `file:`, `javascript:`, `data:`, `ftp:`, authority-deficient `https:foo`
    // etc. are all REJECTED (skipped) here, BEFORE any fetch, rather than
    // delegated to the injected fetch's own policy. `safeHttpIri` also
    // percent-encodes IRIREF-forbidden characters, so the value we keep (and
    // later fetch / compare subjects against) is the neutralised form.
    const safeAgent = safeHttpIri(agent.value);
    if (safeAgent === undefined) {
      continue;
    }
    pointers.push({ webId, agent: safeAgent, predicate });
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

  const initial = verifyDataset(descriptorDataset, agentIri, { requireSubjectMatch: true });
  const { verification, ownerMatchesWebId } = applyOwnerBackLink(
    initial,
    descriptorDataset,
    webId,
    options.requireOwnerMatch === true,
  );

  return {
    webId,
    pointers,
    ...(verification.descriptor !== undefined && { descriptor: verification.descriptor }),
    verification,
    ...(ownerMatchesWebId !== undefined && { ownerMatchesWebId }),
  };
}

/** The outcome of the raw {@link ownerBackLink} check, with a fail reason. */
type OwnerBackLink =
  | { matches: true }
  | { matches: false; reason: "none" | "multiple" | "non-iri" | "mismatch"; message: string };

/**
 * The OWNER BACK-LINK check, computed from the RAW `ad:owner` terms on the
 * RESOLVED DESCRIPTION'S ACTUAL SUBJECT (`descriptorSubject` — i.e. the
 * `ad:AgentDescription` node's IRI), NOT the requested agent IRI. Keying on the
 * resolved subject avoids a subject-confusion: a document served at URL A whose
 * description subject is B could otherwise contain an unrelated
 * `<A> ad:owner <webId>` triple and spuriously satisfy the back-link even though
 * the resolved description (subject B) never claimed that owner. (The
 * subject-binding guard in verifyDataset already flags A≠B, but the owner check
 * must be self-consistently scoped to the resolved subject regardless.) It also
 * ignores the projected `descriptor.owner`, which keeps only the first term.
 *
 * The security guarantee is EXACT and ORDER-INDEPENDENT: the back-link holds iff
 * the resolved subject has EXACTLY ONE `ad:owner`, it is an IRI, and it equals
 * `webId`. Any deviation fails CLOSED regardless of RDF insertion order:
 *   - zero owners           → `none`     (no claim → cannot confirm);
 *   - two or more owners     → `multiple` (ambiguous → cannot rely on any one,
 *                                          even if one of them matches);
 *   - a non-IRI owner term   → `non-iri`  (a literal/blank node is malformed);
 *   - a single non-matching  → `mismatch`.
 * This closes the insertion-order-ambiguity class: a descriptor carrying BOTH a
 * matching and a non-matching `ad:owner` is rejected either way round.
 */
function ownerBackLink(
  dataset: DatasetCore,
  descriptorSubject: string,
  webId: string,
): OwnerBackLink {
  const owners: { value: string; isIri: boolean }[] = [];
  for (const quad of dataset) {
    if (quad.predicate.value === AD_OWNER && quad.subject.value === descriptorSubject) {
      owners.push({ value: quad.object.value, isIri: quad.object.termType === "NamedNode" });
    }
  }
  if (owners.length === 0) {
    return {
      matches: false,
      reason: "none",
      message: `Agent Description (${descriptorSubject}) has no ad:owner, so the owner back-link to ${webId} cannot be confirmed.`,
    };
  }
  if (owners.length > 1) {
    return {
      matches: false,
      reason: "multiple",
      message: `Agent Description (${descriptorSubject}) declares ${owners.length} ad:owner triples; the owner back-link requires exactly one (ambiguous — fail-closed).`,
    };
  }
  const [owner] = owners as [{ value: string; isIri: boolean }];
  if (!owner.isIri) {
    return {
      matches: false,
      reason: "non-iri",
      message: `Agent Description ad:owner ("${owner.value}") is not an IRI; the owner back-link requires an IRI equal to ${webId}.`,
    };
  }
  if (owner.value !== webId) {
    return {
      matches: false,
      reason: "mismatch",
      message: `Agent Description ad:owner (${owner.value}) does not equal the WebID discovery started from (${webId}).`,
    };
  }
  return { matches: true };
}

/**
 * Apply the OWNER BACK-LINK to a verification result. Computes
 * {@link ownerBackLink} from the raw dataset (only when an agent description was
 * found), sets `ownerMatchesWebId`, and — when `required` — invalidates the
 * verification with an `owner-mismatch` issue on any failure.
 */
function applyOwnerBackLink(
  verification: VerificationResult,
  dataset: DatasetCore,
  webId: string,
  required: boolean,
): { verification: VerificationResult; ownerMatchesWebId?: boolean } {
  // Fail closed when no descriptor was resolved (no subject to scope the check
  // to). ownerMatchesWebId stays undefined — there is nothing to report on.
  const subject = verification.descriptor?.id;
  if (subject === undefined) {
    return { verification };
  }
  // Key the raw owner check on the RESOLVED description's actual subject, not
  // the requested agent IRI — closes the subject-confusion where an unrelated
  // `<agentIri> ad:owner <webId>` triple could otherwise satisfy the back-link
  // for a description whose subject differs.
  const link = ownerBackLink(dataset, subject, webId);
  if (link.matches || !required) {
    return { verification, ownerMatchesWebId: link.matches };
  }
  const value = verification.descriptor?.owner;
  return {
    ownerMatchesWebId: false,
    verification: {
      ...verification,
      valid: false,
      issues: [
        ...verification.issues,
        {
          code: "owner-mismatch",
          message: link.message,
          subject,
          ...(value !== undefined && { value }),
        },
      ],
    },
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
