// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError, type WriteResult } from "@jeswr/storage-client";
import { moveDestination, moveGrants, planMoveGrants, readGrants, setGrants } from "./client.js";
import { isRoleError } from "./errors.js";
import { scoped } from "./http.js";
import { rolesToModes } from "./mapping.js";
import {
  checkContainerRdf,
  emptyContainerEtag,
  exactName,
  moveError,
  parent,
  sourceType,
  strongEtag,
} from "./move-tree.js";
import type { GrantMutationOptions, RoleGrant, SetGrantsOptions } from "./types.js";

/** `to` is a destination container, as in StorageClient.move; `name` is a decoded name hint. */
export interface MovePreservingAccessOptions extends GrantMutationOptions {
  name?: string;
  acceptReset?: boolean;
  signal?: AbortSignal;
}
export interface MovePreservingAccessResult {
  url: string;
  preserved: boolean;
  /** Destination URLs whose own access document was installed and verified. */
  reapplied: string[];
  /** Original resource URLs and own grants that the destination cannot express. */
  dropped: { url: string; grant: RoleGrant; reason: string }[];
}
/** Staging, cleanup and source-deletion failures retain both roots and the original cause. */
export interface MovePreservingAccessError extends StorageError {
  step: "reapply" | "rollback-failed" | "source-delete";
  from: string;
  to: string;
}
const MAX_MEMBERS = 2_000;
function failure(
  step: MovePreservingAccessError["step"],
  from: string,
  to: string,
  cause: unknown,
  location: string,
): MovePreservingAccessError {
  return Object.assign(
    new StorageError("conflict", {
      url: location,
      method: "MOVE",
      feature: "accessControl",
      retryable: false,
      message: `movePreservingAccess ${step}: ${from} -> ${to}`,
      cause,
    }),
    { step, from, to },
  );
}
function unsupported(url: string, message: string): StorageError {
  return new StorageError("unsupported", {
    url,
    method: "MOVE",
    feature: "accessControl",
    message,
  });
}
function roleOptions(
  options: MovePreservingAccessOptions,
  container: boolean,
  signal: AbortSignal | undefined,
): SetGrantsOptions {
  const transport = options.fetch;
  return {
    ...options,
    kind: container ? "folder" : (options.kind ?? "resource"),
    ownOnly: true,
    fetch: async (input, init) => {
      signal?.throwIfAborted();
      return transport(input, { ...init, ...(signal ? { signal } : {}) });
    },
  };
}
async function apply(url: string, grants: RoleGrant[], options: SetGrantsOptions): Promise<void> {
  const result = await setGrants([url], grants, options);
  if (result.failed.length) throw result.failed[0]?.error;
}
type OwnSnapshot = Awaited<ReturnType<typeof moveGrants>>;
interface Item {
  url: string;
  container: boolean;
  etag: string;
  own: OwnSnapshot;
  grants: RoleGrant[];
}
interface Copy {
  url: string;
  container: boolean;
  etag: string | null;
}
/** The mutation's own validator, or null when the backend observed it with a later read. */
function ownEtag(result: WriteResult): string | null {
  return result.etagSource === "response" ? result.etag : null;
}
function equalRows(a: RoleGrant[], b: RoleGrant[]): boolean {
  const keys = (rows: RoleGrant[]) => rows.map((g) => JSON.stringify([g.agent, g.role])).sort();
  return JSON.stringify(keys(a)) === JSON.stringify(keys(b));
}
async function unchanged(
  storage: StorageClient,
  item: Item,
  options: SetGrantsOptions,
  signal?: AbortSignal,
) {
  const own = await moveGrants(item.url, options);
  const head = await storage.head(item.url, signal ? { signal } : {});
  if (
    own.ownUrl !== item.own.ownUrl ||
    own.ownEtag !== item.own.ownEtag ||
    own.resourceEtag !== item.own.resourceEtag ||
    head.etag !== item.etag
  )
    throw moveError(item.url, "Source content or own access changed", "conflict");
}
/**
 * Stage empty placeholders top-down, verify own access before content, then conditionally
 * delete sources bottom-up. Native moves bypass roles. Recovery never recreates source data.
 */
