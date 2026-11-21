// AUTHORED-BY Claude Opus 5.5
/**
 * Drive's guarded offline replay (sst-8xm.74.1). A queued Drive change is delivered only
 * through Drive's own client, with the same provisioning and access checks as online:
 * a new folder is an inherit-verified create, and a text save is a protect-ancestors
 * conditional write that must still see the access discovery captured when the file
 * was opened. The outbox never replays these through a bare storage client.
 */
import { StorageError, type StorageErrorCode } from "@jeswr/storage-client";
import type { GuardedDelivery, ReplayDelegate } from "@jeswr/suite-sdk/offline";
import { isEndpointCapture } from "../client/access";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
  type DriveItem,
} from "../client/client";
import { childUrl, createFolder, uploadFile } from "../operations/operations";
import { normalizeUploadName } from "../upload";
import { type DriveGuardKind, inside, isPolicyDocument } from "./guards";
import { isNetworkFailure } from "./network";

interface ReplaySession {
  readonly fetch: typeof globalThis.fetch;
  readonly storageUrl: string;
  readonly webId: string;
}

const STATUS_CODES: Readonly<Record<number, StorageErrorCode>> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not-found",
  409: "conflict",
  410: "not-found",
  412: "precondition-failed",
  428: "precondition-required",
};

/**
 * Map Drive's failures onto the outbox's classification. A request that got no answer, or
 * one cut off by the session ending, stays queued (`network`); everything else is final.
 */
function storageError(error: unknown, delivery: GuardedDelivery, aborted: boolean): unknown {
  if (error instanceof StorageError) return error;
  const method = delivery.op === "create" ? "POST" : "PUT";
  if (aborted || isNetworkFailure(error))
    return new StorageError("network", { url: delivery.url, method, cause: error });
  const status = error instanceof DriveError ? error.status : null;
  return new StorageError(
    (status && STATUS_CODES[status]) || (status && status >= 500 ? "server" : "bad-request"),
    {
      url: delivery.url,
      method,
      status,
      message: error instanceof Error ? error.message : "Drive refused the queued change",
      cause: error,
    },
  );
}

function refuse(delivery: GuardedDelivery, message: string): never {
  throw new StorageError("bad-request", { url: delivery.url, method: "PUT", message });
}

function body(delivery: GuardedDelivery, contentType: string): Blob {
  return new Blob(delivery.body ? [delivery.body as BlobPart] : [], { type: contentType });
}

function assertions(delivery: GuardedDelivery): { kind?: unknown; discovery?: unknown } {
  const value = delivery.assertions;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** The delivery shapes Drive queues; anything else is refused before any request. */
function shape(storageUrl: string, delivery: GuardedDelivery): DriveGuardKind {
  const kind = assertions(delivery).kind;
  const container = delivery.container;
  const createsIn =
    delivery.op === "create" && inside(storageUrl, container) && container.endsWith("/");
  if (kind === "folder" && createsIn && delivery.purpose === "replay") return kind;
  if (kind === "text") {
    // Text creates exist only as a conflict's "keep both" copy.
    if (createsIn && delivery.purpose === "resolve-both") return kind;
    if (
      delivery.op === "write" &&
      delivery.purpose !== "resolve-both" &&
      inside(storageUrl, delivery.url) &&
      !delivery.url.endsWith("/") &&
      !isPolicyDocument(delivery.url)
    )
      return kind;
  }
  refuse(delivery, "This queued change is not one Drive makes.");
}

/** Build the session's Drive replay delegate. */
export function driveReplayDelegate(
  makeClient: (session: ReplaySession) => DriveClient = ({ fetch, storageUrl, webId }) =>
    createSolidDriveClient({ storageUrl, fetch, webId }),
): (session: ReplaySession) => ReplayDelegate {
  return (session) => async (delivery, ctx) => {
    // Re-check the delivered request, not just the stored one.
    const kind = shape(session.storageUrl, delivery);
    const client = makeClient(session);
    const container = delivery.container as string;
    try {
      if (kind === "folder") {
        const name = delivery.createOptions?.name;
        if (!name || delivery.createOptions?.kind !== "container")
          refuse(delivery, "This queued folder has no name.");
        try {
          const url = await createFolder(client, container, name);
          return { url, etag: null, created: true };
        } catch (error) {
          // A create-only folder that now exists (an earlier attempt landed, or another
          // device made it) is done, not a conflict nobody can resolve.
          if (!(error instanceof DriveError && error.status === 412)) throw error;
          const url = childUrl(container, normalizeUploadName(name, "folder"), true);
          const head = await session.fetch(url, { method: "HEAD", signal: ctx.signal });
          if (!head.ok) throw error;
          return { url, etag: null, created: false };
        }
      }
      const contentType = delivery.contentType ?? "application/octet-stream";
      if (delivery.op === "create") {
        const name = delivery.createOptions?.name;
        if (!name) refuse(delivery, "This queued copy has no name.");
        const saved = await uploadFile(
          client,
          container,
          body(delivery, contentType),
          name,
          "fail",
          undefined,
          contentType,
        );
        // With "fail", a name clash throws; only "skip" resolves without an item.
        return { url: (saved as DriveItem).url, etag: null, created: true };
      }
      const { discovery } = assertions(delivery);
      if (!isEndpointCapture(discovery) || !delivery.ifMatch)
        refuse(delivery, "This queued save has no version to check against.");
      const written = await client.write(
        delivery.url,
        body(delivery, contentType),
        {
          contentType,
          ifMatch: delivery.ifMatch,
          verifyHeaders: client.discoveryVerifier(delivery.url, discovery),
        },
        { kind: "protect-ancestors" },
      );
      // A receipt-less write certifies no version; the next save must read again.
      return { url: delivery.url, etag: written.etag ?? null, created: false };
    } catch (error) {
      throw storageError(error, delivery, ctx.signal.aborted);
    }
  };
}
