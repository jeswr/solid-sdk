// AUTHORED-BY Codex GPT-6.1-Sol
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
  checkGrant,
  ensureOwnerOnlyContainer,
  ROLE_MODES,
  recordsKey,
  roleFor,
  UnsupportedAccessModelError,
} from "./acl.js";
import { DecisionPreviewConflictError } from "./errors.js";
import {
  agentUrl,
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
  /**
   * Viewer narrows to requested Read. Otherwise each target gets the role its requested modes map
   * to: Editor (Read, Write, Append) when Write was asked for, else Viewer.
   */
  role?: "viewer" | "editor";
  /** Receipt metadata only. WAC/ACP roles cannot enforce expiry or revoke automatically. */
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
  /** Refuse changed consent scope before any writes. May be JSON round-tripped. */
  expected?: DecisionPreview;
}

export interface DecisionTarget {
  url: string;
  role: "viewer" | "editor";
  modes: RequestMode[];
  /** Source classes; absent only for legacy pinned records that did not record provenance. */
  dataTypes?: string[];
}

/** A read-only, JSON-serialisable description of the decision's resolved consent scope. */
export interface DecisionPreview {
  requestId: string;
  webId: string;
  storage: string;
  requester: string;
  approve: boolean;
  model: "wac" | "acp";
  dataTypes: string[];
  targets: DecisionTarget[];
  /** Receipt metadata, in ISO format; never enforced by access rules. */
  expiresAt?: string;
  purpose?: string;
}

export interface DecisionResult {
  status: "approved" | "denied";
  grantUrl?: string;
  receiptUrl: string;
  notified: boolean;
  /** Recorded approval values actually applied, including on a completed-decision replay. */
  choices?: {
    dataTypes: string[];
    /** Strongest applied role. Use targetRoles for the exact role on each target. */
    role: "viewer" | "editor";
    targetRoles: Record<string, "viewer" | "editor">;
    expiresAt?: Date;
  };
  /** Always false: expiresAt is receipt metadata; WAC/ACP roles do not enforce it. */
  expiryEnforced: false;
}

/** A readable request, as decide() projects it. */
type RequestEntry = Exclude<AccessRequestEntry, { status: "unreadable" }>;

