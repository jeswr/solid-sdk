// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { abortablePodWriter } from "../abort.js";
import { RunBudget } from "../budget.js";
import { IntegrationSyncError } from "../errors.js";
import type { ImportReport } from "../import-runner.js";
import { createImportSession, MAX_RUN_SOURCES } from "../import-session.js";
import { copyDataset } from "../incremental.js";
import type { BinaryDoc, NormalisedDoc, PodWriter, WrittenDoc } from "../types.js";
import { resolveConflict } from "./conflict.js";
import { scanWriteBack } from "./detection.js";
import { canonicalHash, datasetBytes, sha256 } from "./hash.js";
import {
  accountKey,
  checkedText,
  createLinkStore,
  MAX_SYNC_LINKS,
  strongEtag,
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
  TwoWayAdapter,
} from "./types.js";
import { SyncMetadata } from "./vocab.js";

export interface TwoWaySyncReport extends ImportReport {
  readonly conflicts: number;
  readonly pendingDeletes: number;
  readonly outbound: {
    readonly created: number;
    readonly updated: number;
    readonly deleted: number;
  };
  /** Owner-only link records carry the URLs, versions and resolution for the health UI. */
  readonly issues: readonly SyncLink[];
}
type Stored = NonNullable<Awaited<ReturnType<PodWriter["read"]>>>;

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
  resolveConflict(settings.conflictPolicy, undefined, undefined, settings.skewGuardMs);
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
  const links = createLinkStore(writer, account, id);
  let linksLoaded = false;
  function health() {
    const issues = links.all().filter((link) => link.conflict || link.pendingDelete);
    return {
      issues,
      conflicts: issues.filter((link) => link.conflict).length,
      pendingDeletes: issues.filter((link) => link.pendingDelete).length,
    };
  }
  const session = createImportSession(
    writer,
    id,
    `urn:solid:connector:${encodeURIComponent(id)}:source`,
    ports,
  );
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
  const now = ports.now ?? (() => new Date());
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
    const { Provenance, PROV } = await import("../provenance.js");
    const dataset = copyDataset();
    const activity = new Provenance(outboundActivity, dataset, DataFactory);
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
  const hash = (dataset: DatasetCore) => canonicalHash(dataset, adapter.fieldsForHash);
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
    if (!stored || (await hash(stored.dataset)) !== expectedHash)
      throw new Error("Pod resource changed during sync write.");
    return strongEtag(stored.etag);
  }
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
    const target = await snapshotSlug(url, version, await hash(dataset), expiry !== undefined);
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
    } else if (
      (await hash(snapshotPayload(existing.dataset, snapshotUrl, url))) !== (await hash(dataset))
    )
      throw new Error("Snapshot identity mismatch.");
    return snapshotUrl;
  }
  async function preserveSnapshotLinks(url: string, incoming: DatasetCore, stored?: Stored) {
    if (!stored) return;
    const target = new SyncMetadata(url, incoming, DataFactory);
    for (const previous of new SyncMetadata(url, stored.dataset, DataFactory).snapshots)
      target.snapshots.add(previous);
  }
  async function upsert(item: RemoteItem): Promise<void> {
    check();
    budget.items(1);
    const identity = resultIdentity(item);
    const document = normalize(item.document);
    const url = writer.resolve(document.slug);
    const link = links.byRemoteId(identity.remoteId);
    if (link && link.podUrl !== url)
      throw new Error("Resolve linked pod URL before mapping the remote item.");
    if (!link && links.byPodUrl(url)) throw new Error("Pod URL belongs to another sync identity.");
    const stored = await current(url);
    const incomingHash = await hash(document.dataset);
    const localHash = stored ? await hash(stored.dataset) : undefined;
    const resolvingManual =
      link?.conflict?.resolution === "manual" &&
      ["remote-wins", "pod-wins"].includes(settings.conflictPolicy ?? "lww");
    // A key lookup may return a version edited AFTER our create. Verify mapped content
    // before treating that recovered/current version as our own echo.
    // Unmapped provider changes must not compete with a local mapped edit either.
    if (link && !link.status && !resolvingManual && incomingHash === link.lastSyncedHash) {
      if (link.needsInbound || link.remoteVersion !== identity.remoteVersion)
        await links.put({
          ...link,
          remoteVersion: identity.remoteVersion,
          needsInbound: undefined,
        });
      return;
    }
    // A retained manual conflict can be replayed without rewriting the item. Compare
    // content as well as version: providers may use coarse updated_at timestamps.
    if (
      link?.conflict?.resolution === "manual" &&
      !link.needsInbound &&
      !link.status &&
      !resolvingManual &&
      link.conflict.snapshotUrl ===
        writer.resolve(await snapshotSlug(url, identity.remoteVersion, incomingHash))
    )
      return;
    if (link?.status) return; // Tombstones are durable; recreation requires explicit host intervention.
    if (link && !stored) {
      const snapshotUrl = await snapshot(url, document.dataset, identity.remoteVersion);
      await links.put({
        ...link,
        conflict: { snapshotUrl, remoteVersion: identity.remoteVersion, resolution: "manual" },
        pendingDelete: true,
        needsInbound: undefined,
      });
      return;
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
      return;
    }
    let conflict: SyncLink["conflict"];
    if (stored && (!link || localHash !== link.lastSyncedHash)) {
      // Recording a snapshot changes Last-Modified itself. It must not turn an
      // unresolved clock ambiguity into an automatic winner on the next replay.
      const resolution =
        link?.conflict?.resolution === "manual" && !resolvingManual
          ? "manual"
          : resolveConflict(
              settings.conflictPolicy,
              item.modifiedAt,
              stored.lastModified,
              settings.skewGuardMs,
            );
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
        await links.put({ ...link, ...identity, podUrl: url, conflict, needsInbound: undefined });
        return;
      }
    }
    const copy = copyDataset(document.dataset);
    await preserveSnapshotLinks(url, copy, stored);
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
  }
  async function remoteDelete(remoteId: string, remoteVersion: string): Promise<void> {
    check();
    budget.items(1);
    checkedText(remoteVersion);
    let link = links.byRemoteId(checkedText(remoteId));
    if (!link || link.status === "trashed" || link.status === "pod-deleted") return;
    const stored = await current(link.podUrl);
    if (!stored) {
      await links.put({ ...link, status: "trashed", pendingDelete: false });
      return;
    }
    const trashUrl = await snapshot(
      link.podUrl,
      stored.dataset,
      strongEtag(stored.etag),
      new Date(now().getTime() + 30 * 86_400_000),
    );
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
    await links.put({ ...link, status: "trashed", pendingDelete: false });
  }
  async function settleCreate(link: SyncLink): Promise<SyncLink> {
    if (!link.pendingCreate) return link;
    request();
    const found = await adapter.findByIdempotencyKey(
      link.pendingCreate.key,
      remoteOptions({ idempotencyKey: link.pendingCreate.key }),
    );
    check();
    if (!found) return link;
    const updated: SyncLink = {
      ...link,
      ...resultIdentity(found),
      podEtag: link.pendingCreate.podEtag,
      lastSyncedHash: link.pendingCreate.hash,
      pendingCreate: undefined,
      needsInbound: true,
    };
    await links.put(updated);
    return updated;
  }
  async function execute(url: string): Promise<void> {
    let link = links.byPodUrl(url);
    if (link?.status || link?.conflict?.resolution === "manual") return;
    if (link?.needsInbound)
      throw new Error(
        "Remote write must be verified by inbound mapping before another outbound write.",
      );
    if (link?.pendingCreate) link = await settleCreate(link);
    if (link?.needsInbound) throw new Error("Recovered remote write needs inbound mapping.");
    const stored = await current(url);
    if (!stored) return;
    const localHash = await hash(stored.dataset);
    if (link?.lastSyncedHash === localHash) {
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
      await writer.ensureOwnerOnly(slug(link.pendingCreate.resourceUrl));
      const original = await writer.read(slug(link.pendingCreate.resourceUrl));
      const payload = original
        ? snapshotPayload(original.dataset, link.pendingCreate.resourceUrl, url)
        : undefined;
      if (!payload || (await hash(payload)) !== link.pendingCreate.hash)
        throw new Error("Missing pending create snapshot.");
      resource = {
        ...resource,
        dataset: payload,
        etag: link.pendingCreate.podEtag,
      };
      sentHash = link.pendingCreate.hash;
    }
    check();
    const op = await adapter.toRemote(resource);
    check();
    request();
    startOutbound(url);
    const result = resultIdentity(
      await adapter.applyRemote(
        op,
        remoteOptions({ idempotencyKey: link?.pendingCreate?.key, ifMatch: link?.remoteVersion }),
      ),
    );
    check();
    if (link?.remoteId && result.remoteId !== link.remoteId)
      throw new Error("Remote update changed identity.");
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
    });
  }
  try {
    check();
    await hash(copyDataset()); // Validate the field declaration even on an empty run.
    await links.load();
    linksLoaded = true;
    // Recover remote identities before inbound mapping, avoiding a second pod copy after a crash.
    for (const link of links.all()) if (link.pendingCreate) await settleCreate(link);
    for (const link of links.all())
      if (link.status === "remote-deleted" && link.remoteId)
        await remoteDelete(link.remoteId, link.remoteVersion as string);
    const outcome = await adapter.import({
      api,
      signal,
      scopes: ports.scopes,
      cursor: ports.cursor ?? ports.state?.cursor,
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
        pendingRemoteIds: () =>
          links
            .all()
            .filter((link) => link.needsInbound && !link.status && link.remoteId)
            .map((link) => link.remoteId as string),
        resolve: async (remoteId, fallback) => {
          check();
          return links.byRemoteId(remoteId)?.podUrl ?? writer.resolve(fallback);
        },
        upsert,
        delete: remoteDelete,
      },
    });
    check();
    if (links.all().some((link) => link.needsInbound && !link.status))
      throw new Error(
        "Inbound adapter must fetch pending remote identities before advancing its checkpoint.",
      );
    const listing = await scanWriteBack(
      writer,
      containers,
      maxResources,
      signal,
      ports.notifications,
    );
    if (settings.writeBack) {
      for (const [url, etag] of listing) {
        const link = links.byPodUrl(url);
        if (!link?.pendingCreate && link?.podEtag === etag) continue;
        await execute(url);
      }
    }
    for (const link of links.all()) {
      if (link.status || !link.remoteId) continue;
      if (listing.has(link.podUrl)) {
        if (link.pendingDelete && (await current(link.podUrl)))
          await links.put({ ...link, pendingDelete: false });
        continue;
      }
      if (await current(link.podUrl)) {
        if (link.pendingDelete) await links.put({ ...link, pendingDelete: false });
        continue;
      } // Listing omission alone is never a delete.
      if (
        !settings.writeBack ||
        !settings.propagateDeletes ||
        link.conflict?.resolution === "manual"
      ) {
        if (!link.pendingDelete) await links.put({ ...link, pendingDelete: true });
        continue;
      }
      request();
      startOutbound(link.podUrl);
      await adapter.deleteRemote(
        link.remoteId,
        remoteOptions({ ifMatch: checkedText(link.remoteVersion) }),
      );
      check();
      outbound.deleted++;
      await links.put({ ...link, status: "pod-deleted", pendingDelete: false });
    }
    // Exactly one Activity for the outbound batch, in addition to the import Activity.
    await recordOutbound();
    const { issues: healthLinks, conflicts, pendingDeletes } = health();
    check();
    const { indexUrl } = await writer.registerType(session.registrations());
    await session.finish();
    check();
    const state = { ...session.state(outcome), sync: { conflicts, pendingDeletes } };
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
      conflicts,
      pendingDeletes,
      outbound,
      issues: healthLinks,
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
      sync: failedHealth
        ? { conflicts: failedHealth.conflicts, pendingDeletes: failedHealth.pendingDeletes }
        : ports.state?.sync,
    });
    throw signal?.aborted ? signal.reason : error;
  }
}
