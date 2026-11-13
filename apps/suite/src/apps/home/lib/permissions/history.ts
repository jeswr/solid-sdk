// AUTHORED-BY Claude Opus 5.5
/**
 * The history of answered access requests, from the owner's records: the folder
 * `@jeswr/pod-access/requests-solid` seals (`settings/access-records/`) and writes one DPV consent
 * receipt per decision into, each approval joined to the ODRL grant it records. Revoking an active
 * grant removes the recipient's role from every recorded place through `@jeswr/pod-access/roles`
 * `removeGrant`, then marks the grant revoked and the receipt withdrawn, so the audit trail says
 * when access ended.
 */

import { ACCM, DCT, DPV as DPV_TERMS, requireStrongEtag } from "@jeswr/pod-access/requests-solid";
import { grantsWithRoles, removeGrant } from "@jeswr/pod-access/roles";
import type { DatasetCore, Term } from "@rdfjs/types";
import { LiteralFrom, NamedNodeFrom, RequiredAs } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { httpUrl, inStorage, readResource, serializeTurtle, subjectOf } from "../model/rdf";
import { podScoped, readRecordsDataset, recordsFrom } from "./records";
import type { GrantRecord } from "./types";
import { ACL, ODRL, UnsupportedAccessError } from "./vocab";
import { loadPermissions } from "./walk";

export type HistoryStatus = "granted" | "denied" | "revoked" | "unknown";

/** The ODRL grant an approval recorded: the exact places it shared and the role they got. */
export interface HistoryGrant {
  url: string;
  targets: string[];
  role: "viewer" | "editor";
  /** The role the approval set on each place. */
  targetRoles: Record<string, "viewer" | "editor">;
  revokedAt?: string;
}

/** One answered request, from its consent receipt. */
export interface HistoryEntry {
  receipt: string;
  status: HistoryStatus;
  recipient?: string;
  purpose?: GrantRecord["purpose"];
  decidedAt?: string;
  revokedAt?: string;
  /** Recorded only; WAC and ACP roles don't end access on their own. */
  expiresAt?: string;
  grant?: HistoryGrant;
}

/** An approval whose access is still in place, so it can be revoked from the history. */
export type ActiveHistoryEntry = HistoryEntry & {
  status: "granted";
  recipient: string;
  grant: HistoryGrant;
};

const STATUS: Readonly<Record<string, HistoryStatus>> = {
  [DPV_TERMS.ConsentGiven]: "granted",
  [DPV_TERMS.ConsentRefused]: "denied",
  [DPV_TERMS.ConsentWithdrawn]: "revoked",
};
const EDIT_ACTIONS = new Set([`${ODRL}write`, `${ODRL}modify`, `${ACL}Write`]);
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function firstDate(values: readonly string[]): string | undefined {
  const value = values.find((candidate) => Number.isFinite(Date.parse(candidate)));
  return value === undefined ? undefined : new Date(value).toISOString();
}

/** The policy's assignees, on the policy itself or on any of its permissions. */
function assignees(dataset: DatasetCore, url: string): string[] {
  const policy = subjectOf(dataset, url);
  return [
    ...new Set([
      ...policy.iris(`${ODRL}assignee`),
      ...policy
        .objects(`${ODRL}permission`)
        .flatMap((rule) => subjectOf(dataset, rule).iris(`${ODRL}assignee`)),
    ]),
  ];
}

function grantOf(dataset: DatasetCore, url: string): HistoryGrant | undefined {
  const policy = subjectOf(dataset, url);
  if (!policy.types.includes(`${ODRL}Agreement`)) return undefined;
  const targetRoles: Record<string, "viewer" | "editor"> = {};
  for (const permission of policy.objects(`${ODRL}permission`)) {
    const rule = subjectOf(dataset, permission);
    const edits = rule.iris(`${ODRL}action`).some((action) => EDIT_ACTIONS.has(action));
    for (const target of rule.iris(`${ODRL}target`))
      if (edits || targetRoles[target] === undefined)
        targetRoles[target] = edits ? "editor" : "viewer";
  }
  const revokedAt = firstDate(policy.texts(ACCM.revokedAt));
  return {
    url,
    targets: Object.keys(targetRoles).sort(),
    role: Object.values(targetRoles).includes("editor") ? "editor" : "viewer",
    targetRoles,
    ...(revokedAt && { revokedAt }),
  };
}