interface Snapshot {
  grantId: string;
  targets: string[];
  agent: string;
  /** Union of targetModes; kept for the receipt and older readers. */
  modes: RequestMode[];
  /** Modes per target, derived only from the approved data types' own rules. */
  targetModes: Record<string, RequestMode[]>;
  /** Missing only on legacy records, whose target provenance was not persisted. */
  targetDataTypes?: Record<string, string[]>;
  dataTypes: string[];
  schemaVersion: "1";
  /** Missing on older WAC records. A resumed approval cannot change models. */
  model?: "wac" | "acp";
  purpose?: string;
  expiresAt?: string;
  decidedAt: string;
  /** The owner's own choices, so a resumed approval can refuse different ones. */
  chosen: { dataTypes: string[]; viewer: boolean; role?: "viewer" | "editor" | null };
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

/** The conflict to report after losing a race: re-read the request and name its real status. */
async function conflict(id: string, fetchFn: typeof fetch): Promise<RequestConflictError> {
  const winner = await read(id, fetchFn);
  const status = winner ? project(id, winner.dataset, winner.etag).entry.status : "gone";
  return new RequestConflictError(id, status);
}

async function cas(request: ParsedRequest, fetchFn: typeof fetch): Promise<void> {
  if (!(await put(request.entry.id, await turtle(request.dataset), fetchFn, request.etag)))
    throw await conflict(request.entry.id, fetchFn);
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

type Outcome = "approving" | "approved" | "denied";
const OUTCOME = `${ACCM.ns}outcome`;
const MAX_SLOTS = 32;

interface DecisionRecord {
  outcome: Outcome;
  snapshot?: Snapshot;
  etag: string | null;
}

/** The owner's decision record for one decision on a request, in the owner-only folder. */
interface Slot {
  url: string;
  record?: DecisionRecord;
}

/**
 * The owner's own record of each decision. Inbox notifications are authored by the requester, so
 * a claimed state or snapshot inside one proves nothing: recovery only ever resumes from these
 * create-only records. Their names derive from the folder's secret records key, so nothing written
 * before the folder was sealed can sit at one, and from what was asked plus a generation number, so
 * a new request at a reused notification URL gets its own record. A finished record (approved or
 * denied) only matches a request in that same state. An approval in progress matches whatever
 * state the request is in, so a denial that crashed before settling it still consumes it on retry
 * instead of leaving it for a later identical request to resume.
 */
async function findSlot(
  storage: string,
  key: string | undefined,
  entry: RequestEntry,
  owner: string,
  fetchFn: typeof fetch,
): Promise<Slot | undefined> {
  if (key === undefined) return undefined;
  const asked = Object.entries(entry.modesByType).map(
    ([type, modes]) => `${type} ${[...modes].sort().join(",")}`,
  );
  for (let n = 0; n < MAX_SLOTS; n++) {
    const name = await deriveGrantId(
      entry.id,
      [`key ${key}`, `agent ${entry.requester}`, `generation ${n}`, ...asked],
      owner,
      "decision-1",
    );
    const url = scoped(storage, `${recordsFolder(storage)}decision-${name}.ttl`);
    const record = await readRecord(url, entry.id, fetchFn);
    if (!record) return { url };
    if (record.outcome === "approving" || record.outcome === entry.status) return { url, record };
  }
  throw new Error("This request has been decided too many times");
}

async function readRecord(
  url: string,
  id: string,
  fetchFn: typeof fetch,
): Promise<DecisionRecord | undefined> {
  const doc = await read(url, fetchFn);
  if (!doc) return undefined;
  const outcome = values(doc.dataset, url, OUTCOME)[0];
  const stored = values(doc.dataset, url, `${ACCM.ns}snapshot`)[0];
  if (
    values(doc.dataset, url, ACCM.requestRef)[0] !== id ||
    (outcome !== "approving" && outcome !== "approved" && outcome !== "denied") ||
    (outcome !== "denied") !== (stored !== undefined)
  )
    throw new Error("Decision record does not match this request");
  return {
    outcome,
    etag: doc.etag,
    ...(stored !== undefined && { snapshot: JSON.parse(stored) as Snapshot }),
  };
}

async function recordBody(
  url: string,
  id: string,
  outcome: Outcome,
  snapshot?: Snapshot,
): Promise<string> {
  const dataset = new Store();
  set(dataset, url, ACCM.requestRef, id, true);
  set(dataset, url, OUTCOME, outcome);
  if (snapshot) {
    set(dataset, url, ACCM.grantId, snapshot.grantId);
    set(dataset, url, `${ACCM.ns}snapshot`, JSON.stringify(snapshot));
  }
  return turtle(dataset);
}

/**
 * Move a decision record forward to its final outcome. Only an approval in progress may change:
 * an approval becomes approved once the request is, and a pinned approval that never reached
 * Approving becomes a denial when the owner denies instead.
 */
async function settleRecord(
  slot: Slot,
  id: string,
  outcome: "approved" | "denied",
  snapshot: Snapshot | undefined,
  fetchFn: typeof fetch,
): Promise<void> {
  let record = slot.record;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (record?.outcome === outcome) return;
    if (record !== undefined && record.outcome !== "approving")
      throw new Error("This decision was already recorded differently");
    const body = await recordBody(slot.url, id, outcome, snapshot);
    if (await put(slot.url, body, fetchFn, record ? record.etag : null, record === undefined))
      return;
    record = await readRecord(slot.url, id, fetchFn);
  }
  throw new Error("The decision record kept changing");
}

/** New pins preserve omission; legacy pins accept omission or their inferred applied role. */
function assertSameChoices(snapshot: Snapshot, decision: RequestDecision): void {
  const pinned = snapshot.chosen;
  if (pinned.role === undefined && decision.role !== undefined) {
    const role = roleFor(snapshot.modes);
    if (decision.role !== role)
      throw new Error(
        `An earlier approval of this request is still finishing with role "${role}"; omit role or repeat "${role}" to resume it`,
      );
  }
  if (
    (decision.dataTypes !== undefined &&
      [...new Set(decision.dataTypes)].sort().join("\n") !== pinned.dataTypes.join("\n")) ||
    (pinned.role !== undefined && (decision.role === "viewer") !== pinned.viewer) ||
    (pinned.role !== undefined && decision.role !== (pinned.role ?? undefined)) ||
    decision.expiresAt?.toISOString() !== snapshot.expiresAt
  )
    throw new Error(
      "An earlier approval of this request is still finishing with different choices; finish it first",
    );
}

/** Ignore all requester-supplied grant/receipt/snapshot IRIs and persist our own tuple. */
async function moveToApproving(
  request: ParsedRequest,
  id: string,
  snapshot: Snapshot,
  fetchFn: typeof fetch,
): Promise<void> {
  set(request.dataset, id, ACCM.status, ACCM.Approving, true);
  set(request.dataset, id, ACCM.grantId, snapshot.grantId);
  set(request.dataset, id, ACCM.grantRef, undefined, true);
  set(request.dataset, id, `${ACCM.ns}snapshot`, undefined);
  set(request.dataset, id, `${ACCM.ns}decidedAt`, snapshot.decidedAt);
  await cas(request, fetchFn);
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

/**
 * A pinned decision belongs to this request only if it names this requester, approves only data
 * types this request asked for, and grants no mode beyond the role those types' requests map to.
 */
function withinRequest(snapshot: Snapshot, entry: RequestEntry): boolean {
  if (
    snapshot.agent !== entry.requester ||
    !Array.isArray(snapshot.dataTypes) ||
    snapshot.dataTypes.length === 0 ||
    !snapshot.dataTypes.every((type) => Object.hasOwn(entry.modesByType, type))
  )
    return false;
  const asked = snapshot.dataTypes.flatMap((type) => entry.modesByType[type] as RequestMode[]);
  const allowed = asked.includes("write")
    ? ROLE_MODES.editor
    : asked.includes("read")
      ? ROLE_MODES.viewer
      : [];
  return Object.values(snapshot.targetModes ?? {}).every(
    (modes) => Array.isArray(modes) && modes.every((mode) => allowed.includes(mode)),
  );
}

async function validateSnapshot(
  snapshot: Snapshot,
  entry: RequestEntry,
  slotUrl: string,
  options: DecideOptions,
): Promise<void> {
  if (
    !withinRequest(snapshot, entry) ||
    snapshot.schemaVersion !== "1" ||
    !Array.isArray(snapshot.chosen?.dataTypes) ||
    typeof snapshot.chosen.viewer !== "boolean" ||
    (snapshot.chosen.role != null && !["viewer", "editor"].includes(snapshot.chosen.role)) ||
    (snapshot.model !== undefined && snapshot.model !== "wac" && snapshot.model !== "acp") ||
    snapshot.targets.length === 0 ||
    snapshot.targets.length > MAX_MEMBERS ||
    snapshot.modes.length === 0 ||
    !snapshot.modes.every((mode) => ["read", "write", "append"].includes(mode)) ||
    typeof snapshot.targetModes !== "object" ||
    snapshot.targetModes === null ||
    Object.keys(snapshot.targetModes).length !== snapshot.targets.length ||
    (snapshot.targetDataTypes !== undefined &&
      (snapshot.targetDataTypes === null ||
        typeof snapshot.targetDataTypes !== "object" ||
        Object.keys(snapshot.targetDataTypes).length !== snapshot.targets.length ||
        !snapshot.targets.every((target) => {
          const types = (snapshot.targetDataTypes as Record<string, string[]>)[target];
          return (
            Array.isArray(types) &&
            types.length > 0 &&
            types.every((type) => snapshot.dataTypes.includes(type))
          );
        }))) ||
    !snapshot.targets.every((target) => {
      const modes = Object.hasOwn(snapshot.targetModes, target)
        ? snapshot.targetModes[target]
        : undefined;
      // Every pinned grant is exactly a role, and no wider than the approved types asked for.
      return (
        Array.isArray(modes) &&
        Object.values(ROLE_MODES).some((role) => role.join() === [...modes].sort().join()) &&
        modes.every((mode) => snapshot.modes.includes(mode))
      );
    }) ||
    snapshot.grantId !== (await deriveGrantId(slotUrl, snapshot.targets, options.webId))
  ) {
    throw new Error("Invalid persisted approval snapshot");
  }
  agentUrl(snapshot.agent);
  for (const target of snapshot.targets) assertGrantable(target, options.storage);
}

/**
 * Targets an approval may never grant: anything outside storage, access-control and metadata
 * documents (`.acl`, `.acr`, `.meta`), queries, fragments, empty path segments, percent-encodings
 * a server may decode into another name (unreserved characters, `%`, `/`, `\`, control characters), the storage root (with or
 * without its trailing slash), and the owner's settings (type indexes, preferences, records),
 * compared case-insensitively, and path segments ending in a dot or space or containing `::`
 * (Windows aliases). Ordinary encoded names (spaces, non-ASCII) stay grantable. The
 * target is compared by its decoded path, never as a raw string.
 */
function assertGrantable(target: string, storage: string): void {
  // scoped() already refused any other origin, so the path is where the target points.
  const { pathname } = new URL(scoped(storage, target));
  const root = new URL(storage).pathname;
  const ambiguous = [...pathname.matchAll(/%([0-9a-f]{2})/gi)].some(([, hex]) => {
    const code = Number.parseInt(hex as string, 16);
    return code < 0x20 || code === 0x7f || /[A-Za-z0-9\-._~%/\\]/.test(String.fromCharCode(code));
  });
  if (target.includes("?") || target.includes("#") || pathname.includes("//") || ambiguous)
    throw new Error(`${target} can't be shared through an access request`);
  const path = decoded(pathname);
  const base = decoded(root) as string;
  if (
    path === undefined ||
    /\.(acl|acr|meta)$/.test(path) ||
    // Windows backends drop a trailing dot or space and expose `name::$DATA` streams.
    /[. ](?:\/|$)|::/.test(path) ||
    path === base ||
    path === base.slice(0, -1) ||
    path === `${base}settings` ||
    path.startsWith(`${base}settings/`)
  )
    throw new Error(`${target} can't be shared through an access request`);
}

/** The lower-cased decoded path, or undefined when its encoding is not valid UTF-8. */
function decoded(path: string): string | undefined {
  try {
    // Upper then lower case folds letters such as the long s into ASCII, as case-insensitive
    // filesystems do.
    return decodeURIComponent(path).toUpperCase().toLowerCase();
  } catch {
    return undefined;
  }
}

/** Exactly the grant checks shared by previews, initial decisions and recovery. */
async function preflight(
  snapshot: Pick<Snapshot, "targets" | "targetModes" | "agent">,
  options: DecideOptions,
  fetchFn: typeof fetch,
  model: "wac" | "acp",
): Promise<void> {
  // Never grant an agent class, whichever path built the snapshot.
  agentUrl(snapshot.agent);
  // Revalidate every target before records or access writes, including on recovery.
  for (const target of snapshot.targets) {
    const actual = await accessModel({ fetch: fetchFn, storage: options.storage, target });
    if (actual !== model)
      throw new UnsupportedAccessModelError(actual === "acp" ? "acp" : "unknown");
    await checkGrant(
      target,
      options.storage,
      options.webId,
      snapshot.agent,
      snapshot.targetModes[target] as RequestMode[],
      fetchFn,
      model,
    );
  }
}

/** Canonical consent scope; record IDs, clocks and HTTP validators are deliberately excluded. */
function previewFor(
  request: RequestEntry,
  decision: RequestDecision,
  options: DecideOptions,
  model: "wac" | "acp",
  snapshot?: Snapshot,
): DecisionPreview {
  const purpose = snapshot ? snapshot.purpose : request.purpose;
  return {
    requestId: request.id,
    webId: options.webId,
    storage: options.storage,
    requester: request.requester,
    approve: decision.approve,
    model,
    dataTypes: snapshot ? [...snapshot.dataTypes].sort() : [],
    targets: snapshot
      ? snapshot.targets.map((url) => ({
          url,
          role: roleFor(snapshot.targetModes[url] as RequestMode[]),
          modes: [...(snapshot.targetModes[url] as RequestMode[])],
          ...(snapshot.targetDataTypes && {
            dataTypes: [...(snapshot.targetDataTypes[url] as string[])],
          }),
        }))
      : [],
    ...(snapshot?.expiresAt !== undefined && { expiresAt: snapshot.expiresAt }),
    ...(purpose !== undefined && { purpose }),
  };
}

function assertExpected(actual: DecisionPreview, expected: DecisionPreview | undefined): void {
  const canonical = (preview: DecisionPreview) =>
    JSON.stringify({
      requestId: preview.requestId,
      webId: preview.webId,
      storage: preview.storage,
      requester: preview.requester,
      approve: preview.approve,
      model: preview.model,
      dataTypes: [...preview.dataTypes].sort(),
      targets: preview.targets
        .map((target) => ({
          url: target.url,
          role: target.role,
          modes: [...target.modes].sort(),
          dataTypes: target.dataTypes && [...target.dataTypes].sort(),
        }))
        .sort((a, b) => a.url.localeCompare(b.url)),
      expiresAt: preview.expiresAt,
      purpose: preview.purpose,
    });
  if (expected !== undefined && canonical(actual) !== canonical(expected))
    throw new DecisionPreviewConflictError();
}

async function complete(
  request: ParsedRequest,
  snapshot: Snapshot,
  options: DecideOptions,
  fetchFn: typeof fetch,
): Promise<{ grantUrl: string; receiptUrl: string }> {
  const id = request.entry.id;
  const locations = urls(options.storage, snapshot.grantId);
  const model = snapshot.model ?? "wac";
  await preflight(snapshot, options, fetchFn, model);
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
    try {
      await applyGrant(
        target,
        options.storage,
        options.webId,
        snapshot.agent,
        snapshot.targetModes[target] as RequestMode[],
        fetchFn,
        model,
      );
    } catch (error) {
      // A competing resumer may have finished while this one lost a write race. A failed re-read
      // never hides the original error.
      const status = await current(id, fetchFn).then(
        (fresh) => fresh.entry.status,
        () => undefined,
      );
      if (status === "approved") return locations;
      throw error;
    }
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
 * Supports WAC and the roles layer's CSS ACP subset; unknown/mixed models and unsupported
 * ACP dialects fail closed. Storage, records and targets must agree on the model.
 * Approving retries use the persisted snapshot; omitted role/expiry are compared as values.
 * Inbox children must be owner-write-only (public Append to the inbox is fine): a hash
 * is an idempotency key, not an authenticity proof for requester-writable snapshots.
 */
export async function decide(
  entry: Pick<AccessRequestEntry, "id">,
  decision: RequestDecision,
  options: DecideOptions,
): Promise<DecisionResult> {
  return (await runDecision(entry, decision, options, false)) as DecisionResult;
}

/** Resolve and check exactly what decide() would do, without sealing records or writing. */
export async function previewDecision(
  entry: Pick<AccessRequestEntry, "id">,
  decision: RequestDecision,
  options: Omit<DecideOptions, "expected">,
): Promise<DecisionPreview> {
  return (await runDecision(entry, decision, options, true)) as DecisionPreview;
}

async function runDecision(
  entry: Pick<AccessRequestEntry, "id">,
  decision: RequestDecision,
  options: DecideOptions,
  previewOnly: boolean,
): Promise<DecisionResult | DecisionPreview> {
  // Keep caller mutations during discovery from changing the consent being checked.
  decision = structuredClone(decision);
  options = {
    ...options,
    ...(options.expected && { expected: structuredClone(options.expected) }),
  };
  httpUrl(options.webId);
  const storage = scoped(
    options.storage,
    options.storage.endsWith("/") ? options.storage : `${options.storage}/`,
  );
  options = { ...options, storage };
  const id = scoped(storage, entry.id);
  const fetchFn = transport(options.fetch, options.signal);
  const model = await accessModel({ fetch: fetchFn, storage });
  if (model === "unknown") throw new UnsupportedAccessModelError(model);
  const request = await current(id, fetchFn);
  const parsed = request.entry;
  const now = (options.now ?? (() => new Date()))().toISOString();
  const records = recordsFolder(storage);
  const owner = options.webId;
  const peeked = await recordsKey(records, storage, owner, fetchFn, model, true);
  const found = await findSlot(storage, peeked, parsed, owner, fetchFn);
  const recorded = found?.record;
  if (recorded?.outcome === "approving") requireStrongEtag(recorded.etag);
  // Records live only in a folder only the owner can read; resolve the slot under its key.
  const sealed = async (): Promise<Slot> => {
    const key = await ensureOwnerOnlyContainer(records, storage, owner, fetchFn, model);
    return key === peeked && found
      ? found
      : ((await findSlot(storage, key, parsed, owner, fetchFn)) as Slot);
  };
  const resuming = parsed.status === "approving" || parsed.status === "approved";
  // A claimed approval with no owner record was written by the requester: it can still be denied.
  const claimed = resuming && recorded === undefined;
  if (!decision.approve) {
    if (resuming && !claimed) throw new Error("Cannot deny an approval");
    if (parsed.status !== "denied") {
      requireStrongEtag(request.etag);
      await turtle(request.dataset);
    }
    const preview = previewFor(parsed, decision, options, model);
    assertExpected(preview, options.expected);
    if (previewOnly) return preview;
    const slot = await sealed();
    const decidedAt = parsed.status === "denied" ? (parsed.decidedAt ?? now) : now;
    if (parsed.status !== "denied") {
      set(request.dataset, id, ACCM.status, ACCM.Denied, true);
      set(request.dataset, id, `${ACCM.ns}decidedAt`, decidedAt);
      await cas(request, fetchFn);
    }
    // A pinned approval that never reached Approving becomes this denial, so it never resumes.
    await settleRecord(slot, id, "denied", undefined, fetchFn);
    const { receiptUrl } = urls(storage, await deriveGrantId(slot.url, [], owner, "denial"));
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
  if (parsed.status !== "approved") {
    requireStrongEtag(request.etag);
    await turtle(request.dataset);
  }
  let snapshot: Snapshot;
  let slot: Slot;
  if (recorded !== undefined) {
    // Resume only from the owner's record, never from the requester-authored notification. A
    // pending request here crashed after pinning but before the Approving CAS.
    snapshot = recorded.snapshot as Snapshot;
    if ((snapshot.model ?? "wac") !== model) throw new UnsupportedAccessModelError("unknown");
    await validateSnapshot(snapshot, parsed, (found as Slot).url, options);
    // Only a finished approval ignores choices: it is reported as it was recorded.
    if (parsed.status !== "approved") assertSameChoices(snapshot, decision);
    if (parsed.status !== "approved") await preflight(snapshot, options, fetchFn, model);
    const preview = previewFor(parsed, decision, options, model, snapshot);
    assertExpected(preview, options.expected);
    if (previewOnly) return preview;
    slot = await sealed();
    // Sealing can observe a different key after the read-only check. Never attach an old
    // snapshot to the new generation's record address.
    await validateSnapshot(snapshot, parsed, slot.url, options);
    if (parsed.status === "pending") await moveToApproving(request, id, snapshot, fetchFn);
  } else {
    const dataTypes = [...new Set(decision.dataTypes ?? parsed.dataTypes)].sort();
    if (dataTypes.length === 0 || !dataTypes.every((type) => parsed.dataTypes.includes(type)))
      throw new Error("Approved dataTypes must be a nonempty requested subset");
    // Concrete target claims never override class registrations or storage confinement.
    for (const target of request.targets) {
      if (!parsed.dataTypes.some((type) => termsEqual(type, target))) scoped(storage, target);
    }
    // Each approved type grants only its own requested modes, so narrowing the data types
    // can never carry a mode that was requested for an excluded type.
    const viewer = decision.role === "viewer";
    const publicFetch = options.publicFetch && publicTransport(options.publicFetch, options.signal);
    const perTarget = new Map<string, Set<RequestMode>>();
    const targetDataTypes: Record<string, string[]> = {};
    const granted: string[] = [];
    for (const type of dataTypes) {
      const typeModes = (parsed.modesByType[type] ?? []).filter(
        (mode) => !viewer || mode === "read",
      );
      if (typeModes.length === 0) continue;
      granted.push(type);
      for (const target of await resolveTargets([type], options, fetchFn, publicFetch)) {
        assertGrantable(target, storage);
        const modes = perTarget.get(target) ?? new Set<RequestMode>();
        for (const mode of typeModes) modes.add(mode);
        perTarget.set(target, modes);
        targetDataTypes[target] ??= [];
        targetDataTypes[target].push(type);
      }
    }
    if (perTarget.size === 0) throw new Error("Decision grants no requested modes");
    if (perTarget.size > MAX_MEMBERS) throw new RangeError("Invalid resolved target count");
    const targets = [...perTarget.keys()].sort();
    // Grants are roles: pin the modes of the role each target's requested modes map to (this
    // refuses append-only requests before any write).
    const targetModes = Object.fromEntries(
      targets.map((target) => [
        target,
        [...ROLE_MODES[roleFor([...(perTarget.get(target) as Set<RequestMode>)])]],
      ]),
    ) as Record<string, RequestMode[]>;
    const modes = [...new Set(Object.values(targetModes).flat())].sort();
    snapshot = {
      grantId: "", // Derived only once the records folder has been sealed.
      targets,
      agent: parsed.requester,
      modes,
      targetModes,
      targetDataTypes,
      dataTypes: granted,
      schemaVersion: "1",
      model,
      decidedAt: now,
      chosen: { dataTypes, viewer, role: decision.role ?? null },
      ...(parsed.purpose !== undefined && { purpose: parsed.purpose }),
      ...(decision.expiresAt !== undefined && { expiresAt: decision.expiresAt.toISOString() }),
    };
    await preflight(snapshot, options, fetchFn, model);
    const preview = previewFor(parsed, decision, options, model, snapshot);
    assertExpected(preview, options.expected);
    if (previewOnly) return preview;
    slot = await sealed();
    snapshot.grantId = await deriveGrantId(slot.url, targets, owner);
    // Check the decision before pinning it, so a pin can always be resumed.
    await validateSnapshot(snapshot, parsed, slot.url, options);
    // Pin the decision in the owner's records first. If a concurrent call pinned this slot first,
    // resume its decision (forward-only) when the choices match.
    if (
      !(await put(
        slot.url,
        await recordBody(slot.url, id, "approving", snapshot),
        fetchFn,
        null,
        true,
      ))
    ) {
      const winner = await readRecord(slot.url, id, fetchFn);
      // Lost to a finished decision: report the request's real state, as cas() does.
      if (winner?.outcome !== "approving") throw await conflict(id, fetchFn);
      snapshot = winner.snapshot as Snapshot;
      slot = { url: slot.url, record: winner };
      assertSameChoices(snapshot, decision);
      await validateSnapshot(snapshot, parsed, slot.url, options);
      assertExpected(previewFor(parsed, decision, options, model, snapshot), options.expected);
    }
    await moveToApproving(request, id, snapshot, fetchFn);
  }
  const locations =
    parsed.status === "approved"
      ? urls(storage, snapshot.grantId)
      : await complete(request, snapshot, options, fetchFn);
  // A finished approval never resumes for a later request at the same address.
  await settleRecord(slot, id, "approved", snapshot, fetchFn);
  return {
    status: "approved",
    choices: {
      dataTypes: [...snapshot.dataTypes],
      role: roleFor(snapshot.modes),
      targetRoles: Object.fromEntries(
        snapshot.targets.map((target) => [
          target,
          roleFor(snapshot.targetModes[target] as RequestMode[]),
        ]),
      ),
      ...(snapshot.expiresAt !== undefined && { expiresAt: new Date(snapshot.expiresAt) }),
    },
    ...locations,
    notified: await notify(id, snapshot.agent, true, options),
    expiryEnforced: false,
  };
}
