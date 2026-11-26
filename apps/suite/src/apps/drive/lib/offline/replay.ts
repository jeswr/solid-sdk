// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.2-Astra
/**
 * Drive's guarded offline replay (sst-8xm.74.1). A queued Drive change is delivered only
 * through Drive's own client, with the same provisioning and access checks as online:
 * a new folder is an inherit-verified create, and a text save is a protect-ancestors
 * conditional write that must still see the access discovery captured when the file
 * was opened. The outbox never replays these through a bare storage client.
 */
import { StorageError, type StorageErrorCode } from "@jeswr/storage-client";
import type { GuardedDelivery, ReplayDelegate } from "@jeswr/suite-sdk/offline";
import { DriveAccessError, isEndpointCapture } from "../client/access";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
  type DriveItem,
  nameOf,
  parentOf,
} from "../client/client";
import { childUrl, createFolder } from "../operations/operations";
import { normalizeUploadName, suffixedName } from "../upload";
import { type DriveGuardKind, isDriveContent } from "./guards";
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

function assertions(delivery: GuardedDelivery): {
  kind?: unknown;
  source?: unknown;
  discovery?: unknown;
} {
  const value = delivery.assertions;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** How many earlier kept copies of one file a "keep both" retry reads before making a new one. */
const MAX_KEPT_COPIES = 8;

/** Whether `url` now holds exactly `bytes`; a larger body is read only up to that size. */
async function holds(client: DriveClient, url: string, bytes: Uint8Array | null): Promise<boolean> {
  const expected = bytes ?? new Uint8Array();
  const current = await client.readLimited(url, expected.byteLength);
  if (!current || current.size !== expected.byteLength) return false;
  const actual = new Uint8Array(await current.arrayBuffer());
  return actual.every((byte, index) => byte === expected[index]);
}

/**
 * Find an earlier copy with the queued bytes and no wider access. The outbox names
 * each attempt anew, including retries after a lost acknowledgement.
 */
async function keptCopy(
  client: DriveClient,
  siblings: readonly DriveItem[],
  source: string,
  bytes: Uint8Array | null,
): Promise<string | undefined> {
  if (!client.bindAccess) return undefined;
  const original = nameOf(source);
  const size = bytes?.byteLength ?? 0;
  const candidates = siblings.filter((item) => {
    if (item.kind !== "file" || (item.size !== undefined && item.size !== size)) return false;
    return [...item.name.matchAll(/-conflict-(\d{1,16})/g)].some(([suffix]) => {
      try {
        return suffixedName(original, suffix) === item.name;
      } catch {
        return false;
      }
    });
  });
  for (const item of candidates.slice(0, MAX_KEPT_COPIES)) {
    try {
      // Restore's binding checks effective grants on both files, including inherited ACLs.
      const binding = await client.bindAccess(source, item.url);
      if (!(await holds(client, item.url, bytes))) continue;
      await binding.recheck();
      return item.url;
    } catch (error) {
      if (!(error instanceof DriveAccessError) || isNetworkFailure(error)) throw error;
    }
  }
  return undefined;
}

/**
 * The suffix of the outbox's "keep both" name for `source` (`<stem>-conflict-<ms><ext>`), or
 * none when `name` is not one. Drive re-applies it to the file's own name, so a long name is
 * shortened before the suffix rather than after it.
 */
function conflictSuffix(source: string, name: string): string | undefined {
  let original: string;
  try {
    original = decodeURIComponent(new URL(source).pathname.split("/").pop() ?? "");
  } catch {
    return undefined;
  }
  const dot = original.lastIndexOf(".");
  const stem = dot > 0 ? original.slice(0, dot) : original;
  const ext = dot > 0 ? original.slice(dot) : "";
  const prefix = `${stem}-conflict-`;
  if (!original || !name.startsWith(prefix) || !name.endsWith(ext)) return undefined;
  const stamp = name.slice(prefix.length, name.length - ext.length);
  return /^\d{1,16}$/.test(stamp) ? `-conflict-${stamp}` : undefined;
}

/** The delivery shapes Drive queues; anything else is refused before any request. */
function shape(root: string, delivery: GuardedDelivery): DriveGuardKind {
  const kind = assertions(delivery).kind;
  const container = delivery.container;
  const createsIn =
    delivery.op === "create" && isDriveContent(root, container) && container.endsWith("/");
  if (kind === "folder" && createsIn && delivery.purpose === "replay") return kind;
  if (kind === "text") {
    // Text creates exist only as a conflict's "keep both" copy.
    if (createsIn && delivery.purpose === "resolve-both") return kind;
    if (
      delivery.op === "write" &&
      delivery.purpose !== "resolve-both" &&
      isDriveContent(root, delivery.url) &&
      !delivery.url.endsWith("/")
    )
      return kind;
  }
  refuse(delivery, "This queued change is not one Drive makes.");
}

export interface DriveReplayOptions {
  /** Drive's root: every queued Drive change, and the file a kept copy keeps, lies inside it. */
  readonly root: string;
  readonly makeClient?: (session: ReplaySession) => DriveClient;
  /**
   * A queued folder's name was already taken by a folder when it synced, so that folder is
   * used instead. It may be another device's or app's, with its own access; the user is told.
   */
  readonly onExistingFolder?: (url: string) => void;
}

const STRONG_ETAG = /^"[\x21\x23-\x7e\x80-\xff]*"$/;
const LDP_TYPE = /<http:\/\/www\.w3\.org\/ns\/ldp#([A-Za-z]+)>\s*;\s*rel="?type"?/g;

/**
 * Whether `url` answers as a folder itself: a 2xx without following a redirect, and, when the
 * server names LDP types, a container among them.
 */
async function isFolder(session: ReplaySession, url: string, signal: AbortSignal) {
  const head = await session.fetch(url, { method: "HEAD", redirect: "manual", signal });
  if (!head.ok || head.redirected || head.type === "opaqueredirect") return false;
  const types = [...(head.headers.get("link") ?? "").matchAll(LDP_TYPE)].map(([, type]) => type);
  return !types.length || types.includes("Container") || types.includes("BasicContainer");
}

/** Build the session's Drive replay delegate. */
export function driveReplayDelegate({
  root,
  makeClient = ({ fetch, storageUrl, webId }) =>
    createSolidDriveClient({ storageUrl, fetch, webId }),
  onExistingFolder,
}: DriveReplayOptions): (session: ReplaySession) => ReplayDelegate {
  return (session) => async (delivery, ctx) => {
    // Re-check the delivered request, not just the stored one.
    const kind = shape(root, delivery);
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
          if (!(await isFolder(session, url, ctx.signal))) throw error;
          onExistingFolder?.(url);
          return { url, etag: null, created: false };
        }
      }
      const contentType = delivery.contentType ?? "application/octet-stream";
      if (delivery.op === "create") {
        const name = delivery.createOptions?.name;
        if (!name) refuse(delivery, "This queued copy has no name.");
        const { source, discovery } = assertions(delivery);
        if (
          typeof source !== "string" ||
          !isEndpointCapture(discovery) ||
          !isDriveContent(root, source) ||
          source.endsWith("/") ||
          parentOf(source) !== container
        )
          refuse(delivery, "This queued copy doesn't name the file it keeps.");
        const suffix = conflictSuffix(source, name);
        if (!suffix) refuse(delivery, "This queued copy's name isn't one Drive keeps.");
        // "Keep both" copies the file, so the copy keeps the file's own access, as Drive's
        // "Make a copy" does (preserve-source). A plain upload would inherit the folder's
        // access, which can be wider than a file with its own ACL.
        const verifyHeaders = client.discoveryVerifier(source, discovery);
        const { etag } = await client.stat(source);
        if (!etag || !STRONG_ETAG.test(etag))
          throw new DriveError("missing-validator", 409, source);
        const siblings = await client.list(container);
        const kept = await keptCopy(client, siblings, source, delivery.body);
        if (kept) {
          await client.stat(source, { ifMatch: etag, verifyHeaders });
          return { url: kept, etag: null, created: false };
        }
        // A rejected sibling can occupy the outbox's proposed name.
        const original = nameOf(source);
        const occupied = new Set(siblings.map((item) => item.name));
        let copyName = suffixedName(original, suffix);
        for (let stamp = Date.now(); occupied.has(copyName); stamp++)
          copyName = suffixedName(original, `-conflict-${stamp}`);
        const url = childUrl(container, copyName);
        const payload = body(delivery, contentType);
        await client.write(
          url,
          payload,
          { contentType, restoreFrom: { url: source, etag, verifyHeaders, recoveryBody: payload } },
          { kind: "protect-ancestors" },
        );
        return { url, etag: null, created: true };
      }
      const { discovery } = assertions(delivery);
      // Only a strong validator: a weak one never matches, and "*" would overwrite anything.
      const { ifMatch } = delivery;
      if (!isEndpointCapture(discovery) || !ifMatch || !STRONG_ETAG.test(ifMatch))
        refuse(delivery, "This queued save has no version to check against.");
      let written: { etag?: string };
      try {
        written = await client.write(
          delivery.url,
          body(delivery, contentType),
          {
            contentType,
            ifMatch,
            verifyHeaders: client.discoveryVerifier(delivery.url, discovery),
          },
          { kind: "protect-ancestors" },
        );
      } catch (error) {
        // An earlier attempt whose answer was lost may have landed: the stored If-Match is
        // then stale, but the file already holds these bytes. That is done, not a conflict.
        if (
          error instanceof DriveError &&
          error.status === 412 &&
          (await holds(client, delivery.url, delivery.body))
        )
          return { url: delivery.url, etag: null, created: false };
        throw error;
      }
      // A receipt-less write certifies no version; the next save must read again.
      return { url: delivery.url, etag: written.etag ?? null, created: false };
    } catch (error) {
      throw storageError(error, delivery, ctx.signal.aborted);
    }
  };
}