/** One entry per consent receipt, most recently decided first. */
export function historyFrom(dataset: DatasetCore): HistoryEntry[] {
  const records = recordsFrom(dataset);
  const receipts = new Map<string, Term>();
  for (const quad of dataset.match(
    null,
    DataFactory.namedNode(RDF_TYPE),
    DataFactory.namedNode(DPV_TERMS.ConsentRecord),
  ))
    if (quad.subject.termType === "NamedNode") receipts.set(quad.subject.value, quad.subject);
  const entries: HistoryEntry[] = [];
  for (const [url, term] of receipts) {
    const node = subjectOf(dataset, term);
    const recipient = node.iris(DPV_TERMS.hasRecipient)[0];
    const grantUrl = node.iris(ACCM.grantRef)[0];
    const grant = grantUrl === undefined ? undefined : grantOf(dataset, grantUrl);
    const record = records.get(url);
    const decidedAt = firstDate(node.texts(DCT.created));
    const revokedAt = firstDate(node.texts(ACCM.revokedAt)) ?? grant?.revokedAt;
    const expiresAt = firstDate(node.texts(DPV_TERMS.hasExpiryTime)) ?? record?.expiresAt;
    let status = STATUS[node.iris(DPV_TERMS.hasConsentStatus)[0] ?? ""] ?? "unknown";
    // A grant marked revoked whose receipt wasn't flipped yet has still ended.
    if (status === "granted" && grant?.revokedAt) status = "revoked";
    entries.push({
      receipt: url,
      status,
      ...(recipient && { recipient }),
      ...(record?.purpose && { purpose: record.purpose }),
      ...(decidedAt && { decidedAt }),
      ...(revokedAt && { revokedAt }),
      ...(expiresAt && { expiresAt }),
      ...(grant && { grant }),
    });
  }
  return entries.sort(
    (a, b) =>
      (Date.parse(b.decidedAt ?? "") || 0) - (Date.parse(a.decidedAt ?? "") || 0) ||
      a.receipt.localeCompare(b.receipt),
  );
}

export async function readAccessHistory(
  fetch: typeof globalThis.fetch,
  storage: string,
): Promise<HistoryEntry[]> {
  return historyFrom(await readRecordsDataset(fetch, storage));
}

export function isActiveGrant(entry: HistoryEntry): entry is ActiveHistoryEntry {
  return (
    entry.status === "granted" &&
    entry.recipient !== undefined &&
    entry.grant !== undefined &&
    entry.grant.revokedAt === undefined &&
    entry.grant.targets.length > 0
  );
}

/** The grant record no longer says what the history showed: nothing was changed. */
export class HistoryChangedError extends Error {
  override name = "HistoryChangedError";
  constructor(message = "This access record changed; refresh before trying again") {
    super(message);
  }
}

/** Some places kept their access. The grant stays active, so revoking can be tried again. */
export class HistoryRevokeError extends Error {
  override name = "HistoryRevokeError";
  constructor(
    readonly removed: readonly string[],
    readonly failed: readonly { url: string; error: unknown }[],
  ) {
    super("Some of this access couldn't be removed");
  }
}

export interface RevokeHistoryOptions {
  fetch: typeof globalThis.fetch;
  webId: string;
  storage: string;
  now?: () => Date;
}

/** Approvals never share the storage root or the owner's settings; refuse such a record. */
function revocable(target: string, storage: string): boolean {
  const settings = new URL("settings/", storage).href;
  return inStorage(target, storage) && target !== storage && !target.startsWith(settings);
}

/** Change one record document under its current ETag, re-reading after a lost race. */
async function updateRecord(
  fetch: typeof globalThis.fetch,
  url: string,
  edit: (dataset: Store) => boolean,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const current = await readResource(fetch, url);
    requireStrongEtag(current.etag);
    const dataset = new Store([...current.dataset]);
    if (!edit(dataset)) return;
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-match": current.etag as string },
      body: await serializeTurtle(dataset),
    });
    if (response.ok) return;
    if (response.status !== 412 || attempt === 2)
      throw new Error(`The access record couldn't be saved (${response.status})`);
  }
}

/** Whether `place`'s own policy gives `agent` any access, whatever its modes. Fails closed. */
async function holdsDirectAccess(
  fetch: typeof globalThis.fetch,
  storage: string,
  webId: string,
  place: string,
  agent: string,
): Promise<boolean> {
  const snapshot = await loadPermissions({ fetch, storage, webId, resource: place });
  if (snapshot.failures.length || snapshot.truncated) throw new HistoryChangedError();
  return snapshot.rows.some(
    (row) =>
      row.id === agent &&
      row.lines.some((line) =>
        line.resources.some((resource) => resource.url === place && !resource.inherited),
      ),
  );
}

