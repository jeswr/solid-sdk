// AUTHORED-BY Codex GPT-6
// Port of access-manager approval.ts invariants:
// resolve ONCE → Pending/Approving CAS with deterministic grantId + snapshot →
// create-only grant + receipt → ACL writes → Approving/Approved CAS.
// Recovery is forward-only; a 412 always re-reads and observes the winner.
import { isHttpIri } from "@jeswr/rdf-serialize";
import { policyToRdf } from "@jeswr/solid-odrl";
import { termsEqual } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { Store } from "n3";
import {
  accessModel,
  applyGrant,
  ensureOwnerOnlyContainer,
  UnsupportedAccessModelError,
} from "./acl.js";
import {
  httpUrl,
  MAX_MEMBERS,
  publicHttpsUrl,
  publicTransport,
  put,
  RequestConflictError,
  read,
  requireStrongEtag,
  scoped,
  transport,
} from "./http.js";
import { type AccessRequestEntry, type ParsedRequest, project, type RequestMode } from "./inbox.js";
import { set, turtle, values } from "./rdf.js";
import { resolveTargets } from "./targets.js";
import { ACCM, DCT, DPV, LDP, RDF } from "./vocab.js";

export interface RequestDecision {
  approve: boolean;
  /** Viewer narrows to Read; editor grants only the requested Read/Write/Append modes. */
  role?: "viewer" | "editor";
  /** Receipt metadata only. WAC cannot enforce expiry or revoke automatically. */
  expiresAt?: Date;
  /** Must be a nonempty subset of the request's dataTypes. */
  dataTypes?: string[];
}