export async function movePreservingAccess(
  storage: StorageClient,
  from: string,
  to: string,
  options: MovePreservingAccessOptions,
): Promise<MovePreservingAccessResult> {
  options = { ...options, root: options.root ?? storage.root };
  const { signal } = options;
  scoped(from, storage.root);
  scoped(to, storage.root);
  signal?.throwIfAborted();
  const io = signal ? { signal } : {};
  const head = await storage.head(from, io);
  const moveOptions = {
    ...(options.name !== undefined ? { name: options.name } : {}),
    ifMatch: strongEtag(head.etag, from),
    ...io,
  };
  if (storage.features.move.state === "available" && storage.features.move.detail.native) {
    const moved = await storage.move(from, to, moveOptions);
    return { url: moved.url, preserved: true, reapplied: [], dropped: [] };
  }
  if (storage.protocol !== "solid")
    throw unsupported(from, "Emulated access preservation requires Solid roles");
  if (options.commentsContainer)
    throw unsupported(from, "Moves with a separate comments container require a scope-aware move");
  if (from === storage.root || !to.endsWith("/") || /[?#]/.test(from + to))
    throw moveError(from, "Move requires a non-root source and a destination container");
  if (head.kind === "container" && to.startsWith(from))
    throw moveError(from, "Cannot move a container into itself", "conflict");
  const name = options.name ?? exactName(from);
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    [...name].some((c) => {
      const code = c.codePointAt(0) as number;
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    throw new StorageError("bad-request", { url: from, method: "MOVE", message: "Invalid name" });
  const dest = scoped(
    `${to}${encodeURIComponent(name)}${head.kind === "container" ? "/" : ""}`,
    storage.root,
  );
  const destinationHead = await storage.head(to, io);
  if (destinationHead.allow && !destinationHead.allow.control)
    throw new StorageError("forbidden", {
      url: to,
      method: "MOVE",
      message: "Destination requires Control",
    });
  const destination = await moveDestination(to, roleOptions(options, false, signal));
  const pending = [{ url: from, head }];
  const seen = new Set([from]);
  const auxiliaries = new Set<string>();
  for (const item of pending) {
    for (const rel of ["acl", "http://www.w3.org/ns/solid/acp#accessControl", "describedby"])
      for (const link of item.head.links.get(rel) ?? [])
        auxiliaries.add(scoped(link.target, storage.root));
    if (item.head.metadataUrl) auxiliaries.add(scoped(item.head.metadataUrl, storage.root));
    strongEtag(item.head.etag, item.url);
    if (item.head.kind !== "container") continue;
    const members: string[] = [];
    for await (const child of storage.listAll(item.url, io)) {
      signal?.throwIfAborted();
      scoped(child.url, storage.root);
      if (parent(child.url) !== item.url || seen.has(child.url))
        throw unsupported(from, "Move listing contains a duplicate or non-child");
      seen.add(child.url);
      if (seen.size > MAX_MEMBERS)
        throw moveError(from, `Emulated moves are capped at ${MAX_MEMBERS} resources`);
      members.push(child.url);
      pending.push({ url: child.url, head: await storage.head(child.url, io) });
    }
    const rdf = await storage.readRdf(item.url, io);
    if (rdf.etag !== item.head.etag)
      throw moveError(item.url, "Source container changed during discovery", "conflict");
    checkContainerRdf(item.url, rdf.dataset, members);
  }
  const dropped: MovePreservingAccessResult["dropped"] = [];
  const snapshots: Item[] = [];
  for (const item of pending) {
    if (item.url !== from && (auxiliaries.has(item.url) || /\.(acl|acr)$/.test(item.url))) {
      auxiliaries.add(item.url);
      continue;
    }
    exactName(item.url);
    const container = item.head.kind === "container";
    const opts = roleOptions(options, container, signal);
    const own = await moveGrants(item.url, opts);
    if (own.ownEtag !== undefined) strongEtag(own.ownEtag, own.ownUrl);
    if (own.resourceEtag !== item.head.etag)
      throw moveError(item.url, "Source changed during access snapshot", "conflict");
    const grants: RoleGrant[] = [];
    for (const grant of own.grants) {
      try {
        if (grant.expiresAt !== undefined || grant.purpose !== undefined)
          throw unsupported(item.url, "Solid roles cannot express expiresAt or purpose");
        rolesToModes(grant.role, opts.kind as NonNullable<typeof opts.kind>, {
          ...opts,
          model: destination.model,
        });
        if (
          (destination.model === "wac" && grant.agent.type === "app") ||
          (destination.model === "acp" && grant.agent.type === "group")
        )
          throw unsupported(item.url, "Identity is unsupported by the destination access model");
        grants.push(grant);
      } catch (error) {
        if (!(error instanceof StorageError || isRoleError(error)) || error.code !== "unsupported")
          throw error;
        if (!options.acceptReset) throw unsupported(item.url, error.message);
        dropped.push({ url: item.url, grant, reason: error.message });
      }
    }
    await planMoveGrants(item.url, to, grants, opts, own.ownEtag !== undefined);
    snapshots.push({
      url: item.url,
      container,
      etag: strongEtag(item.head.etag, item.url),
      own,
      grants,
    });
  }
  // Delete subjects before their listed auxiliary documents. Removing an ACL first could
  // expose still-live source bytes through inheritance. Unusual placements must also admit
  // this ordering without removing a containing directory first.
  const teardown = [...pending].sort(
    (a, b) =>
      b.url.replace(/\/$/, "").split("/").length - a.url.replace(/\/$/, "").split("/").length ||
      Number(auxiliaries.has(a.url)) - Number(auxiliaries.has(b.url)),
  );
  const deletionIndex = new Map(teardown.map((item, i) => [item.url, i]));
  for (const item of snapshots) {
    const accessIndex = deletionIndex.get(item.own.ownUrl);
    if (
      accessIndex !== undefined &&
      snapshots.some(
        (subject) =>
          ((subject.url === item.url && !item.container) ||
            (item.container && subject.url.startsWith(item.url) && subject.url !== item.url)) &&
          (deletionIndex.get(subject.url) as number) > accessIndex,
      )
    )
      throw unsupported(
        item.url,
        "Source access document cannot be safely ordered after its subjects",
      );
  }
  signal?.throwIfAborted();
  const copies: Copy[] = [];
  const reapplied: string[] = [];
  try {
    for (const item of snapshots) {
      signal?.throwIfAborted();
      const opts = roleOptions(options, item.container, signal);
      await unchanged(storage, item, opts, signal);
      // Open one source stream before creating its placeholder, as storage-client does.
      // GET supplies the authoritative media type; a server may omit it from HEAD.
      const read = item.container ? undefined : await storage.read(item.url, io);
      try {
        if (read && read.etag !== item.etag)
          throw moveError(item.url, "Source bytes changed before copy", "conflict");
        const type = read ? sourceType(read.contentType, item.url) : "text/turtle";
        const url = dest + item.url.slice(from.length);
        const created = await storage.create(parent(url), "", {
          name: exactName(url),
          kind: item.container ? "container" : "resource",
          contentType: type,
          ...io,
        });
        // Only the mutation response's own ETag names our version. A follow-up HEAD may have
        // seen another writer's update, so a copy without one is kept, never written or deleted.
        const copy = { url: created.url, container: item.container, etag: ownEtag(created) };
        copies.push(copy);
        if (created.url !== url)
          throw moveError(url, "Placeholder returned a different URL", "conflict");
        await unchanged(storage, item, opts, signal);
        if (item.own.ownEtag !== undefined) {
          await apply(url, item.grants, opts);
          const verified = await readGrants(url, opts);
          if (
            !equalRows(
              verified.grants.filter((g) => !g.inherited),
              item.grants,
            )
          )
            throw moveError(url, "Destination own grants differ from the snapshot", "conflict");
          const own = await moveGrants(url, opts);
          if (own.ownEtag === undefined || !equalRows(own.grants, item.grants))
            throw moveError(url, "Destination own access was not installed", "conflict");
          reapplied.push(url);
        }
        if (read) {
          const written = await storage.write(url, read.body ?? "", {
            contentType: type,
            ifMatch: strongEtag(copy.etag, url),
            ...io,
          });
          copy.etag = ownEtag(written);
        }
      } finally {
        // Cancellation must not wait for a transport that still owns/locks this stream.
        void read?.body?.cancel().catch(() => {});
      }
    }
    // Re-read destination access after all writes, then all source validators before any DELETE.
    for (const item of snapshots) {
      const url = dest + item.url.slice(from.length);
      const opts = roleOptions(options, item.container, signal);
      const actual = await readGrants(url, opts);
      if (
        !actual.grants.some(
          (g) => g.agent.type === "webid" && g.agent.id === options.webId && g.role === "manager",
        )
      )
        throw moveError(url, "Moved item lost caller management", "conflict");
      if (
        item.own.ownEtag !== undefined &&
        !equalRows((await moveGrants(url, opts)).grants, item.grants)
      )
        throw moveError(url, "Destination access changed during staging", "conflict");
    }
    for (const item of snapshots)
      await unchanged(storage, item, roleOptions(options, item.container, signal), signal);
    for (const item of pending)
      if (auxiliaries.has(item.url) && (await storage.head(item.url, io)).etag !== item.head.etag)
        throw moveError(item.url, "Source auxiliary changed", "conflict");
    signal?.throwIfAborted();
  } catch (error) {
    const failures: unknown[] = [];
    for (const copy of [...copies].reverse()) {
      if (!copy.container && copy.etag === null) {
        failures.push(moveError(copy.url, "Copy kept: no validator for its own write", "conflict"));
        continue;
      }
      try {
        const validator = copy.container
          ? await emptyContainerEtag(storage, copy.url)
          : strongEtag(copy.etag, copy.url);
        await storage.delete(copy.url, { ifMatch: validator });
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    if (failures.length)
      throw failure(
        "rollback-failed",
        from,
        dest,
        new AggregateError([error, ...failures], "Staging and cleanup failed"),
        dest,
      );
    throw failure("reapply", from, dest, error, from);
  }
  // Once deletion starts, all copies are retained. Never roll back or recreate any source.
  try {
    for (const item of teardown) {
      signal?.throwIfAborted();
      try {
        const validator =
          item.head.kind === "container"
            ? await emptyContainerEtag(storage, item.url)
            : strongEtag(item.head.etag, item.url);
        await storage.delete(item.url, { ifMatch: validator, ...io });
      } catch (error) {
        if (
          !(
            auxiliaries.has(item.url) &&
            error instanceof StorageError &&
            error.code === "not-found"
          )
        )
          throw error;
      }
    }
  } catch (error) {
    throw failure("source-delete", from, dest, error, dest);
  }
  return { url: dest, preserved: dropped.length === 0, reapplied, dropped };
}
