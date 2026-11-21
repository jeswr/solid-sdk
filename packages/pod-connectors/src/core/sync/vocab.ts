// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { CONNECTOR_SYNC, NS } from "@jeswr/suite-vocab";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
} from "@rdfjs/wrapper";
import { PodThing } from "../vocab.js";
import type { SyncLink, SyncSkip, SyncSkipReason } from "./types.js";

/**
 * Framework metadata. Connector sync terms come from @jeswr/suite-vocab (CONNECTOR_SYNC);
 * the two standard terms keep their published namespaces.
 */
export const SYNC = {
  ...CONNECTOR_SYNC,
  revisionOf: `${NS.PROV}wasRevisionOf`,
  expires: `${NS.SCHEMA}expires`,
} as const;

/** Predicates a link record may carry; everything else in a shard is rejected. */
export const LINK_RECORD_PREDICATES: ReadonlySet<string> = new Set([
  `${NS.RDF}type`,
  SYNC.podUrl,
  SYNC.remoteId,
  SYNC.remoteVersion,
  SYNC.podEtag,
  SYNC.lastSyncedHash,
  SYNC.needsInbound,
  SYNC.createKey,
  SYNC.createHash,
  SYNC.createEtag,
  SYNC.createResource,
  SYNC.createAttempts,
  SYNC.conflictResource,
  SYNC.conflictVersion,
  SYNC.conflictRemoteId,
  SYNC.conflictResolution,
  SYNC.pendingDelete,
  SYNC.deleteHeldRuns,
  SYNC.status,
  SYNC.deletedAt,
  SYNC.movedFrom,
  SYNC.trashUrl,
]);
/** Predicates of a base shard's header subject. */
export const LINK_SHARD_PREDICATES: ReadonlySet<string> = new Set([
  `${NS.RDF}type`,
  SYNC.overflowCount,
]);
/** Predicates of the manifest and its pending-item subjects. */
export const LINK_MANIFEST_PREDICATES: ReadonlySet<string> = new Set([
  `${NS.RDF}type`,
  SYNC.shardSalt,
  SYNC.adoptedAt,
  SYNC.remoteId,
  SYNC.podUrl,
  SYNC.errorClass,
  SYNC.direction,
]);

/** Typed access to every stored link field. No JSON blobs or untyped triple construction. */
export class LinkRecord extends PodThing {
  private text(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, LiteralAs.string);
  }
  private iri(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
  }
  /** A small non-negative counter; anything else is a malformed record. */
  private count(predicate: string): number | undefined {
    const value = OptionalFrom.subjectPredicate(this, predicate, LiteralAs.number);
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 1_000))
      throw new Error("Invalid sync counter.");
    return value;
  }
  get podUrl(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SYNC.podUrl, NamedNodeAs.string);
  }
  set podUrl(value: string | undefined) {
    OptionalAs.object(this, SYNC.podUrl, value, NamedNodeFrom.string);
  }
  get record(): SyncLink | undefined {
    const podUrl = this.podUrl;
    if (!podUrl) return undefined;
    const key = this.text(SYNC.createKey);
    const hash = this.text(SYNC.createHash);
    const etag = this.text(SYNC.createEtag);
    const resourceUrl = this.iri(SYNC.createResource);
    const snapshotUrl = this.iri(SYNC.conflictResource);
    const version = this.text(SYNC.conflictVersion);
    const resolution = this.text(SYNC.conflictResolution);
    const conflictRemoteId = this.text(SYNC.conflictRemoteId);
    if (
      [key, hash, etag, resourceUrl].some((v) => v !== undefined) &&
      !(key && hash && etag && resourceUrl)
    )
      throw new Error("Incomplete create intent.");
    if (
      [snapshotUrl, version, resolution, conflictRemoteId].some((v) => v !== undefined) &&
      !(snapshotUrl && version && resolution)
    )
      throw new Error("Incomplete conflict record.");
    const attempts = this.count(SYNC.createAttempts);
    const deleteHeldRuns = this.count(SYNC.deleteHeldRuns);
    if (attempts !== undefined && !key) throw new Error("Incomplete create intent.");
    const deletedAt = OptionalFrom.subjectPredicate(this, SYNC.deletedAt, LiteralAs.date);
    if (deletedAt && !Number.isFinite(deletedAt.getTime()))
      throw new Error("Invalid sync deletion time.");
    return {
      podUrl,
      remoteId: this.text(SYNC.remoteId),
      remoteVersion: this.text(SYNC.remoteVersion),
      podEtag: this.text(SYNC.podEtag),
      lastSyncedHash: this.text(SYNC.lastSyncedHash),
      needsInbound: OptionalFrom.subjectPredicate(this, SYNC.needsInbound, LiteralAs.boolean),
      pendingCreate: key
        ? {
            key,
            hash: hash as string,
            podEtag: etag as string,
            resourceUrl: resourceUrl as string,
            ...(attempts === undefined ? {} : { attempts }),
          }
        : undefined,
      conflict: snapshotUrl
        ? {
            snapshotUrl,
            remoteVersion: version as string,
            resolution: resolution as NonNullable<SyncLink["conflict"]>["resolution"],
            ...(conflictRemoteId === undefined ? {} : { remoteId: conflictRemoteId }),
          }
        : undefined,
      pendingDelete: OptionalFrom.subjectPredicate(this, SYNC.pendingDelete, LiteralAs.boolean),
      ...(deleteHeldRuns === undefined ? {} : { deleteHeldRuns }),
      status: this.text(SYNC.status) as SyncLink["status"],
      deletedAt: deletedAt?.toISOString(),
      movedFrom: this.iri(SYNC.movedFrom),
      trashUrl: this.iri(SYNC.trashUrl),
    };
  }
  set record(value: SyncLink | undefined) {
    this.podUrl = value?.podUrl;
    const strings = [
      [SYNC.remoteId, value?.remoteId],
      [SYNC.remoteVersion, value?.remoteVersion],
      [SYNC.podEtag, value?.podEtag],
      [SYNC.lastSyncedHash, value?.lastSyncedHash],
      [SYNC.createKey, value?.pendingCreate?.key],
      [SYNC.createHash, value?.pendingCreate?.hash],
      [SYNC.createEtag, value?.pendingCreate?.podEtag],
      [SYNC.conflictVersion, value?.conflict?.remoteVersion],
      [SYNC.conflictRemoteId, value?.conflict?.remoteId],
      [SYNC.conflictResolution, value?.conflict?.resolution],
      [SYNC.status, value?.status],
    ] as const;
    for (const [predicate, text] of strings)
      OptionalAs.object(this, predicate, text, LiteralFrom.string);
    for (const [predicate, iri] of [
      [SYNC.createResource, value?.pendingCreate?.resourceUrl],
      [SYNC.conflictResource, value?.conflict?.snapshotUrl],
      [SYNC.trashUrl, value?.trashUrl],
      [SYNC.movedFrom, value?.movedFrom],
    ] as const)
      OptionalAs.object(this, predicate, iri, NamedNodeFrom.string);
    OptionalAs.object(this, SYNC.pendingDelete, value?.pendingDelete, LiteralFrom.boolean);
    OptionalAs.object(
      this,
      SYNC.createAttempts,
      value?.pendingCreate?.attempts,
      LiteralFrom.integer,
    );
    OptionalAs.object(this, SYNC.deleteHeldRuns, value?.deleteHeldRuns, LiteralFrom.integer);
    OptionalAs.object(this, SYNC.needsInbound, value?.needsInbound, LiteralFrom.boolean);
    OptionalAs.object(
      this,
      SYNC.deletedAt,
      value?.deletedAt === undefined ? undefined : new Date(value.deletedAt),
      LiteralFrom.dateTime,
    );
  }
}