export interface DecideOptions {
  fetch: typeof fetch;
  webId: string;
  storage: string;
  /** Owner Type Index URL or an already-read owner-controlled index dataset. */
  typeIndex?: string | DatasetCore;
  /**
   * Unauthenticated transport for requester discovery and delivery, and for an owner profile
   * hosted outside storage; forced to `credentials: "omit"` and `redirect: "error"`. Without
   * it the requester is not notified (`notified: false`). Requester profile and inbox URLs must
   * be public HTTPS (no loopback, private or local-name hosts). That check reads only the URL,
   * so in Node pass a fetch that also checks resolved addresses, such as `createGuardedFetch()`
   * from `@jeswr/guarded-fetch`.
   */
  publicFetch?: typeof fetch;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface DecisionResult {
  status: "approved" | "denied";
  grantUrl?: string;
  receiptUrl: string;
  notified: boolean;
  /** Always false: expiresAt is receipt metadata; WAC does not enforce it. */
  expiryEnforced: false;
}

interface Snapshot {
  grantId: string;
  targets: string[];
  agent: string;
  /** Union of targetModes; kept for the receipt and older readers. */
  modes: RequestMode[];
  /** Modes per target, derived only from the approved data types' own rules. */
  targetModes: Record<string, RequestMode[]>;
  dataTypes: string[];
  schemaVersion: "1";
  purpose?: string;
  expiresAt?: string;
  decidedAt: string;
}

/** sha256(requestId, sorted target set, ownerWebID, schemaVersion), as in access-manager. */
export async function deriveGrantId(
  requestId: string,
  targets: readonly string[],
  owner: string,
  schemaVersion = "1",
): Promise<string> {
  const canonical = JSON.stringify({
    requestId,
    targets: [...targets].sort(),
    owner,
    schemaVersion,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function current(id: string, fetchFn: typeof fetch) {
  const resource = await read(id, fetchFn);
  if (!resource) throw new Error("Request no longer exists");
  const request = project(id, resource.dataset, resource.etag);
  if (request.entry.status === "unreadable") throw new Error("Unreadable access request");
  return { ...request, entry: request.entry };
}

async function cas(request: ParsedRequest, fetchFn: typeof fetch): Promise<void> {
  if (!(await put(request.entry.id, await turtle(request.dataset), fetchFn, request.etag))) {
    const winner = await read(request.entry.id, fetchFn);
    const status = winner
      ? project(request.entry.id, winner.dataset, winner.etag).entry.status
      : "gone";
    throw new RequestConflictError(request.entry.id, status);
  }
}

function recordsFolder(storage: string): string {
  return new URL("settings/access-records/", storage).href;
}

function urls(storage: string, id: string) {
  const base = recordsFolder(storage);
  return {
    grantUrl: scoped(storage, `${base}grant-${id}.ttl`),
    receiptUrl: scoped(storage, `${base}receipt-${id}.ttl`),
  };
}

/**
 * The owner's own record of an approval in progress. Inbox notifications are authored by the
 * requester, so a claimed `Approving` state or snapshot inside one proves nothing: recovery only
 * ever resumes from this create-only document in the owner-only records folder.
 */
async function intentUrl(storage: string, id: string, owner: string): Promise<string> {
  const key = await deriveGrantId(id, [], owner, "intent-1");
  return scoped(storage, `${recordsFolder(storage)}intent-${key}.ttl`);
}

async function readIntent(
  url: string,
  id: string,
  fetchFn: typeof fetch,
): Promise<Snapshot | undefined> {
  const doc = await read(url, fetchFn);
  if (!doc) return undefined;
  const stored = values(doc.dataset, url, `${ACCM.ns}snapshot`)[0];
  if (values(doc.dataset, url, ACCM.requestRef)[0] !== id || stored === undefined)
    throw new Error("Approval record does not match this request");
  return JSON.parse(stored) as Snapshot;
}

async function writeIntent(
  url: string,
  id: string,
  snapshot: Snapshot,
  fetchFn: typeof fetch,
): Promise<boolean> {
  const dataset = new Store();
  set(dataset, url, ACCM.requestRef, id, true);
  set(dataset, url, ACCM.grantId, snapshot.grantId);
  set(dataset, url, `${ACCM.ns}snapshot`, JSON.stringify(snapshot));
  return put(url, await turtle(dataset), fetchFn, null, true);
}

async function receipt(
  url: string,
  id: string,
  options: DecideOptions,
  recipient: string,
  decidedAt: string,
  purpose: string | undefined,
  snapshot?: Snapshot,
): Promise<string> {
  const dataset = new Store();
  set(dataset, url, RDF.type, DPV.ConsentRecord, true);
  set(dataset, url, DPV.hasDataSubject, options.webId, true);
  set(dataset, url, DPV.hasRecipient, recipient, true);
  set(dataset, url, DPV.hasLegalBasis, DPV.Consent, true);
  set(dataset, url, DPV.hasConsentStatus, snapshot ? DPV.ConsentGiven : DPV.ConsentRefused, true);
  set(dataset, url, ACCM.requestRef, id, true);
  set(dataset, url, DCT.created, new Date(decidedAt));
  if (purpose !== undefined) set(dataset, url, DPV.hasPurpose, purpose, isHttpIri(purpose));
  if (snapshot) {
    set(dataset, url, ACCM.grantId, snapshot.grantId);
    set(dataset, url, ACCM.grantRef, urls(options.storage, snapshot.grantId).grantUrl, true);
    if (snapshot.expiresAt !== undefined)
      set(dataset, url, DPV.hasExpiryTime, new Date(snapshot.expiresAt));
  }
  return turtle(dataset);
}

async function validateSnapshot(
  snapshot: Snapshot,
  id: string,
  options: DecideOptions,
): Promise<void> {
  if (
    snapshot.schemaVersion !== "1" ||
    snapshot.targets.length === 0 ||
    snapshot.targets.length > MAX_MEMBERS ||
    snapshot.modes.length === 0 ||
    !snapshot.modes.every((mode) => ["read", "write", "append"].includes(mode)) ||
    typeof snapshot.targetModes !== "object" ||
    snapshot.targetModes === null ||
    Object.keys(snapshot.targetModes).length !== snapshot.targets.length ||
    !snapshot.targets.every((target) => {
      const modes = Object.hasOwn(snapshot.targetModes, target)
        ? snapshot.targetModes[target]
        : undefined;
      return (
        Array.isArray(modes) &&
        modes.length > 0 &&
        modes.every((mode) => snapshot.modes.includes(mode))
      );
    }) ||
    snapshot.grantId !== (await deriveGrantId(id, snapshot.targets, options.webId))
  ) {
    throw new Error("Invalid persisted approval snapshot");
  }
  httpUrl(snapshot.agent);
  for (const target of snapshot.targets) {
    scoped(options.storage, target);
    if (/\.(acl|acr)(?:[?#]|$)/i.test(target) || target.includes("#"))
      throw new Error("Invalid snapshot target");
  }
}

async function complete(
  request: ParsedRequest,
  snapshot: Snapshot,
  options: DecideOptions,
  fetchFn: typeof fetch,
): Promise<{ grantUrl: string; receiptUrl: string }> {
  const id = request.entry.id;
  await validateSnapshot(snapshot, id, options);
  const locations = urls(options.storage, snapshot.grantId);
  const grant = new Store(
    policyToRdf({
      id: locations.grantUrl,
      type: "Agreement",
      assigner: options.webId,
      assignee: snapshot.agent,
      permissions: snapshot.targets.flatMap((target) =>
        (snapshot.targetModes[target] as RequestMode[]).map((mode) => ({
          type: "permission" as const,
          action: mode,
          target,
          assignee: snapshot.agent,
          assigner: options.webId,
        })),
      ),
    }),
  );
  set(grant, locations.grantUrl, ACCM.grantId, snapshot.grantId);
  set(grant, locations.grantUrl, ACCM.requestRef, id, true);
  set(grant, locations.grantUrl, DCT.created, new Date(snapshot.decidedAt));
  // 412 on these writes means a previous attempt created the same deterministic record.
  await put(locations.grantUrl, await turtle(grant), fetchFn, null, true);
  await put(
    locations.receiptUrl,
    await receipt(
      locations.receiptUrl,
      id,
      options,
      snapshot.agent,
      snapshot.decidedAt,
      snapshot.purpose,
      snapshot,
    ),
    fetchFn,
    null,
    true,
  );
  for (const target of snapshot.targets) {
    const model = await accessModel({ fetch: fetchFn, storage: options.storage, target });
    if (model !== "wac") throw new UnsupportedAccessModelError(model);
    await applyGrant(
      target,
      options.storage,
      options.webId,
      snapshot.agent,
      snapshot.targetModes[target] as RequestMode[],
      fetchFn,
    );
  }
  // A competing resumer can finish first. Verify the final state after every lost CAS.
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await current(id, fetchFn);
    if (fresh.entry.status === "approved") return locations;
    if (fresh.entry.status !== "approving") throw new Error("Approval cannot move backwards");
    set(fresh.dataset, id, ACCM.status, ACCM.Approved, true);
    set(fresh.dataset, id, ACCM.grantRef, locations.grantUrl, true);
    if (await put(id, await turtle(fresh.dataset), fetchFn, fresh.etag)) return locations;
  }
  const final = await current(id, fetchFn);
  if (final.entry.status !== "approved") throw new RequestConflictError(id, final.entry.status);
  return locations;
}

async function notify(
  id: string,
  requester: string,
  approved: boolean,
  options: DecideOptions,
): Promise<boolean> {
  // Only an explicitly supplied unauthenticated transport may contact the requester: a
  // global fetch may have been patched to attach the owner's credentials.
  if (options.publicFetch === undefined) return false;
  try {
    const fetchFn = publicTransport(options.publicFetch, options.signal);
    const profile = await read(publicHttpsUrl(requester), fetchFn);
    if (!profile) return false;
    const inbox = values(profile.dataset, requester, LDP.inbox)[0];
    if (inbox === undefined) return false;
    publicHttpsUrl(inbox);
    const activity = new Store();
    const subject = `${id}#decision`;
    const as = "https://www.w3.org/ns/activitystreams#";
    set(activity, subject, RDF.type, `${as}${approved ? "Accept" : "Reject"}`, true);
    set(activity, subject, `${as}actor`, options.webId, true);
    set(activity, subject, `${as}object`, id, true);
    const response = await fetchFn(inbox, {
      method: "POST",
      headers: { "content-type": "text/turtle" },
      body: await turtle(activity),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Decide an explicitly user-confirmed request; entry.id is re-read, never trusted as state.
 * Approving retries use the persisted snapshot and ignore new decision overrides.
 * Inbox children must be owner-write-only (public Append to the inbox is fine): a hash
 * is an idempotency key, not an authenticity proof for requester-writable snapshots.
 */
export async function decide(
  entry: Pick<AccessRequestEntry, "id">,
  decision: RequestDecision,
  options: DecideOptions,
): Promise<DecisionResult> {
  httpUrl(options.webId);
  const storage = scoped(
    options.storage,
    options.storage.endsWith("/") ? options.storage : `${options.storage}/`,
  );
  options = { ...options, storage };
  const id = scoped(storage, entry.id);
  const fetchFn = transport(options.fetch, options.signal);
  const model = await accessModel({ fetch: fetchFn, storage });
  if (model !== "wac") throw new UnsupportedAccessModelError(model);
  const request = await current(id, fetchFn);
  const parsed = request.entry;
  const now = (options.now ?? (() => new Date()))().toISOString();
  const records = recordsFolder(storage);
  const intent = await intentUrl(storage, id, options.webId);
  const resuming = parsed.status === "approving" || parsed.status === "approved";
  const recorded = resuming ? await readIntent(intent, id, fetchFn) : undefined;
  // A claimed approval with no owner record was written by the requester: it can still be denied.
  const claimed = resuming && recorded === undefined;
  if (!decision.approve) {
    if (parsed.status !== "pending" && parsed.status !== "denied" && !claimed)
      throw new Error("Cannot deny an approval");
    if (parsed.status !== "denied") requireStrongEtag(request.etag);
    await ensureOwnerOnlyContainer(records, storage, options.webId, fetchFn);
    const decidedAt = parsed.status === "denied" ? (parsed.decidedAt ?? now) : now;
    if (parsed.status !== "denied") {
      set(request.dataset, id, ACCM.status, ACCM.Denied, true);
      set(request.dataset, id, `${ACCM.ns}decidedAt`, decidedAt);
      await cas(request, fetchFn);
    }
    const denialId = await deriveGrantId(id, [], options.webId);
    const { receiptUrl } = urls(storage, denialId);
    await put(
      receiptUrl,
      await receipt(receiptUrl, id, options, parsed.requester, decidedAt, parsed.purpose),
      fetchFn,
      null,
      true,
    );
    return {
      status: "denied",
      receiptUrl,
      notified: await notify(id, parsed.requester, false, options),
      expiryEnforced: false,
    };
  }
  if (parsed.status === "denied") throw new Error("Cannot approve a denial");
  if (claimed) throw new Error("This request claims an approval that was never recorded");
  if (parsed.status !== "approved") requireStrongEtag(request.etag);
  let snapshot: Snapshot;
  if (parsed.status === "pending") {
    const dataTypes = [...new Set(decision.dataTypes ?? parsed.dataTypes)];
    if (dataTypes.length === 0 || !dataTypes.every((type) => parsed.dataTypes.includes(type)))
      throw new Error("Approved dataTypes must be a nonempty requested subset");
    // Concrete target claims never override class registrations or storage confinement.
    for (const target of request.targets) {
      if (!parsed.dataTypes.some((type) => termsEqual(type, target))) scoped(storage, target);
    }
    // Each approved type grants only its own requested modes, so narrowing the data types
    // can never carry a mode that was requested for an excluded type.
    const publicFetch = options.publicFetch && publicTransport(options.publicFetch, options.signal);
    const perTarget = new Map<string, Set<RequestMode>>();
    for (const type of dataTypes) {
      const typeModes = (parsed.modesByType[type] ?? []).filter(
        (mode) => decision.role !== "viewer" || mode === "read",
      );
      if (typeModes.length === 0) continue;
      for (const target of await resolveTargets([type], options, fetchFn, publicFetch)) {
        const modes = perTarget.get(target) ?? new Set<RequestMode>();
        for (const mode of typeModes) modes.add(mode);
        perTarget.set(target, modes);
      }
    }
    if (perTarget.size === 0) throw new Error("Decision grants no requested modes");
    if (perTarget.size > MAX_MEMBERS) throw new RangeError("Invalid resolved target count");
    const targets = [...perTarget.keys()].sort();
    const targetModes = Object.fromEntries(
      targets.map((target) => [target, [...(perTarget.get(target) as Set<RequestMode>)].sort()]),
    ) as Record<string, RequestMode[]>;
    const modes = [...new Set(Object.values(targetModes).flat())].sort();
    for (const target of targets) {
      const targetModel = await accessModel({ fetch: fetchFn, storage, target });
      if (targetModel !== "wac") throw new UnsupportedAccessModelError(targetModel);
    }
    snapshot = {
      grantId: await deriveGrantId(id, targets, options.webId),
      targets,
      agent: parsed.requester,
      modes,
      targetModes,
      dataTypes,
      schemaVersion: "1",
      decidedAt: now,
      ...(parsed.purpose !== undefined && { purpose: parsed.purpose }),
      ...(decision.expiresAt !== undefined && { expiresAt: decision.expiresAt.toISOString() }),
    };
    // Records (including this pin) only ever live in a folder only the owner can read.
    await ensureOwnerOnlyContainer(records, storage, options.webId, fetchFn);
    // Pin the decision in the owner's records first. If an earlier attempt already pinned one,
    // resume that decision (forward-only) and ignore this call's overrides.
    if (!(await writeIntent(intent, id, snapshot, fetchFn))) {
      snapshot = (await readIntent(intent, id, fetchFn)) as Snapshot;
    }
    await validateSnapshot(snapshot, id, options);
    // Ignore all requester-supplied grant/receipt/snapshot IRIs and persist our own tuple.
    set(request.dataset, id, ACCM.status, ACCM.Approving, true);
    set(request.dataset, id, ACCM.grantId, snapshot.grantId);
    set(request.dataset, id, ACCM.grantRef, undefined, true);
    set(request.dataset, id, `${ACCM.ns}snapshot`, undefined);
    set(request.dataset, id, `${ACCM.ns}decidedAt`, snapshot.decidedAt);
    await cas(request, fetchFn);
  } else {
    // Resume only from the owner's record, never from the requester-authored notification.
    snapshot = recorded as Snapshot;
    await ensureOwnerOnlyContainer(records, storage, options.webId, fetchFn);
  }
  await validateSnapshot(snapshot, id, options);
  const locations =
    parsed.status === "approved"
      ? urls(storage, snapshot.grantId)
      : await complete(request, snapshot, options, fetchFn);
  return {
    status: "approved",
    ...locations,
    notified: await notify(id, snapshot.agent, true, options),
    expiryEnforced: false,
  };
}
