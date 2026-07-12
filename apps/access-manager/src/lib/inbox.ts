// AUTHORED-BY Claude Fable 5
//
// The access-request inbox (proposal §3.2/§3.3, Phase-1 client-side): discover
// the pod's ldp:inbox from the owner's profile, list it, and parse each message
// as an ODRL-shaped access request — LENIENTLY. Inbox contents are UNTRUSTED
// foreign RDF: every field read is tryRead-guarded, a malformed message drops
// fields (or is listed as unparseable) and NEVER aborts the inbox; only http(s)
// IRIs are kept from foreign data.

import { policyFromRdf } from "@jeswr/solid-odrl";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import type { WacMode } from "./acl.js";
import { isHttpUrl, readRdf, type SolidFetch } from "./http.js";
import { objectIri, tryRead } from "./rdf.js";
import { AccmRecord, type RequestStatus } from "./records.js";
import { containerMembers } from "./storage-walk.js";
import { LDP } from "./vocab.js";

/** ODRL action → the WAC mode the app would materialise (proposal §1). */
const ACTION_TO_MODE: Record<string, WacMode> = {
  read: "Read",
  use: "Read",
  index: "Read",
  aggregate: "Read",
  write: "Write",
  modify: "Write",
  delete: "Write",
};

export interface ParsedAccessRequest {
  /** The request resource URL (also the CAS anchor). */
  url: string;
  etag: string | null;
  /** The requesting agent (odrl:assignee), when present + http(s). */
  requester?: string;
  /** Requested WAC modes derived from the ODRL actions (deduped). */
  modes: WacMode[];
  /** Requested targets: concrete resources and/or a data-class IRI. */
  targets: string[];
  /** An explicit accm:dataClass label reference, when the request carries one. */
  dataClass?: string;
  /** odrl purpose constraint value (a DPV IRI or literal), when present. */
  purpose?: string;
  /** dateTime upper-bound constraint (requested expiry), when present. */
  expiry?: string;
  /** Lifecycle status; a fresh inbound message with none is Pending. */
  status: RequestStatus;
  /** The §3.5 snapshot, present once an approval CAS has pinned it. */
  snapshot?: RequestSnapshot;
  /** True when no ODRL policy could be projected (shown as unparseable). */
  malformed: boolean;
  dataset: DatasetCore;
}

export interface RequestSnapshot {
  grantId: string;
  targets: string[];
  agent: string;
  modes: WacMode[];
  schemaVersion: string;
}

/** Discover the owner's ldp:inbox from their profile (undefined when none). */
export async function discoverInbox(
  webId: string,
  fetchFn: SolidFetch,
): Promise<string | undefined> {
  const profile = await readRdf(webId, fetchFn);
  if (!profile) return undefined;
  const inbox = tryRead(() => objectIri(profile.dataset, webId, LDP.inbox));
  return inbox !== undefined && isHttpUrl(inbox) ? inbox : undefined;
}

const MODE_IRI_TAIL: Record<string, WacMode> = {
  "http://www.w3.org/ns/auth/acl#Read": "Read",
  "http://www.w3.org/ns/auth/acl#Write": "Write",
  "http://www.w3.org/ns/auth/acl#Append": "Append",
  "http://www.w3.org/ns/auth/acl#Control": "Control",
};

/** Project one request resource (lenient; never throws on foreign data). */
export function projectAccessRequest(
  url: string,
  etag: string | null,
  dataset: DatasetCore,
): ParsedAccessRequest {
  const record = new AccmRecord(url, dataset, DataFactory);
  const status = tryRead(() => record.status) ?? "Pending";

  let requester: string | undefined;
  const modes = new Set<WacMode>();
  const targets = new Set<string>();
  let purpose: string | undefined;
  let expiry: string | undefined;
  let malformed = false;

  const policy = tryRead(() => policyFromRdf(dataset));
  if (policy === undefined) {
    malformed = true;
  } else {
    const policyAssignee = policy.assignee;
    if (policyAssignee !== undefined && isHttpUrl(policyAssignee)) requester = policyAssignee;
    for (const rule of policy.permissions ?? []) {
      const ruleAssignee = rule.assignee;
      if (requester === undefined && ruleAssignee !== undefined && isHttpUrl(ruleAssignee)) {
        requester = ruleAssignee;
      }
      const mode = ACTION_TO_MODE[rule.action];
      if (mode !== undefined) modes.add(mode);
      if (rule.target !== undefined && isHttpUrl(rule.target)) targets.add(rule.target);
      for (const c of rule.constraints ?? []) {
        if (c.leftOperand === "purpose" && typeof c.rightOperand === "string") {
          purpose = c.rightOperand;
        }
        if (
          c.leftOperand === "dateTime" &&
          (c.operator === "lteq" || c.operator === "lt") &&
          typeof c.rightOperand === "string"
        ) {
          expiry = c.rightOperand;
        }
      }
    }
  }

  const dataClass = tryRead(() => record.dataClass);

  let snapshot: RequestSnapshot | undefined;
  const grantId = tryRead(() => record.grantId);
  if (grantId !== undefined) {
    const snapTargets = (tryRead(() => [...record.resolvesTo]) ?? []).filter(isHttpUrl).sort();
    const agent = tryRead(() => record.snapshotAgent);
    const snapModes = (tryRead(() => [...record.snapshotModes]) ?? [])
      .map((m) => MODE_IRI_TAIL[m])
      .filter((m): m is WacMode => m !== undefined);
    const schemaVersion = tryRead(() => record.schemaVersion) ?? "1";
    if (agent !== undefined) {
      snapshot = { grantId, targets: snapTargets, agent, modes: snapModes, schemaVersion };
    }
  }

  return {
    url,
    etag,
    ...(requester !== undefined ? { requester } : {}),
    modes: [...modes],
    targets: [...targets],
    ...(dataClass !== undefined ? { dataClass } : {}),
    ...(purpose !== undefined ? { purpose } : {}),
    ...(expiry !== undefined ? { expiry } : {}),
    status,
    ...(snapshot !== undefined ? { snapshot } : {}),
    malformed,
    dataset,
  };
}

/** Read + project one request resource. Null when it no longer exists. */
export async function readAccessRequest(
  url: string,
  fetchFn: SolidFetch,
): Promise<ParsedAccessRequest | null> {
  const read = await readRdf(url, fetchFn);
  if (!read) return null;
  return projectAccessRequest(read.url, read.etag, read.dataset);
}

/**
 * List the inbox: every member is projected; a member that fails to fetch or
 * parse at the HTTP/RDF level is surfaced as a malformed placeholder — the
 * inbox NEVER aborts on one bad message.
 */
export async function listInbox(
  inboxUrl: string,
  fetchFn: SolidFetch,
): Promise<ParsedAccessRequest[]> {
  const container = await readRdf(inboxUrl, fetchFn);
  if (!container) return [];
  const out: ParsedAccessRequest[] = [];
  for (const member of containerMembers(container.dataset)) {
    if (member.isContainer) continue;
    try {
      const request = await readAccessRequest(member.url, fetchFn);
      if (request) out.push(request);
    } catch {
      out.push({
        url: member.url,
        etag: null,
        modes: [],
        targets: [],
        status: "Pending",
        malformed: true,
        dataset: new Store(),
      });
    }
  }
  return out;
}