/**
 * Revoke an approval from the history. The grant is re-read first and must still name the same
 * recipient and places. Each place's current direct role for the recipient must still be exactly
 * the role the approval set; if it was changed since (someone edited it in Permissions), revoking
 * refuses rather than take away access the approval never gave. A place where the recipient has
 * no direct role any more has nothing to remove. Then `removeGrant` takes the recipient's direct
 * role off the remaining places, and only once every place succeeded are the grant and receipt
 * marked. A partial failure leaves the grant active.
 */
export async function revokeHistoryGrant(
  entry: ActiveHistoryEntry,
  options: RevokeHistoryOptions,
): Promise<void> {
  const { grant, recipient } = entry;
  const storage = options.storage;
  const scoped = podScoped(options.fetch, storage);
  const when = (options.now ?? (() => new Date()))();
  const fresh = await readResource(scoped, grant.url);
  const current = grantOf(fresh.dataset, grant.url);
  const named = assignees(fresh.dataset, grant.url);
  if (
    !current ||
    current.targets.join("\n") !== grant.targets.join("\n") ||
    named.length !== 1 ||
    named[0] !== recipient
  )
    throw new HistoryChangedError();
  if (recipient === options.webId || !current.targets.every((url) => revocable(url, storage)))
    throw new UnsupportedAccessError();
  if (current.revokedAt === undefined) {
    const removed: string[] = [];
    const failed: { url: string; error: unknown }[] = [];
    const holding: string[] = [];
    for (const url of current.targets) {
      const kind = url.endsWith("/") ? "folder" : "resource";
      const direct = (await grantsWithRoles(url, { fetch: scoped, root: storage, kind })).filter(
        ({ agent, inherited }) => !inherited && agent.type === "webid" && agent.id === recipient,
      );
      // The role projection hides access that fits no role (Read and Append, say), so the raw
      // policy decides whether anything of theirs is left on the place.
      const held = await holdsDirectAccess(scoped, storage, options.webId, url, recipient);
      if (direct.some(({ role }) => role !== current.targetRoles[url]) || (held && !direct.length))
        throw new HistoryChangedError(
          "Their access was changed after this approval; change it in Permissions instead",
        );
      if (held || direct.length) holding.push(url);
    }
    for (const kind of ["folder", "resource"] as const) {
      const urls = holding.filter((url) => url.endsWith("/") === (kind === "folder"));
      if (!urls.length) continue;
      const result = await removeGrant(
        urls,
        { type: "webid", id: recipient },
        { fetch: scoped, webId: options.webId, root: storage, kind },
      );
      removed.push(...result.applied);
      failed.push(...result.failed);
    }
    if (failed.length) throw new HistoryRevokeError(removed, failed);
    await updateRecord(scoped, grant.url, (dataset) => {
      const node = subjectOf(dataset, grant.url);
      if (node.texts(ACCM.revokedAt).length) return false;
      RequiredAs.object(node, ACCM.revokedAt, when, LiteralFrom.dateTime);
      return true;
    });
  }
  await updateRecord(scoped, entry.receipt, (dataset) => {
    const node = subjectOf(dataset, entry.receipt);
    if (node.iris(DPV_TERMS.hasConsentStatus).includes(DPV_TERMS.ConsentWithdrawn)) return false;
    RequiredAs.object(
      node,
      DPV_TERMS.hasConsentStatus,
      DPV_TERMS.ConsentWithdrawn,
      NamedNodeFrom.string,
    );
    RequiredAs.object(node, ACCM.revokedAt, when, LiteralFrom.dateTime);
    return true;
  });
}

const STATUS_TEXT: Readonly<Record<HistoryStatus, string>> = {
  granted: "Shared",
  denied: "Denied",
  revoked: "Access removed",
  unknown: "Status unknown",
};

export function statusText(status: HistoryStatus): string {
  return STATUS_TEXT[status];
}

/** The recipient's host: the record holds only a WebID, and a host is all it proves. */
export function recipientLabel(entry: Pick<HistoryEntry, "recipient">): string {
  return (entry.recipient && httpUrl(entry.recipient)?.host) || "Someone";
}

export function placesText(count: number): string {
  return count === 1 ? "1 place" : `${count} places`;
}
