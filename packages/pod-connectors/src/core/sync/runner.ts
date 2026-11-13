// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { NS } from "@jeswr/suite-vocab";
import type {
  BlankNode,
  DatasetCore,
  NamedNode,
  Quad,
  Quad_Graph,
  Quad_Subject,
  Term,
} from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { abortablePodWriter } from "../abort.js";
import { RunBudget, RunBudgetExceededError } from "../budget.js";
import { IntegrationAuthError, IntegrationSyncError, RateLimitedError } from "../errors.js";
import type { ImportReport } from "../import-runner.js";
import { createImportSession, MAX_RUN_SOURCES } from "../import-session.js";
import { copyDataset } from "../incremental.js";
import { Provenance } from "../provenance.js";
import type { BinaryDoc, NormalisedDoc, PodWriter, WrittenDoc } from "../types.js";
import { resolveConflict } from "./conflict.js";
import { scanWriteBack } from "./detection.js";
import {
  canonicalHash,
  datasetBytes,
  inScope,
  sha256,
  syncItemScope,
  syncItemSlug,
} from "./hash.js";
import {
  accountKey,
  checkedText,
  createLinkStore,
  DuplicateSyncIdentityError,
  LinkCapError,
  LinkManifestLostError,
  MAX_PENDING_ITEMS,
  MAX_SYNC_LINKS,
  strongEtag,
  TOMBSTONE_RETENTION_MS,
  WeakEtagError,
} from "./link-store.js";
import { syncSourceFetch } from "./transport.js";
import type {
  RemoteItem,
  RemoteResult,
  SyncConnection,
  SyncLink,
  SyncPodWriter,
  SyncPorts,
  SyncResource,
  SyncSkip,
  SyncSkipReason,
  TwoWayAdapter,
} from "./types.js";
import { SyncMetadata } from "./vocab.js";

export interface TwoWaySyncReport extends ImportReport {
  readonly conflicts: number;
  readonly pendingDeletes: number;
  /** Items skipped with a fixed error class; inbound ones are retried next run. */
  readonly failed: number;
  /** Items imported by this connector without a link; never created at the provider. */
  readonly unlinkedImports: number;
  /** Items waiting on an unresolved create intent. */
  readonly deferred: number;
  /** Links re-pointed to a renamed/moved pod resource this run. */
  readonly moved: number;
  /**
   * The previous cursor was kept: an inbound failure could not be retained for retry (no
   * remote identity, or more than MAX_PENDING_ITEMS pending items).
   */
  readonly cursorHeld: boolean;
  readonly outbound: {
    readonly created: number;
    readonly updated: number;
    readonly deleted: number;
  };
  /** Owner-only link records carry the URLs, versions and resolution for the health UI. */
  readonly issues: readonly SyncLink[];
  /** Skipped/deferred items with their fixed reason class (bounded). */
  readonly skippedItems: readonly SyncSkip[];
}
type Stored = NonNullable<Awaited<ReturnType<PodWriter["read"]>>>;
type Stage = { value: SyncSkipReason };

/** Most skipped items listed in one report; counts stay exact. */
export const MAX_REPORTED_SKIPS = 1_000;
/** Provider rejections (4xx) of one create before it is retired as a manual conflict. */
export const MAX_CREATE_REJECTIONS = 3;
/** Pod deletes held back this many consecutive runs become a manual conflict. */
export const MAX_DELETE_HOLDS = 2;
const TRASH_RETENTION_MS = 30 * 86_400_000;
const NOT_FAILURES: ReadonlySet<SyncSkipReason> = new Set<SyncSkipReason>([
  "deferred",
  "unlinked-import",
  "unsupported-resource",
]);

/** Abort, budget, rate-limit and authorization failures end the run; anything else is per item. */
function runLevel(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  if (
    error instanceof RunBudgetExceededError ||
    error instanceof LinkManifestLostError ||
    error instanceof RateLimitedError ||
    error instanceof IntegrationAuthError
  )
    return true;
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}
/** A provider's definite refusal of a request (4xx other than auth, timeout and rate limit). */
function rejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    ![401, 403, 408, 429].includes(status)
  );
}
function reasonOf(error: unknown, stage: SyncSkipReason): SyncSkipReason {
  if (error instanceof WeakEtagError) return "weak-etag";
  if (error instanceof DuplicateSyncIdentityError) return "duplicate-identity";
  if (error instanceof LinkCapError) return "link-cap";
  return stage;
}

