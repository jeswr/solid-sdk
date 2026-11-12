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
import { createFolder, uploadFile } from "../operations/operations";
import { DRIVE_FOLDER_TAG, driveGuardPolicy } from "./guards";

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

/** Map Drive's failures onto the outbox's classification; network failures pass through. */
function storageError(error: unknown, delivery: GuardedDelivery): unknown {
  if (error instanceof StorageError || error instanceof TypeError) return error;
  const status = error instanceof DriveError ? error.status : null;
  return new StorageError(
    (status && STATUS_CODES[status]) || (status && status >= 500 ? "server" : "bad-request"),
    {
      url: delivery.url,
      method: "PUT",
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

/** Build the session's delegate for one Drive tag. */
export function driveReplayDelegate(
  tag: string,
  makeClient: (session: ReplaySession) => DriveClient = ({ fetch, storageUrl, webId }) =>
    createSolidDriveClient({ storageUrl, fetch, webId }),
): (session: ReplaySession) => ReplayDelegate {
  return (session) => {
    const policy = driveGuardPolicy(tag, session.storageUrl);
    return async (delivery) => {
      // Re-check the delivered request, not just the stored one.
      if (!policy(delivery)) refuse(delivery, "This queued change is outside Drive's storage.");
      const client = makeClient(session);
      try {
        if (tag === DRIVE_FOLDER_TAG) {
          const name = delivery.createOptions?.name;
          if (!name || delivery.createOptions?.kind !== "container")
            refuse(delivery, "This queued folder has no name.");
          const url = await createFolder(client, delivery.container as string, name);
          return { url, etag: null, created: true };
        }
        const contentType = delivery.contentType ?? "application/octet-stream";
        if (delivery.op === "create") {
          const name = delivery.createOptions?.name;
          if (!name) refuse(delivery, "This queued copy has no name.");
          const saved = await uploadFile(
            client,
            delivery.container as string,
            body(delivery, contentType),
            name,
            "fail",
            undefined,
            contentType,
          );
          // With "fail", a name clash throws; only "skip" resolves without an item.
          return { url: (saved as DriveItem).url, etag: null, created: true };
        }
        const discovery = (delivery.assertions as { discovery?: unknown } | undefined)?.discovery;
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
        throw storageError(error, delivery);
      }
    };
  };
}
