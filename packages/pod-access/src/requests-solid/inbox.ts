// AUTHORED-BY Codex GPT-6
import { policyFromRdf } from "@jeswr/solid-odrl";
import { termsEqual } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { accmTerm } from "./canonical-vocab.js";
import {
  httpUrl,
  MAX_MEMBERS,
  publicTransport,
  read,
  readProfile,
  scoped,
  transport,
} from "./http.js";
import { values } from "./rdf.js";
import { ACCM, DCT, DPV, FOAF, LDP } from "./vocab.js";

export type RequestMode = "read" | "write" | "append";
export type RequestStatus = "pending" | "approving" | "approved" | "denied";
export type AccessRequestEntry =
  | { id: string; status: "unreadable" }
  | {
      id: string;
      status: RequestStatus;
      requester: string;
      /** Notification-local name only; listing never dereferences the requester. */
      requesterName?: string;
      purpose?: string;
      dataTypes: string[];
      /** Every requested mode, across all data types. */
      modes: RequestMode[];
      /**
       * Modes per requested data type. A rule that targets a data type applies to that type
       * only; a rule with any other target applies to every requested type.
       */
      modesByType: Record<string, RequestMode[]>;
      requestedDuration?: string;
      expiresAt?: string;
      created?: string;
      decidedAt?: string;
    };

export interface ListRequestsOptions {
  fetch: typeof fetch;
  webId: string;
  storage: string;
  inbox?: string;
  profile?: DatasetCore;
  /**
   * Unauthenticated transport used only to read an owner profile hosted outside storage
   * (forced to `credentials: "omit"` and `redirect: "error"`). Without it, such a profile is
   * not read and the inbox must be supplied.
   */
  publicFetch?: typeof fetch;
  signal?: AbortSignal;
}

const ACTIONS: Readonly<Record<string, RequestMode>> = Object.freeze({
  read: "read",
  use: "read",
  index: "read",
  aggregate: "read",
  write: "write",
  modify: "write",
  delete: "write",
  append: "append",
});
const STATUSES: Readonly<Record<string, RequestStatus>> = Object.freeze({
  [ACCM.Pending]: "pending",
  [ACCM.Approving]: "approving",
  [ACCM.Approved]: "approved",
  [ACCM.Denied]: "denied",
});

export interface ParsedRequest {
  entry: AccessRequestEntry;
  dataset: DatasetCore;
  etag: string | null;
  targets: string[];
}