/** Inbound then outbound under the SAME import-session claim, checkpoint and abort boundary. */
export async function runTwoWaySync<Op>(
  adapter: TwoWayAdapter<Op>,
  connection: SyncConnection,
  ports: SyncPorts,
): Promise<TwoWaySyncReport> {
  const settings = { ...connection };
  const id = adapter.metadata.id;
  for (const option of [settings.writeBack, settings.propagateDeletes])
    if (option !== undefined && typeof option !== "boolean")
      throw new Error("Invalid sync opt-in.");
  const account = accountKey(settings.account);
  const signal = ports.signal;
  const check = () => signal?.throwIfAborted();
  const budget = new RunBudget(id, ports.limits);
  for (const value of ports.limits
    ? [ports.limits.maxRequests, ports.limits.maxItems, ports.limits.maxBytes ?? 0]
    : [])
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid sync run limit.");
  const maxResources = ports.maxResources ?? MAX_SYNC_LINKS;
  if (!Number.isSafeInteger(maxResources) || maxResources < 1 || maxResources > MAX_SYNC_LINKS)
    throw new RangeError("Invalid sync resource cap.");
  const policy = settings.conflictPolicy ?? "lww";
  resolveConflict(policy, undefined, undefined, settings.skewGuardMs);
  if (
    adapter.deduplicatesCreateKeys !== undefined &&
    typeof adapter.deduplicatesCreateKeys !== "boolean"
  )
    throw new Error("Invalid create deduplication declaration.");
  if (adapter.itemSubjects !== undefined && typeof adapter.itemSubjects !== "function")
    throw new Error("Invalid item subject declaration.");
  if (!adapter.writeBackContainers.length || adapter.writeBackContainers.length > 32)
    throw new Error("Declare 1–32 write-back containers.");
  const containers = adapter.writeBackContainers.map((c) => {
    if (!/^(?:[A-Za-z0-9_-]+\/)+$/.test(c) || /^(links|trash|conflicts)\//.test(c))
      throw new Error("Invalid write-back container.");
    return `${account}/${c}`;
  });
  if (
    new Set(containers).size !== containers.length ||
    containers.some((c, i) => containers.some((other, j) => i !== j && c.startsWith(other)))
  )
    throw new Error("Overlapping write-back containers.");
  if (
    settings.writeBack &&
    (!ports.scopes || adapter.requiredWriteScopes.some((s) => !ports.scopes?.includes(s)))
  )
    throw new IntegrationSyncError(
      id,
      "Write-back requires incremental consent for the declared write scopes.",
    );
  const base = abortablePodWriter(ports.podWriter, signal);
  const writeBinary = base.writeBinary;
  const request = () => {
    check();
    budget.request();
  };
  const writer: SyncPodWriter = {
    ...base,
    async read(slug) {
      request();
      const stored = await base.read(slug);
      if (stored) budget.bytes(datasetBytes(stored.dataset));
      return stored;
    },
    async write(doc, conditions) {
      request();
      budget.bytes(datasetBytes(doc.dataset));
      return base.write(doc, conditions);
    },
    async remove(slug, conditions) {
      request();
      if (!base.remove) throw new Error("Sync host cannot delete resources.");
      return base.remove(slug, conditions);
    },
    ...(writeBinary && {
      async writeBinary(doc: BinaryDoc) {
        request();
        budget.bytes(doc.body.byteLength);
        return writeBinary(doc);
      },
    }),
    async ensureOwnerOnly(slug) {
      request();
      return ports.podWriter.ensureOwnerOnly(slug);
    },
    async *list(container) {
      request();
      for await (const entry of ports.podWriter.list(container)) {
        check();
        budget.items(1);
        yield entry;
      }
    },
    async registerType(registrations) {
      request();
      return base.registerType(registrations);
    },
  };
  const api = syncSourceFetch(ports.sourceAuth.fetch, id, budget, signal);
  const remoteOptions = (extra: { idempotencyKey?: string; ifMatch?: string } = {}) => ({
    ...extra,
    api,
    signal,
  });
  const root = writer.resolve(`${account}/`);
  const containerUrls = containers.map((c) => writer.resolve(c));
  function slug(url: string): string {
    if (!url.startsWith(root) || new URL(url).href !== url || /[?#]/.test(url))
      throw new Error("Sync URL escapes account.");
    return `${account}/${url.slice(root.length)}`;
  }
  function mapped(url: string): boolean {
    if (/\.(?:acl|acr)$/i.test(url)) return false;
    return containerUrls.some(
      (c) => url.startsWith(c) && !url.slice(c.length).includes("/") && url !== c,
    );
  }
  const links = createLinkStore(writer, account, id, { maxLinks: ports.maxLinks });
  let linksLoaded = false;
  const now = ports.now ?? (() => new Date());

  // Per-item outcomes. Keys are (direction, identity); the last outcome in a run wins.
  const skips = new Map<string, SyncSkip>();
  const resolvedInbound = new Set<string>();
  let unkeyed = 0;
  /** An inbound failure without a remote identity cannot be retried by id: hold the cursor. */
  let inboundUnkeyed = false;
  const skipKey = (item: Pick<SyncSkip, "direction" | "remoteId" | "podUrl">) =>
    JSON.stringify([item.direction, item.direction === "inbound" ? item.remoteId : item.podUrl]);
  function skip(item: SyncSkip): void {
    if (item.direction === "inbound" ? !item.remoteId : !item.podUrl) {
      unkeyed++;
      if (item.direction === "inbound") inboundUnkeyed = true;
      return;
    }
    if (item.remoteId && item.direction === "inbound") resolvedInbound.delete(item.remoteId);
    skips.set(skipKey(item), item);
  }
  function succeeded(remoteId: string): void {
    skips.delete(skipKey({ direction: "inbound", remoteId }));
    resolvedInbound.add(remoteId);
  }
  /** Run one item; a non-run-level failure is recorded with a fixed class and the run continues. */
  async function isolate(
    item: Omit<SyncSkip, "reason">,
    stage: Stage,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (error) {
      if (runLevel(error, signal)) throw error;
      skip({ ...item, reason: reasonOf(error, stage.value) });
      return false;
    }
  }
  function pendingAfterRun(): SyncSkip[] {
    const result = new Map<string, SyncSkip>();
    if (linksLoaded)
      for (const item of links.pending())
        if (item.direction === "inbound" && item.remoteId && !resolvedInbound.has(item.remoteId))
          result.set(skipKey(item), item);
    for (const [key, item] of skips) result.set(key, item);
    // Inbound items carry retry state; list them first so a cap never drops one silently.
    return [...result.values()].sort((a, b) =>
      a.direction === b.direction ? 0 : a.direction === "inbound" ? -1 : 1,
    );
  }
  function health() {
    const issues = links.all().filter((link) => link.conflict || link.pendingDelete);
    const pending = pendingAfterRun();
    return {
      issues,
      pending,
      conflicts: issues.filter((link) => link.conflict).length,
      pendingDeletes: issues.filter((link) => link.pendingDelete).length,
      failed: pending.filter((item) => !NOT_FAILURES.has(item.reason)).length + unkeyed,
      unlinkedImports: pending.filter((item) => item.reason === "unlinked-import").length,
      deferred: pending.filter((item) => item.reason === "deferred").length,
    };
  }
  const healthCounts = (h: ReturnType<typeof health>) => ({
    conflicts: h.conflicts,
    pendingDeletes: h.pendingDeletes,
    failed: h.failed,
    unlinkedImports: h.unlinkedImports,
    deferred: h.deferred,
  });

  const session = createImportSession(
    writer,
    id,
    `urn:solid:connector:${encodeURIComponent(id)}:source`,
    ports,
  );
  const importSource = `urn:solid:connector:${encodeURIComponent(id)}:source`;
  const runPrefix = `${writer.resolve("_provenance.ttl")}#run-`;
  /** This connector's import provenance (source derivation or a connector run Activity). */
  function importedByConnector(dataset: DatasetCore): boolean {
    const subjects = new Set<string>();
    for (const quad of dataset)
      if (quad.subject.termType === "NamedNode") subjects.add(quad.subject.value);
    for (const subject of subjects) {
      const prov = new Provenance(subject, dataset, DataFactory);
      if (prov.derivedFrom.has(importSource)) return true;
      for (const activity of prov.generatedBy) if (activity.startsWith(runPrefix)) return true;
    }
    return false;
  }
  // Hash the final mapped representation. Snapshots preserve the actual losing dataset
  // and must not be remapped a second time by the session.
  function normalize(doc: NormalisedDoc): NormalisedDoc {
    datasetBytes(doc.dataset);
    const mappedDoc = adapter.vocabMap
      ? adapter.vocabMap({ ...doc, dataset: copyDataset(doc.dataset) }, { webId: writer.webId })
      : doc;
    datasetBytes(mappedDoc.dataset);
    return mappedDoc;
  }
  const outbound = { created: 0, updated: 0, deleted: 0 };
  let moved = 0;
  let outboundStarted: Date | undefined;
  const outboundSlug = `${account}/outbound-${crypto.randomUUID()}.ttl`;
  const outboundActivity = `${writer.resolve(outboundSlug)}#activity`;
  const outboundSources = new Set<string>();
  let outboundRecorded = false;
  function startOutbound(url: string) {
    outboundStarted ??= now();
    if (outboundSources.size < MAX_RUN_SOURCES) outboundSources.add(url);
  }
  async function recordOutbound() {
    if (!outboundStarted || outboundRecorded) return;
    const { Provenance: Activity, PROV } = await import("../provenance.js");
    const dataset = copyDataset();
    const activity = new Activity(outboundActivity, dataset, DataFactory);
    activity.types.add(`${PROV}Activity`);
    activity.startedAt = outboundStarted;
    activity.endedAt = now();
    activity.associatedWith = `urn:solid:connector:${encodeURIComponent(id)}`;
    for (const source of outboundSources) activity.used.add(source);
    await writer.ensureOwnerOnly(outboundSlug);
    await session.write(
      {
        slug: outboundSlug,
        dataset,
        category: "provenance",
        forClass: `${PROV}Activity`,
        skipRegistration: true,
        carriedForward: [outboundActivity],
      },
      { ifNoneMatch: "*" },
    );
    outboundRecorded = true;
  }
  /** Adapter-declared subjects of the item at `url` (validated by syncItemScope). */
  const itemSubjects = (url: string): readonly string[] | undefined => adapter.itemSubjects?.(url);
  /**
   * Location-independent: the document URL and its fragments hash relative to `url`. Only the
   * item's own subjects (and the blank nodes their mapped quads reach) are hashed.
   */
  const hash = (dataset: DatasetCore, url: string) =>
    canonicalHash(dataset, adapter.fieldsForHash, url, itemSubjects(url));
  const resultIdentity = (result: RemoteResult): RemoteResult => ({
    remoteId: checkedText(result.remoteId),
    remoteVersion: checkedText(result.remoteVersion),
  });
  async function current(url: string): Promise<Stored | undefined> {
    if (!mapped(url)) throw new Error("Item is outside declared write-back containers.");
    const stored = await session.readResource(slug(url), false);
    if (stored) strongEtag(stored.etag);
    return stored;
  }
  async function writtenEtag(written: WrittenDoc, expectedHash: string): Promise<string> {
    if (written.etag) return strongEtag(written.etag);
    const stored = await current(written.url);
    if (!stored || (await hash(stored.dataset, written.url)) !== expectedHash)
      throw new Error("Pod resource changed during sync write.");
    return strongEtag(stored.etag);
  }
  /**
   * Replace only the item's mapped quads: fieldsForHash on the item's own subjects (document
   * URL plus its fragments or the adapter's declared subjects) plus the blank-node structure those quads reach.
   * Quads about any other subject, and unmapped facts, stay. Unmapped incoming facts are added
   * only for a (subject, predicate) the pod lacks. The item's mapped projection equals the
   * incoming one, so the canonical hash of the result is the incoming hash. `lossy` reports
   * that the merge removes pod quads the incoming document lacks (`changed`: the mapped
   * projections differ), so the caller can keep a trash snapshot first.
   */
  function mergeMapped(
    stored: DatasetCore,
    incoming: DatasetCore,
    url: string,
    changed: boolean,
  ): { dataset: Store; lossy: boolean } {
    const fields = new Set(adapter.fieldsForHash);
    const declared = itemSubjects(url);
    const structural = (scope: ReturnType<typeof syncItemScope>, q: Quad) =>
      q.subject.termType === "BlankNode"
        ? scope.blanks.has(q.subject.value)
        : fields.has(q.predicate.value) && inScope(scope, q);
    const storedScope = syncItemScope(stored, adapter.fieldsForHash, url, declared);
    const incomingScope = syncItemScope(incoming, adapter.fieldsForHash, url, declared);
    const result = new Store();
    const pairs = new Set<string>();
    const labels = new Set<string>();
    const removed: Quad[] = [];
    for (const q of stored) {
      if (structural(storedScope, q)) {
        removed.push(q);
        continue;
      }
      result.add(q);
      pairs.add(JSON.stringify([q.subject.value, q.predicate.value]));
      for (const term of [q.subject, q.object, q.graph])
        if (term.termType === "BlankNode") labels.add(term.value);
    }
    const fresh = new Map<string, BlankNode>();
    let serial = 0;
    const relabel = <T extends Term>(term: T): T | BlankNode => {
      if (term.termType !== "BlankNode") return term;
      let next = fresh.get(term.value);
      if (!next) {
        let label: string;
        do label = `sync${serial++}`;
        while (labels.has(label));
        next = DataFactory.blankNode(label);
        fresh.set(term.value, next);
      }
      return next;
    };
    // Blank-node quads compare by shape: every non-blank term, with blank positions erased.
    const shape = (q: Quad) =>
      JSON.stringify(
        [q.subject, q.predicate, q.object, q.graph].map((t) =>
          t.termType === "Literal"
            ? [t.value, t.language, t.datatype.value]
            : t.termType === "BlankNode"
              ? null
              : [t.termType, t.value],
        ),
      );
    const shapes = new Set<string>();
    for (const q of incoming) {
      const isStructural = structural(incomingScope, q);
      if (isStructural) shapes.add(shape(q));
      if (
        !isStructural &&
        (q.subject.termType !== "NamedNode" ||
          q.object.termType === "BlankNode" ||
          pairs.has(JSON.stringify([q.subject.value, q.predicate.value])))
      )
        continue;
      result.add(
        DataFactory.quad(
          relabel(q.subject) as Quad_Subject,
          q.predicate,
          relabel(q.object) as Quad["object"],
          relabel(q.graph) as Quad_Graph,
        ),
      );
    }
    const hasBlank = (q: Quad) =>
      [q.subject, q.object, q.graph].some((t) => t.termType === "BlankNode");
    const lossy = removed.some((q) =>
      hasBlank(q) ? changed || !shapes.has(shape(q)) : !incoming.has(q),
    );
    return { dataset: result, lossy };
  }
  /** Expiring owner-only copy of a pod version the sync is about to remove or overwrite. */
  const trash = (url: string, stored: Stored) =>
    snapshot(
      url,
      stored.dataset,
      strongEtag(stored.etag),
      new Date(now().getTime() + TRASH_RETENTION_MS),
    );
  function snapshotPayload(dataset: DatasetCore, snapshotUrl: string, originalUrl: string) {
    if (new SyncMetadata(snapshotUrl, dataset, DataFactory).revisionOf !== originalUrl)
      throw new Error("Snapshot revision identity mismatch.");
    const result = copyDataset();
    for (const quad of dataset)
      if (quad.subject.termType !== "NamedNode" || quad.subject.value !== snapshotUrl)
        result.add(quad);
    return result;
  }
  async function snapshotSlug(url: string, version: string, digest: string, trash = false) {
    const key = await sha256(JSON.stringify([url, version, digest]));
    return `${account}/${trash ? "trash" : "conflicts"}/${key}.ttl`;
  }
  async function snapshot(
    url: string,
    dataset: DatasetCore,
    version: string,
    expiry?: Date,
  ): Promise<string> {
    const digest = await hash(dataset, url);
    const target = await snapshotSlug(url, version, digest, expiry !== undefined);
    const snapshotUrl = writer.resolve(target);
    for (const quad of dataset)
      if (quad.subject.termType === "NamedNode" && quad.subject.value === snapshotUrl)
        throw new Error("Reserved snapshot metadata subject.");
    await writer.ensureOwnerOnly(target);
    const existing = await writer.read(target);
    if (!existing) {
      const copy = copyDataset(dataset);
      const meta = new SyncMetadata(writer.resolve(target), copy, DataFactory);
      meta.revisionOf = url;
      meta.expires = expiry;
      await session.write(
        {
          slug: target,
          dataset: copy,
          category: "sync-snapshots",
          forClass: `${NS.PROV}Entity`,
          skipRegistration: true,
          carriedForward: [
            ...new Set(
              [...dataset]
                .filter((q) => q.subject.termType === "NamedNode")
                .map((q) => q.subject.value),
            ),
          ],
        },
        { ifNoneMatch: "*" },
      );
    } else if ((await hash(snapshotPayload(existing.dataset, snapshotUrl, url), url)) !== digest)
      throw new Error("Snapshot identity mismatch.");
    return snapshotUrl;
  }
  async function readSnapshot(snapshotUrl: string, url: string): Promise<DatasetCore> {
    await writer.ensureOwnerOnly(slug(snapshotUrl));
    const stored = await writer.read(slug(snapshotUrl));
    if (!stored) throw new Error("Missing sync snapshot.");
    return snapshotPayload(stored.dataset, snapshotUrl, url);
  }
  /** Duplicate identities never wedge: keep the pod resource as a manual conflict-only record. */
  async function recordDuplicate(link: SyncLink, remote: RemoteResult): Promise<void> {
    let snapshotUrl = link.pendingCreate?.resourceUrl;
    if (!snapshotUrl) {
      const stored = await current(link.podUrl);
      if (!stored) {
        await links.delete(link.podUrl);
        return;
      }
      snapshotUrl = await snapshot(link.podUrl, stored.dataset, strongEtag(stored.etag));
    }
    await links.put({
      podUrl: link.podUrl,
      pendingCreate: link.pendingCreate,
      conflict: {
        snapshotUrl,
        remoteVersion: remote.remoteVersion,
        remoteId: remote.remoteId,
        resolution: "manual",
      },
    });
    skip({ direction: "outbound", podUrl: link.podUrl, reason: "duplicate-identity" });
  }
  /** Pod URLs of create intents not yet confirmed at the provider. */
  const unresolvedCreates = new Set<string>();
  const isOpenCreate = (link: SyncLink | undefined) =>
    !!link?.pendingCreate && !link.remoteId && link.conflict?.resolution !== "manual";
  /**
   * Whether a keyless unlinked inbound item may be the echo of one of our own creates that the
   * framework will still re-send (so the provider deduplicates it into that intent). Only an
   * equal mapped hash qualifies; creates that are never re-sent (write-back off, a provider
   * that cannot deduplicate keys) never defer anything.
   */
  function awaitsOwnCreate(incomingHash: string): boolean {
    if (!settings.writeBack || adapter.deduplicatesCreateKeys === false) return false;
    for (const podUrl of unresolvedCreates) {
      const link = links.byPodUrl(podUrl);
      if (isOpenCreate(link) && link?.pendingCreate?.hash === incomingHash) return true;
    }
    return false;
  }
  /** Stop treating a create as open: keep its intent and snapshot as a manual conflict. */
  async function retireCreate(link: SyncLink): Promise<void> {
    const intent = link.pendingCreate;
    if (!intent) return;
    await links.put({
      ...link,
      pendingCreate: { ...intent, attempts: undefined },
      conflict: {
        snapshotUrl: intent.resourceUrl,
        remoteVersion: intent.podEtag,
        resolution: "manual",
      },
    });
    unresolvedCreates.delete(link.podUrl);
  }

  async function upsert(item: RemoteItem): Promise<void> {
    check();
    budget.items(1);
    const remoteId = typeof item?.remoteId === "string" ? item.remoteId : undefined;
    const stage: Stage = { value: "mapping-failed" };
    let deferred = false;
    const ok = await isolate({ direction: "inbound", remoteId }, stage, async () => {
      deferred = await upsertItem(item, stage);
    });
    if (ok && !deferred && remoteId) succeeded(remoteId);
  }
  /** Returns true when the item was deferred rather than mapped. */
  async function upsertItem(item: RemoteItem, stage: Stage): Promise<boolean> {
    const identity = resultIdentity(item);
    const document = normalize(item.document);
    const url = writer.resolve(document.slug);
    stage.value = "hash-failed";
    const incomingHash = await hash(document.dataset, url);
    stage.value = "mapping-failed";
    let link = links.byRemoteId(identity.remoteId);
    let adopted = false;
    if (!link && item.idempotencyKey !== undefined) {
      const intent = links.byCreateKey(checkedText(item.idempotencyKey));
      if (
        intent?.pendingCreate &&
        isOpenCreate(intent) &&
        incomingHash !== intent.pendingCreate.hash
      ) {
        // A key is visible to others: content we never created is a third party reusing it.
        // Keep the remote version as a manual conflict on the intent; never adopt it. The
        // item is retried next run and then maps at its own framework slug.
        stage.value = "write-failed";
        const snapshotUrl = await snapshot(intent.podUrl, document.dataset, identity.remoteVersion);
        await links.put({
          ...intent,
          conflict: {
            snapshotUrl,
            remoteVersion: identity.remoteVersion,
            remoteId: identity.remoteId,
            resolution: "manual",
          },
        });
        unresolvedCreates.delete(intent.podUrl);
        skip({ direction: "inbound", remoteId: identity.remoteId, reason: "deferred" });
        return true;
      }
      if (intent?.pendingCreate && isOpenCreate(intent)) {
        // The provider echoes our key and content: adopt the create intent.
        link = {
          ...intent,
          ...identity,
          podEtag: intent.pendingCreate.podEtag,
          lastSyncedHash: intent.pendingCreate.hash,
          pendingCreate: undefined,
          needsInbound: undefined,
        };
        adopted = true;
      }
    }
    if (link && link.podUrl !== url)
      throw new Error("Resolve linked pod URL before mapping the remote item.");
    if (!link) {
      if (links.byPodUrl(url)) throw new Error("Pod URL belongs to another sync identity.");
      // A lagging key lookup must not let our own create be mapped as a second resource.
      // An item whose provider-stored key matches no intent is provably not ours, and one
      // whose mapped content differs from every re-sendable create is not ours either.
      if (item.idempotencyKey === undefined && awaitsOwnCreate(incomingHash)) {
        skip({ direction: "inbound", remoteId: identity.remoteId, reason: "deferred" });
        return true;
      }
    }
    stage.value = "read-failed";
    const stored = await current(url);
    stage.value = "hash-failed";
    const localHash = stored ? await hash(stored.dataset, url) : undefined;
    stage.value = "write-failed";
    if (link?.status) {
      // Tombstones are durable: activity on one becomes a manual conflict for the owner.
      if (link.status === "remote-deleted") return false;
      if (identity.remoteVersion === link.remoteVersion && incomingHash === link.lastSyncedHash)
        return false;
      const snapshotUrl = writer.resolve(
        await snapshotSlug(url, identity.remoteVersion, incomingHash),
      );
      if (link.conflict?.resolution === "manual" && link.conflict.snapshotUrl === snapshotUrl)
        return false;
      await snapshot(url, document.dataset, identity.remoteVersion);
      await links.put({
        ...link,
        conflict: { snapshotUrl, remoteVersion: identity.remoteVersion, resolution: "manual" },
      });
      return false;
    }
    const resolvingManual =
      link?.conflict?.resolution === "manual" && ["remote-wins", "pod-wins"].includes(policy);
    // A key lookup may return a version edited AFTER our create. Verify mapped content
    // before treating that recovered/current version as our own echo.
    // Unmapped provider changes must not compete with a local mapped edit either.
    if (link && !resolvingManual && incomingHash === link.lastSyncedHash) {
      if (adopted || link.needsInbound || link.remoteVersion !== identity.remoteVersion)
        await links.put({
          ...link,
          remoteVersion: identity.remoteVersion,
          needsInbound: undefined,
        });
      if (adopted) unresolvedCreates.delete(url);
      return false;
    }
    // A retained manual conflict can be replayed without rewriting the item. Compare
    // content as well as version: providers may use coarse updated_at timestamps.
    if (
      link?.conflict?.resolution === "manual" &&
      !link.needsInbound &&
      !resolvingManual &&
      link.conflict.snapshotUrl ===
        writer.resolve(await snapshotSlug(url, identity.remoteVersion, incomingHash))
    )
      return false;
    if (link && !stored) {
      const snapshotUrl = await snapshot(url, document.dataset, identity.remoteVersion);
      await links.put({
        ...link,
        conflict: { snapshotUrl, remoteVersion: identity.remoteVersion, resolution: "manual" },
        pendingDelete: true,
        needsInbound: undefined,
      });
      if (adopted) unresolvedCreates.delete(url);
      return false;
    }
    if (stored && localHash === incomingHash) {
      await links.put({
        ...link,
        ...identity,
        podUrl: url,
        podEtag: strongEtag(stored.etag),
        lastSyncedHash: localHash,
        pendingCreate: undefined,
        needsInbound: undefined,
        conflict: undefined,
      });
      if (adopted) unresolvedCreates.delete(url);
      return false;
    }
    let conflict: SyncLink["conflict"];
    if (stored && (!link || localHash !== link.lastSyncedHash)) {
      // Recording a snapshot changes Last-Modified itself. It must not turn an
      // unresolved clock ambiguity into an automatic winner on the next replay.
      const resolution =
        link?.conflict?.resolution === "manual" && !resolvingManual
          ? "manual"
          : resolveConflict(policy, item.modifiedAt, stored.lastModified, settings.skewGuardMs);
      const snapshotUrl = await snapshot(
        url,
        resolution === "remote" ? stored.dataset : document.dataset,
        resolution === "remote" ? strongEtag(stored.etag) : identity.remoteVersion,
      );
      conflict = { snapshotUrl, remoteVersion: identity.remoteVersion, resolution };
      if (resolution !== "remote") {
        const copy = copyDataset(stored.dataset);
        new SyncMetadata(url, copy, DataFactory).snapshots.add(snapshotUrl);
        await writer.write({ ...document, dataset: copy }, { ifMatch: strongEtag(stored.etag) });
        // Without write-back, a pod win adopts the remote state as the baseline so the item
        // is not re-conflicted every run; the pod's edit stays pending outbound. The stale
        // podEtag keeps it detectable once write-back is enabled.
        await links.put({
          ...link,
          ...identity,
          podUrl: url,
          conflict,
          pendingCreate: undefined,
          needsInbound: undefined,
          ...(resolution === "pod" && !settings.writeBack ? { lastSyncedHash: incomingHash } : {}),
        });
        if (adopted) unresolvedCreates.delete(url);
        return false;
      }
    }
    let copy: Store;
    if (stored) {
      const merged = mergeMapped(stored.dataset, document.dataset, url, localHash !== incomingHash);
      // A remote-resolved conflict already kept the pod version as its snapshot.
      if (merged.lossy && conflict?.resolution !== "remote") await trash(url, stored);
      copy = merged.dataset;
    } else copy = copyDataset(document.dataset);
    if (conflict) new SyncMetadata(url, copy, DataFactory).snapshots.add(conflict.snapshotUrl);
    const written = await session.write(
      { ...document, dataset: copy, writeMode: "replace" },
      stored ? { ifMatch: strongEtag(stored.etag) } : { ifNoneMatch: "*" },
    );
    await links.put({
      ...link,
      ...identity,
      podUrl: url,
      podEtag: await writtenEtag(written, incomingHash),
      lastSyncedHash: incomingHash,
      conflict,
      pendingCreate: undefined,
      needsInbound: undefined,
    });
    if (adopted) unresolvedCreates.delete(url);
    return false;
  }
  async function remoteDelete(remoteId: string, remoteVersion: string): Promise<void> {
    check();
    budget.items(1);
    const stage: Stage = { value: "mapping-failed" };
    const id = typeof remoteId === "string" ? remoteId : undefined;
    const ok = await isolate({ direction: "inbound", remoteId: id }, stage, async () => {
      checkedText(remoteVersion);
      let link = links.byRemoteId(checkedText(remoteId));
      if (!link || link.status === "trashed" || link.status === "pod-deleted") return;
      stage.value = "read-failed";
      const stored = await current(link.podUrl);
      stage.value = "write-failed";
      const deletedAt = now().toISOString();
      if (!stored) {
        await links.put({ ...link, status: "trashed", pendingDelete: false, deletedAt });
        return;
      }
      const trashUrl = await trash(link.podUrl, stored);
      link = {
        ...link,
        remoteVersion,
        status: "remote-deleted",
        trashUrl,
        pendingDelete: true,
        needsInbound: undefined,
      };
      await links.put(link);
      await writer.remove?.(slug(link.podUrl), { ifMatch: strongEtag(stored.etag) });
      await links.put({ ...link, status: "trashed", pendingDelete: false, deletedAt });
    });
    if (ok && id) succeeded(id);
  }
  async function settleCreate(link: SyncLink): Promise<SyncLink> {
    if (!isOpenCreate(link) || !link.pendingCreate) return link;
    request();
    const found = await adapter.findByIdempotencyKey(
      link.pendingCreate.key,
      remoteOptions({ idempotencyKey: link.pendingCreate.key }),
    );
    check();
    if (!found) return link;
    const identity = resultIdentity(found);
    const other = links.byRemoteId(identity.remoteId);
    if (other && other.podUrl !== link.podUrl) {
      await recordDuplicate(link, identity);
      unresolvedCreates.delete(link.podUrl);
      return links.byPodUrl(link.podUrl) ?? link;
    }
    const updated: SyncLink = {
      ...link,
      ...identity,
      podEtag: link.pendingCreate.podEtag,
      lastSyncedHash: link.pendingCreate.hash,
      pendingCreate: undefined,
      needsInbound: true,
    };
    await links.put(updated);
    unresolvedCreates.delete(link.podUrl);
    return updated;
  }
  /** Remote-wins resolution of a retained manual conflict from its remote snapshot. */
  async function resolveFromSnapshot(link: SyncLink, stage: Stage): Promise<void> {
    const conflict = link.conflict;
    if (!conflict) return;
    stage.value = "read-failed";
    const stored = await current(link.podUrl);
    if (!stored) return;
    const payload = await readSnapshot(conflict.snapshotUrl, link.podUrl);
    stage.value = "hash-failed";
    const payloadHash = await hash(payload, link.podUrl);
    const localHash = await hash(stored.dataset, link.podUrl);
    stage.value = "write-failed";
    const merged = mergeMapped(stored.dataset, payload, link.podUrl, localHash !== payloadHash);
    if (merged.lossy) await trash(link.podUrl, stored);
    const written = await writer.write(
      {
        slug: slug(link.podUrl),
        dataset: merged.dataset,
        category: "sync-resolution",
        forClass: `${NS.PROV}Entity`,
        skipRegistration: true,
      },
      { ifMatch: strongEtag(stored.etag) },
    );
    await links.put({
      ...link,
      podEtag: await writtenEtag(written, payloadHash),
      lastSyncedHash: payloadHash,
      conflict: { ...conflict, resolution: "remote" },
    });
  }
  const resolvesManual = (link: SyncLink | undefined) =>
    link?.conflict?.resolution === "manual" &&
    !!link.remoteId &&
    !link.status &&
    (policy === "pod-wins" || policy === "remote-wins");
  async function execute(url: string): Promise<void> {
    const stage: Stage = { value: "read-failed" };
    await isolate({ direction: "outbound", podUrl: url }, stage, () => executeItem(url, stage));
  }
  async function executeItem(url: string, stage: Stage): Promise<void> {
    let link = links.byPodUrl(url);
    if (link?.status) return; // Tombstone activity is recorded by the tombstone pass.
    let resolving = false;
    if (link?.conflict?.resolution === "manual") {
      if (!resolvesManual(link)) return;
      if (policy === "remote-wins") return resolveFromSnapshot(link, stage);
      resolving = true;
    }
    if (link?.needsInbound) return; // Awaiting inbound verification; its failure is recorded.
    if (link?.pendingCreate) {
      const intent = link.pendingCreate;
      stage.value = "remote-failed";
      link = await settleCreate(link);
      if (link.conflict?.resolution === "manual" || link.needsInbound) return;
      if (link.pendingCreate === intent && adapter.deduplicatesCreateKeys === false) {
        // A provider that cannot deduplicate keys never sees an unconfirmed create twice.
        skip({ direction: "outbound", podUrl: url, reason: "deferred" });
        return;
      }
    }
    stage.value = "read-failed";
    const stored = await current(url);
    if (!stored) return;
    stage.value = "hash-failed";
    const localHash = await hash(stored.dataset, url);
    stage.value = "write-failed";
    if (!resolving && !forceUpdate.has(url) && link?.lastSyncedHash === localHash) {
      if (link.podEtag !== stored.etag)
        await links.put({ ...link, podEtag: strongEtag(stored.etag) });
      return;
    }
    let resource: SyncResource = {
      url,
      dataset: copyDataset(stored.dataset),
      etag: strongEtag(stored.etag),
      lastModified: stored.lastModified,
      remoteId: link?.remoteId,
    };
    if (!link?.remoteId && !link?.pendingCreate) {
      // Enabling write-back after a one-way import must never duplicate those items.
      if (importedByConnector(stored.dataset)) {
        skip({ direction: "outbound", podUrl: url, reason: "unlinked-import" });
        return;
      }
      const resourceUrl = await snapshot(url, stored.dataset, resource.etag);
      link = {
        podUrl: url,
        pendingCreate: {
          key: crypto.randomUUID(),
          hash: localHash,
          podEtag: resource.etag,
          resourceUrl,
        },
      };
      await links.put(link);
    }
    let sentHash = localHash;
    if (link?.pendingCreate) {
      stage.value = "read-failed";
      const payload = await readSnapshot(link.pendingCreate.resourceUrl, url);
      if ((await hash(payload, url)) !== link.pendingCreate.hash)
        throw new Error("Missing pending create snapshot.");
      resource = {
        ...resource,
        dataset: payload,
        etag: link.pendingCreate.podEtag,
      };
      sentHash = link.pendingCreate.hash;
    }
    check();
    stage.value = "mapping-failed";
    const op = await adapter.toRemote(resource);
    check();
    stage.value = "remote-failed";
    request();
    startOutbound(url);
    let applied: RemoteResult;
    try {
      applied = await adapter.applyRemote(
        op,
        remoteOptions({ idempotencyKey: link?.pendingCreate?.key, ifMatch: link?.remoteVersion }),
      );
    } catch (error) {
      const intent = link?.pendingCreate;
      if (link && intent && !link.remoteId && rejection(error) && !runLevel(error, signal)) {
        // A provider that keeps refusing the create never wedges the item: count refusals
        // and retire the intent as a manual conflict on the last one.
        const attempts = (intent.attempts ?? 0) + 1;
        if (attempts >= MAX_CREATE_REJECTIONS) await retireCreate(link);
        else await links.put({ ...link, pendingCreate: { ...intent, attempts } });
      }
      throw error;
    }
    const result = resultIdentity(applied);
    check();
    stage.value = "write-failed";
    if (link?.remoteId && result.remoteId !== link.remoteId)
      throw new Error("Remote update changed identity.");
    const other = links.byRemoteId(result.remoteId);
    if (link && !link.remoteId && other && other.podUrl !== url) {
      await recordDuplicate(link, result);
      return;
    }
    if (link?.remoteId) outbound.updated++;
    else outbound.created++;
    await links.put({
      ...link,
      ...result,
      podUrl: url,
      podEtag: resource.etag,
      lastSyncedHash: sentHash,
      pendingCreate: undefined,
      needsInbound: true,
      pendingDelete: false,
      ...(resolving && link?.conflict ? { conflict: { ...link.conflict, resolution: "pod" } } : {}),
    });
  }
  /** Links re-pointed by reference this run: push an update even if the mapped hash is equal. */
  const forceUpdate = new Set<string>();
  /** A move candidate this run could not be paired unambiguously: hold pod deletes. */
  let ambiguousMove = false;
  /** The pod document (no fragment) a named term refers to. */
  const documentOf = (term: Term) =>
    term.termType === "NamedNode" ? term.value.replace(/#.*$/, "") : undefined;
  /**
   * Vanished link URLs an arrival refers to: as a subject (the document or its fragments), or
   * as the object of a PROV link (wasDerivedFrom, wasRevisionOf, …).
   */
  function referencedLinks(dataset: DatasetCore, vanished: ReadonlyMap<string, SyncLink>) {
    const refs = new Set<string>();
    for (const q of dataset) {
      const subject = documentOf(q.subject);
      if (subject && vanished.has(subject)) refs.add(subject);
      if (q.predicate.value.startsWith(NS.PROV)) {
        const object = documentOf(q.object);
        if (object && vanished.has(object)) refs.add(object);
      }
    }
    return refs;
  }
  /**
   * Rebase subjects (and non-PROV objects) at `from` onto `to`, so a document copied verbatim
   * with absolute IRIs describes itself at its new URL. Undefined when nothing refers to `from`.
   */
  function rebaseDocument(dataset: DatasetCore, from: string, to: string): Store | undefined {
    const move = <T extends Term>(term: T): T | NamedNode =>
      term.termType === "NamedNode" && documentOf(term) === from
        ? DataFactory.namedNode(to + term.value.slice(from.length))
        : term;
    let subjects = false;
    for (const q of dataset) if (documentOf(q.subject) === from) subjects = true;
    if (!subjects) return undefined;
    const result = new Store();
    for (const q of dataset)
      result.add(
        DataFactory.quad(
          move(q.subject) as Quad_Subject,
          q.predicate,
          (q.predicate.value.startsWith(NS.PROV) ? q.object : move(q.object)) as Quad["object"],
          q.graph,
        ),
      );
    return result;
  }
  /**
   * Re-point links whose pod resource was renamed/moved, so it is neither created nor deleted.
   * Pairs are exact mapped-hash matches, or an arrival that refers to exactly one vanished link
   * that no other arrival refers to; that pairing also pushes an update. Anything ambiguous
   * pairs nothing and holds this run's pod deletes.
   */
  async function detectMoves(listing: ReadonlyMap<string, string | null | undefined>) {
    const candidates = [...listing.keys()].filter((url) => !links.byPodUrl(url));
    if (!candidates.length) return;
    const vanished = new Map<string, SyncLink>();
    for (const link of links.all()) {
      if (
        !link.remoteId ||
        link.status ||
        link.pendingCreate ||
        link.needsInbound ||
        !link.lastSyncedHash ||
        link.conflict?.resolution === "manual" ||
        listing.has(link.podUrl)
      )
        continue;
      try {
        if (await current(link.podUrl)) continue;
      } catch (error) {
        if (runLevel(error, signal)) throw error;
        continue;
      }
      vanished.set(link.podUrl, link);
    }
    if (!vanished.size) return;
    type Arrival = { url: string; stored: Stored; digest: string; refs: Set<string> };
    const arrivals: Arrival[] = [];
    for (const url of candidates) {
      try {
        const stored = await current(url);
        if (!stored) continue;
        strongEtag(stored.etag);
        const digest = await hash(stored.dataset, url);
        arrivals.push({ url, stored, digest, refs: referencedLinks(stored.dataset, vanished) });
      } catch (error) {
        if (runLevel(error, signal)) throw error;
        // The outbound pass reads it again and records the failure.
      }
    }
    const usedOld = new Set<string>();
    const usedNew = new Set<string>();
    async function pair(old: SyncLink, target: Arrival, byReference: boolean): Promise<void> {
      usedOld.add(old.podUrl);
      usedNew.add(target.url);
      const done = await isolate(
        { direction: "outbound", podUrl: target.url },
        { value: "write-failed" },
        async () => {
          let podEtag = strongEtag(target.stored.etag);
          const rebased = byReference
            ? rebaseDocument(target.stored.dataset, old.podUrl, target.url)
            : undefined;
          if (rebased) {
            const written = await writer.write(
              {
                slug: slug(target.url),
                dataset: rebased,
                category: "sync-resolution",
                forClass: `${NS.PROV}Entity`,
                skipRegistration: true,
              },
              { ifMatch: podEtag },
            );
            podEtag = await writtenEtag(written, await hash(rebased, target.url));
          }
          await links.move(old.podUrl, {
            ...old,
            podUrl: target.url,
            podEtag,
            pendingDelete: false,
            deleteHeldRuns: undefined,
          });
          if (byReference) forceUpdate.add(target.url);
        },
      );
      if (done) moved++;
    }
    // Exact mapped-content pairs, one-to-one only.
    const olds = new Map<string, SyncLink[]>();
    for (const link of vanished.values())
      olds.set(link.lastSyncedHash as string, [
        ...(olds.get(link.lastSyncedHash as string) ?? []),
        link,
      ]);
    for (const [digest, group] of olds) {
      const news = arrivals.filter((arrival) => arrival.digest === digest);
      if (!news.length) continue;
      const [old] = group;
      const [target] = news;
      if (group.length !== 1 || news.length !== 1 || !old || !target) {
        ambiguousMove = true;
        for (const link of group) usedOld.add(link.podUrl);
        for (const arrival of news) usedNew.add(arrival.url);
        continue;
      }
      await pair(old, target, false);
    }
    // Reference pairs: one arrival naming one vanished link that no other arrival names.
    const open = arrivals.filter((arrival) => !usedNew.has(arrival.url));
    const referrers = new Map<string, number>();
    for (const arrival of open)
      for (const ref of arrival.refs)
        if (!usedOld.has(ref)) referrers.set(ref, (referrers.get(ref) ?? 0) + 1);
    const pairs: [SyncLink, Arrival][] = [];
    for (const arrival of open) {
      const refs = [...arrival.refs].filter((ref) => !usedOld.has(ref));
      if (!refs.length) continue;
      const [ref] = refs;
      const old = ref === undefined ? undefined : vanished.get(ref);
      if (refs.length !== 1 || !old || referrers.get(old.podUrl) !== 1) {
        ambiguousMove = true;
        continue;
      }
      pairs.push([old, arrival]);
    }
    for (const [old, arrival] of pairs) await pair(old, arrival, true);
  }
  /** A pod resource recreated over a tombstone becomes a manual conflict, never a create. */
  async function tombstoneActivity(url: string): Promise<void> {
    const link = links.byPodUrl(url);
    if (!link || (link.status !== "trashed" && link.status !== "pod-deleted")) return;
    const stage: Stage = { value: "read-failed" };
    await isolate({ direction: "outbound", podUrl: url }, stage, async () => {
      const stored = await current(url);
      if (!stored) return;
      stage.value = "hash-failed";
      const digest = await hash(stored.dataset, url);
      stage.value = "write-failed";
      const version = strongEtag(stored.etag);
      const snapshotUrl = writer.resolve(await snapshotSlug(url, version, digest));
      if (link.conflict?.resolution === "manual" && link.conflict.snapshotUrl === snapshotUrl)
        return;
      await snapshot(url, stored.dataset, version);
      await links.put({
        ...link,
        conflict: {
          snapshotUrl,
          remoteVersion: link.remoteVersion ?? version,
          resolution: "manual",
        },
      });
    });
  }
  /** Link-store housekeeping before inbound: interrupted moves, duplicates and tombstone GC. */
  async function housekeeping(): Promise<void> {
    for (const stale of [...links.staleMoves()])
      await isolate(
        { direction: "outbound", podUrl: stale.podUrl },
        { value: "write-failed" },
        async () => {
          const mover = stale.remoteId ? links.byRemoteId(stale.remoteId) : undefined;
          await links.delete(stale.podUrl);
          links.resolved(stale.podUrl);
          if (mover?.movedFrom) await links.put({ ...mover, movedFrom: undefined });
        },
      );
    for (const duplicate of [...links.duplicates()]) {
      const stage: Stage = { value: "read-failed" };
      await isolate({ direction: "outbound", podUrl: duplicate.podUrl }, stage, async () => {
        const stored = await current(duplicate.podUrl);
        stage.value = "write-failed";
        if (!stored) await links.delete(duplicate.podUrl);
        else {
          const snapshotUrl = await snapshot(
            duplicate.podUrl,
            stored.dataset,
            strongEtag(stored.etag),
          );
          await links.put({
            podUrl: duplicate.podUrl,
            pendingCreate: duplicate.pendingCreate,
            conflict: {
              snapshotUrl,
              remoteVersion: duplicate.remoteVersion ?? strongEtag(stored.etag),
              ...(duplicate.remoteId ? { remoteId: duplicate.remoteId } : {}),
              resolution: "manual",
            },
          });
        }
        links.resolved(duplicate.podUrl);
      });
    }
    const cutoff = now().getTime() - TOMBSTONE_RETENTION_MS;
    for (const link of links.all()) {
      if (link.status !== "trashed" && link.status !== "pod-deleted") continue;
      if (link.conflict?.resolution === "manual") continue; // The owner still has to decide.
      await isolate(
        { direction: "outbound", podUrl: link.podUrl },
        { value: "write-failed" },
        async () => {
          if (!link.deletedAt) await links.put({ ...link, deletedAt: now().toISOString() });
          else if (Date.parse(link.deletedAt) <= cutoff) await links.delete(link.podUrl);
        },
      );
    }
  }
  try {
    check();
    await hash(copyDataset(), root); // Validate the field declaration even on an empty run.
    await links.load();
    linksLoaded = true;
    await housekeeping();
    // Recover remote identities before inbound mapping, avoiding a second pod copy after a crash.
    for (const link of links.all()) {
      if (!isOpenCreate(link)) continue;
      unresolvedCreates.add(link.podUrl);
      const stage: Stage = { value: "remote-failed" };
      await isolate({ direction: "outbound", podUrl: link.podUrl }, stage, async () => {
        const settled = await settleCreate(link);
        if (!isOpenCreate(settled)) return;
        // The key lookup missed. A create whose pod resource is gone is never re-sent:
        // retire it into a visible manual conflict instead of keeping it open forever.
        stage.value = "read-failed";
        if (await current(settled.podUrl)) return;
        stage.value = "write-failed";
        await retireCreate(settled);
      });
    }
    for (const link of links.all())
      if (link.status === "remote-deleted" && link.remoteId)
        await remoteDelete(link.remoteId, link.remoteVersion as string);
    // First two-way run of a connection: a full inbound without the delta cursor links the
    // items an earlier one-way import wrote, before any outbound create could duplicate them.
    const adopting = links.adoptedAt === undefined;
    const outcome = await adapter.import({
      api,
      signal,
      scopes: ports.scopes,
      cursor: adopting ? undefined : (ports.cursor ?? ports.state?.cursor),
      resolve: writer.resolve,
      read: session.read,
      progress: (progress) => {
        check();
        ports.onProgress?.(progress);
      },
      write: async (doc, conditions) => {
        const normalized = normalize(doc);
        if (mapped(writer.resolve(normalized.slug)))
          throw new Error("Use ctx.sync.upsert for mapped resources.");
        return session.write(normalized, conditions);
      },
      writeBinary: async (doc) => {
        if (mapped(writer.resolve(doc.slug)))
          throw new Error("Mapped resources must be RDF and use ctx.sync.upsert.");
        return session.writeBinary(doc);
      },
      remove: async (value) => {
        if (mapped(writer.resolve(value)))
          throw new Error("Use ctx.sync.delete for mapped resources.");
        return session.remove(value);
      },
      sync: {
        pendingRemoteIds: () => {
          const ids = new Set<string>();
          for (const link of links.all())
            if (
              link.remoteId &&
              !link.status &&
              (link.needsInbound || link.conflict?.resolution === "manual")
            )
              ids.add(link.remoteId);
          for (const item of pendingAfterRun())
            if (item.direction === "inbound" && item.remoteId) ids.add(item.remoteId);
          return [...ids];
        },
        resolve: async (remoteId, prefix, idempotencyKey) => {
          check();
          checkedText(remoteId);
          if (typeof prefix !== "string" || prefix.length > 512)
            throw new Error("Invalid sync item prefix.");
          if (!containerUrls.includes(writer.resolve(`${prefix.replace(/\/$/, "")}/`)))
            throw new Error("Sync item prefix must be a declared write-back container.");
          const linked = links.byRemoteId(remoteId);
          if (linked) return linked.podUrl;
          if (idempotencyKey !== undefined) {
            const intent = links.byCreateKey(checkedText(idempotencyKey));
            if (isOpenCreate(intent) && intent) return intent.podUrl;
          }
          return writer.resolve(await syncItemSlug(prefix, remoteId));
        },
        upsert,
        delete: remoteDelete,
        fail: (remoteId) => {
          skip({
            direction: "inbound",
            remoteId: typeof remoteId === "string" && remoteId ? remoteId : undefined,
            reason: "mapping-failed",
          });
        },
      },
    });
    check();
    if (
      links
        .all()
        .some(
          (link) =>
            link.needsInbound &&
            !link.status &&
            link.remoteId &&
            !skips.has(skipKey({ direction: "inbound", remoteId: link.remoteId })),
        )
    )
      throw new Error(
        "Inbound adapter must fetch pending remote identities before advancing its checkpoint.",
      );
    const listing = await scanWriteBack(
      writer,
      containers,
      maxResources,
      signal,
      ports.notifications,
      (url) => skip({ direction: "outbound", podUrl: url, reason: "unsupported-resource" }),
    );
    await detectMoves(listing);
    for (const url of listing.keys()) await tombstoneActivity(url);
    if (settings.writeBack) {
      for (const [url, etag] of listing) {
        const link = links.byPodUrl(url);
        // Skip only when both validators are known and equal (and nothing else is pending).
        if (
          link &&
          !link.pendingCreate &&
          !forceUpdate.has(url) &&
          !resolvesManual(link) &&
          link.podEtag !== undefined &&
          etag != null &&
          link.podEtag === etag
        )
          continue;
        await execute(url);
      }
    }
    // Safety net: a run that saw an unlinked import or an ambiguous move candidate cannot
    // tell a rename from a delete, so it propagates no pod deletes.
    const holdDeletes =
      ambiguousMove ||
      [...skips.values()].some(
        (item) => item.direction === "outbound" && item.reason === "unlinked-import",
      );
    for (const link of links.all()) {
      if (link.status) continue;
      const stage: Stage = { value: "read-failed" };
      await isolate({ direction: "outbound", podUrl: link.podUrl }, stage, async () => {
        if (!link.remoteId) {
          // A conflict-only duplicate whose pod resource is gone has nothing left to resolve.
          if (!link.pendingCreate && link.conflict && !listing.has(link.podUrl))
            if (!(await current(link.podUrl))) await links.delete(link.podUrl);
          return;
        }
        const held = link.pendingDelete || link.deleteHeldRuns !== undefined;
        if (listing.has(link.podUrl)) {
          if (held && (await current(link.podUrl)))
            await links.put({ ...link, pendingDelete: false, deleteHeldRuns: undefined });
          return;
        }
        if (await current(link.podUrl)) {
          if (held) await links.put({ ...link, pendingDelete: false, deleteHeldRuns: undefined });
          return;
        } // Listing omission alone is never a delete.
        stage.value = "write-failed";
        const manual = link.conflict?.resolution === "manual";
        if (holdDeletes && !manual) {
          // The vanished item may be the unlinked arrival: never delete it at the provider
          // this run. A second consecutive held run hands the decision to the owner.
          const runs = (link.deleteHeldRuns ?? 0) + 1;
          if (runs < MAX_DELETE_HOLDS) {
            await links.put({ ...link, pendingDelete: true, deleteHeldRuns: runs });
            return;
          }
          const remoteVersion = checkedText(link.remoteVersion);
          // The pod side of this conflict is "deleted": an empty snapshot.
          const snapshotUrl = await snapshot(link.podUrl, copyDataset(), remoteVersion);
          await links.put({
            ...link,
            pendingDelete: true,
            deleteHeldRuns: undefined,
            conflict: { snapshotUrl, remoteVersion, resolution: "manual" },
          });
          return;
        }
        if (!settings.writeBack || !settings.propagateDeletes || manual) {
          if (!link.pendingDelete || link.deleteHeldRuns !== undefined)
            await links.put({ ...link, pendingDelete: true, deleteHeldRuns: undefined });
          return;
        }
        stage.value = "remote-failed";
        request();
        startOutbound(link.podUrl);
        await adapter.deleteRemote(
          link.remoteId,
          remoteOptions({ ifMatch: checkedText(link.remoteVersion) }),
        );
        check();
        outbound.deleted++;
        stage.value = "write-failed";
        await links.put({
          ...link,
          status: "pod-deleted",
          pendingDelete: false,
          deleteHeldRuns: undefined,
          deletedAt: now().toISOString(),
        });
      });
    }
    // Exactly one Activity for the outbound batch, in addition to the import Activity.
    await recordOutbound();
    const finalHealth = health();
    const inboundPending = finalHealth.pending.filter((item) => item.direction === "inbound");
    // Never let a cursor advance lose an inbound item the manifest could not retain.
    // Nor one without a remote identity, which cannot be retried by id.
    const cursorHeld = inboundUnkeyed || inboundPending.length > MAX_PENDING_ITEMS;
    await links.saveManifest({
      ...(adopting && !cursorHeld ? { adoptedAt: now() } : {}),
      pending: finalHealth.pending,
    });
    check();
    const { indexUrl } = await writer.registerType(session.registrations());
    await session.finish();
    check();
    const sessionState = session.state(outcome);
    const state = {
      ...sessionState,
      ...(cursorHeld ? { cursor: ports.state?.cursor } : {}),
      sync: healthCounts(finalHealth),
    };
    ports.onState?.(state);
    return {
      adapterId: id,
      mode: "live",
      written: session.written,
      categories: [
        ...new Set(
          session.written
            .filter((w) => adapter.metadata.categories.includes(w.category))
            .map((w) => w.category),
        ),
      ],
      cursor: state.cursor,
      skipped: outcome.skipped,
      indexUrl,
      state,
      conflicts: finalHealth.conflicts,
      pendingDeletes: finalHealth.pendingDeletes,
      failed: finalHealth.failed,
      unlinkedImports: finalHealth.unlinkedImports,
      deferred: finalHealth.deferred,
      moved,
      cursorHeld,
      outbound,
      issues: finalHealth.issues,
      skippedItems: finalHealth.pending.slice(0, MAX_REPORTED_SKIPS),
    };
  } catch (error) {
    if (signal?.aborted) session.release();
    else
      try {
        await recordOutbound();
        await session.finish();
      } catch {
        /* Retain the original failure. */
        session.release();
      }
    const failedHealth = linksLoaded ? health() : undefined;
    ports.onState?.({
      ...session.state(),
      sync: failedHealth ? healthCounts(failedHealth) : ports.state?.sync,
    });
    throw signal?.aborted ? signal.reason : error;
  }
}