/** Header of a base link shard: how many overflow documents follow it. */
export class LinkShardHeader extends PodThing {
  get overflowCount(): number | undefined {
    return OptionalFrom.subjectPredicate(this, SYNC.overflowCount, LiteralAs.number);
  }
  set overflowCount(value: number | undefined) {
    OptionalAs.object(this, SYNC.overflowCount, value, LiteralFrom.integer);
  }
}

/** Owner-only per-connection manifest: HMAC shard salt and the adoption marker. */
export class LinkManifest extends PodThing {
  get salt(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SYNC.shardSalt, LiteralAs.string);
  }
  set salt(value: string | undefined) {
    OptionalAs.object(this, SYNC.shardSalt, value, LiteralFrom.string);
  }
  get adoptedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, SYNC.adoptedAt, LiteralAs.date);
  }
  set adoptedAt(value: Date | undefined) {
    OptionalAs.object(this, SYNC.adoptedAt, value, LiteralFrom.dateTime);
  }
}

/** One skipped/deferred item retained by the manifest; carries only a fixed reason class. */
export class PendingItemRecord extends PodThing {
  get item(): SyncSkip | undefined {
    const direction = OptionalFrom.subjectPredicate(this, SYNC.direction, LiteralAs.string);
    const reason = OptionalFrom.subjectPredicate(this, SYNC.errorClass, LiteralAs.string);
    if (!direction || !reason) return undefined;
    return {
      direction: direction as SyncSkip["direction"],
      reason: reason as SyncSkipReason,
      remoteId: OptionalFrom.subjectPredicate(this, SYNC.remoteId, LiteralAs.string),
      podUrl: OptionalFrom.subjectPredicate(this, SYNC.podUrl, NamedNodeAs.string),
    };
  }
  set item(value: SyncSkip | undefined) {
    OptionalAs.object(this, SYNC.direction, value?.direction, LiteralFrom.string);
    OptionalAs.object(this, SYNC.errorClass, value?.reason, LiteralFrom.string);
    OptionalAs.object(this, SYNC.remoteId, value?.remoteId, LiteralFrom.string);
    OptionalAs.object(this, SYNC.podUrl, value?.podUrl, NamedNodeFrom.string);
  }
}

export class SyncMetadata extends PodThing {
  get snapshots(): Set<string> {
    return SetFrom.subjectPredicate(this, SYNC.snapshot, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get revisionOf(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SYNC.revisionOf, NamedNodeAs.string);
  }
  set revisionOf(value: string | undefined) {
    OptionalAs.object(this, SYNC.revisionOf, value, NamedNodeFrom.string);
  }
  get expires(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, SYNC.expires, LiteralAs.date);
  }
  set expires(value: Date | undefined) {
    OptionalAs.object(this, SYNC.expires, value, LiteralFrom.dateTime);
  }
}