/** The lenient foreign-RDF projection from access-manager, with explicit work limits. */
export function project(id: string, dataset: DatasetCore, etag: string | null): ParsedRequest {
  const unreadable: ParsedRequest = {
    entry: { id, status: "unreadable" },
    dataset,
    etag,
    targets: [],
  };
  try {
    const policy = policyFromRdf(dataset);
    if (policy === undefined) return unreadable;
    const modes = new Set<RequestMode>();
    const rules: { mode: RequestMode; target: string }[] = [];
    const targets = new Set<string>();
    const assignees = new Set<string>();
    let purpose: string | undefined;
    let expiresAt: string | undefined;
    let requestedDuration: string | undefined;
    for (const rule of policy.permissions ?? []) {
      const assignee = rule.assignee ?? policy.assignee;
      if (assignee !== undefined) assignees.add(assignee);
      const mode = ACTIONS[rule.action];
      if (rule.target !== undefined) targets.add(httpUrl(rule.target));
      if (mode !== undefined) {
        modes.add(mode);
        if (rule.target !== undefined) rules.push({ mode, target: rule.target });
      }
      for (const constraint of rule.constraints ?? []) {
        if (constraint.leftOperand === "purpose" && typeof constraint.rightOperand === "string") {
          purpose = constraint.rightOperand;
        }
        if (
          constraint.leftOperand === "elapsedTime" &&
          typeof constraint.rightOperand === "string"
        ) {
          requestedDuration = constraint.rightOperand;
        }
        if (
          constraint.leftOperand === "dateTime" &&
          (constraint.operator === "lt" || constraint.operator === "lteq") &&
          typeof constraint.rightOperand === "string"
        )
          expiresAt = constraint.rightOperand;
      }
    }
    // One request, one recipient: rules naming different assignees cannot be merged into one grant.
    if (assignees.size !== 1 || modes.size === 0 || targets.size === 0) return unreadable;
    const requester = [...assignees][0] as string;
    httpUrl(requester);
    const statusValues = values(dataset, id, ACCM.status);
    const status =
      statusValues.length === 0 ? "pending" : STATUSES[accmTerm(statusValues[0] as string)];
    if (status === undefined || statusValues.length > 1) return unreadable;
    const explicit = values(dataset, id, ACCM.dataClass).map((iri) => accmTerm(httpUrl(iri)));
    const requesterName =
      values(dataset, requester, FOAF.name)[0] ??
      values(dataset, requester, "http://www.w3.org/2006/vcard/ns#fn")[0];
    purpose ??= values(dataset, id, DPV.hasPurpose)[0];
    expiresAt ??= values(dataset, id, DPV.hasExpiryTime)[0];
    const dataTypes = [...new Set(explicit.length ? explicit : targets)];
    const modesByType: Record<string, RequestMode[]> = {};
    for (const type of dataTypes) {
      const own = new Set<RequestMode>();
      for (const rule of rules) {
        const typed = dataTypes.some((candidate) => termsEqual(candidate, rule.target));
        if (!typed || termsEqual(type, rule.target)) own.add(rule.mode);
      }
      if (own.size > 0) modesByType[type] = [...own];
    }
    const entry: AccessRequestEntry = {
      id,
      status,
      requester,
      dataTypes,
      modes: [...modes],
      modesByType,
      ...(requesterName !== undefined && { requesterName }),
      ...(purpose !== undefined && { purpose }),
      ...(expiresAt !== undefined && { expiresAt }),
      ...(requestedDuration !== undefined && { requestedDuration }),
      ...(values(dataset, id, DCT.created)[0] !== undefined && {
        created: values(dataset, id, DCT.created)[0],
      }),
      ...(values(dataset, id, `${ACCM.ns}decidedAt`)[0] !== undefined && {
        decidedAt: values(dataset, id, `${ACCM.ns}decidedAt`)[0],
      }),
    };
    return { entry, dataset, etag, targets: [...targets] };
  } catch {
    return unreadable;
  }
}

/** Anchor membership to the requested container; hostile sibling subjects carry no authority. */
export function members(dataset: DatasetCore, container: string): string[] {
  const node = new Container(container, dataset, DataFactory);
  const out: string[] = [];
  // The upstream all-or-nothing getter can throw on a malformed sibling: filter each term first.
  for (const q of dataset.match(
    DataFactory.namedNode(node.value),
    DataFactory.namedNode(LDP.contains),
  )) {
    if (q.object.termType !== "NamedNode") continue;
    out.push(q.object.value);
    if (out.length >= MAX_MEMBERS) break;
  }
  return [...new Set(out)];
}

/** Discover ldp:inbox and list at most MAX_MEMBERS, each bounded to MAX_NOTIFICATION_BYTES. */
export async function listRequests(options: ListRequestsOptions): Promise<AccessRequestEntry[]> {
  const fetchFn = transport(options.fetch, options.signal);
  let inbox = options.inbox;
  if (inbox === undefined) {
    const publicFetch = options.publicFetch && publicTransport(options.publicFetch, options.signal);
    const profile =
      options.profile ??
      (await readProfile(options.webId, options.storage, fetchFn, publicFetch))?.dataset;
    if (!profile) return [];
    inbox = values(profile, options.webId, LDP.inbox)[0];
  }
  if (inbox === undefined) return [];
  inbox = scoped(options.storage, inbox);
  const listing = await read(inbox, fetchFn);
  if (!listing) return [];
  const out: AccessRequestEntry[] = [];
  for (const member of members(listing.dataset, inbox)) {
    options.signal?.throwIfAborted();
    if (member.endsWith("/") || member.endsWith(".acl")) continue;
    try {
      const id = scoped(options.storage, member);
      const notification = await read(id, fetchFn);
      out.push(
        notification
          ? project(id, notification.dataset, notification.etag).entry
          : { id, status: "unreadable" },
      );
    } catch {
      options.signal?.throwIfAborted();
      out.push({ id: member, status: "unreadable" });
    }
  }
  return out;
}
