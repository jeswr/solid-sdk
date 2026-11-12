// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
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
import type { SyncLink } from "./types.js";

/** Framework metadata; all suite term bases come from suite-vocab. */
export const SYNC = {
  Link: `${NS.CORE}ConnectorSyncLink`,
  podUrl: `${NS.CORE}connectorPodUrl`,
  remoteId: `${NS.CORE}connectorRemoteId`,
  remoteVersion: `${NS.CORE}connectorRemoteVersion`,
  podEtag: `${NS.CORE}connectorPodEtag`,
  lastSyncedHash: `${NS.CORE}connectorLastSyncedHash`,
  needsInbound: `${NS.CORE}connectorNeedsInbound`,
  createKey: `${NS.CORE}connectorPendingCreateKey`,
  createHash: `${NS.CORE}connectorPendingCreateHash`,
  createEtag: `${NS.CORE}connectorPendingCreateEtag`,
  createResource: `${NS.CORE}connectorPendingCreateResource`,
  conflictResource: `${NS.CORE}connectorConflictResource`,
  conflictVersion: `${NS.CORE}connectorConflictVersion`,
  conflictResolution: `${NS.CORE}connectorConflictResolution`,
  pendingDelete: `${NS.CORE}connectorPendingDelete`,
  status: `${NS.CORE}connectorSyncStatus`,
  trashUrl: `${NS.CORE}connectorTrashUrl`,
  snapshot: `${NS.CORE}connectorConflictSnapshot`,
  revisionOf: `${NS.PROV}wasRevisionOf`,
  expires: `${NS.SCHEMA}expires`,
} as const;

/** Typed access to every stored link field. No JSON blobs or untyped triple construction. */
export class LinkRecord extends PodThing {
  private text(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, LiteralAs.string);
  }
  private iri(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
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
    if (
      [key, hash, etag, resourceUrl].some((v) => v !== undefined) &&
      !(key && hash && etag && resourceUrl)
    )
      throw new Error("Incomplete create intent.");
    if (
      [snapshotUrl, version, resolution].some((v) => v !== undefined) &&
      !(snapshotUrl && version && resolution)
    )
      throw new Error("Incomplete conflict record.");
    return {
      podUrl,
      remoteId: this.text(SYNC.remoteId),
      remoteVersion: this.text(SYNC.remoteVersion),
      podEtag: this.text(SYNC.podEtag),
      lastSyncedHash: this.text(SYNC.lastSyncedHash),
      needsInbound: OptionalFrom.subjectPredicate(this, SYNC.needsInbound, LiteralAs.boolean),
      pendingCreate: key
        ? { key, hash: hash as string, podEtag: etag as string, resourceUrl: resourceUrl as string }
        : undefined,
      conflict: snapshotUrl
        ? {
            snapshotUrl,
            remoteVersion: version as string,
            resolution: resolution as NonNullable<SyncLink["conflict"]>["resolution"],
          }
        : undefined,
      pendingDelete: OptionalFrom.subjectPredicate(this, SYNC.pendingDelete, LiteralAs.boolean),
      status: this.text(SYNC.status) as SyncLink["status"],
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
      [SYNC.conflictResolution, value?.conflict?.resolution],
      [SYNC.status, value?.status],
    ] as const;
    for (const [predicate, text] of strings)
      OptionalAs.object(this, predicate, text, LiteralFrom.string);
    for (const [predicate, iri] of [
      [SYNC.createResource, value?.pendingCreate?.resourceUrl],
      [SYNC.conflictResource, value?.conflict?.snapshotUrl],
      [SYNC.trashUrl, value?.trashUrl],
    ] as const)
      OptionalAs.object(this, predicate, iri, NamedNodeFrom.string);
    OptionalAs.object(this, SYNC.pendingDelete, value?.pendingDelete, LiteralFrom.boolean);
    OptionalAs.object(this, SYNC.needsInbound, value?.needsInbound, LiteralFrom.boolean);
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
