// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { moveGrants, planMoveGrants, setGrants } from "./client.js";
import { isRoleError } from "./errors.js";
import { load, scoped } from "./http.js";
import { rolesToModes } from "./mapping.js";
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
  /** Destination resource URLs whose own grants were reapplied. */
  reapplied: string[];
  /** Original resource URLs and own grants that the destination cannot express. */
  dropped: { url: string; grant: RoleGrant; reason: string }[];
}
/** Recovery failures retain both locations and the original failure in `cause`. */
export interface MovePreservingAccessError extends StorageError {
  step: "reapply" | "rollback-failed";
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
function etag(value: string | null, url: string): string {
  if (value === null || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value))
    throw new StorageError("precondition-required", {
      url,
      method: "MOVE",
      message: "Move requires a strong ETag",
    });
  return value;
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
/**
 * Preserve own WAC/ACP roles around an emulated move. Inherited access follows the new
 * ancestors. Native moves bypass access entirely. Recovery deliberately ignores caller abort.
 */
export async function movePreservingAccess(
  storage: StorageClient,
  from: string,
  to: string,
  options: MovePreservingAccessOptions,
): Promise<MovePreservingAccessResult> {
  // Snapshot caller options before the first await.
  options = { ...options, root: options.root ?? storage.root };
  const { signal } = options;
  scoped(from, storage.root);
  scoped(to, storage.root);
  signal?.throwIfAborted();
  const head = await storage.head(from, { ...(signal ? { signal } : {}) });
  const moveOptions = {
    ...(options.name !== undefined ? { name: options.name } : {}),
    ifMatch: etag(head.etag, from),
    ...(signal ? { signal } : {}),
  };
  if (storage.features.move.state === "available" && storage.features.move.detail.native) {
    const moved = await storage.move(from, to, moveOptions);
    return { url: moved.url, preserved: true, reapplied: [], dropped: [] };
  }
  if (storage.protocol !== "solid")
    throw unsupported(from, "Emulated access preservation requires Solid roles");
  if (options.commentsContainer)
    throw unsupported(from, "Moves with a separate comments container require a scope-aware move");
  const destination = await load(to, roleOptions(options, false, signal));
  const pending = [{ url: from, head }];
  const seen = new Set([from]);
  const auxiliaries = new Set<string>();
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i] as (typeof pending)[number];
    for (const rel of ["acl", "http://www.w3.org/ns/solid/acp#accessControl", "describedby"])
      for (const link of item.head.links.get(rel) ?? []) auxiliaries.add(link.target);
    if (item.head.metadataUrl) auxiliaries.add(item.head.metadataUrl);
    if (item.head.kind !== "container") continue;
    for await (const child of storage.listAll(item.url, { ...(signal ? { signal } : {}) })) {
      signal?.throwIfAborted();
      scoped(child.url, storage.root);
      if (!child.url.startsWith(item.url) || child.url === item.url || seen.has(child.url))
        throw unsupported(from, "Move listing contains a duplicate or non-descendant");
      seen.add(child.url);
      if (seen.size > MAX_MEMBERS)
        throw new StorageError("unsupported", {
          url: from,
          method: "MOVE",
          feature: "move",
          message: `Emulated moves are capped at ${MAX_MEMBERS} resources`,
        });
      pending.push({
        url: child.url,
        head: await storage.head(child.url, { ...(signal ? { signal } : {}) }),
      });
    }
  }
  const dropped: MovePreservingAccessResult["dropped"] = [];
  const snapshots: {
    url: string;
    container: boolean;
    original: RoleGrant[];
    grants: RoleGrant[];
  }[] = [];
  for (const item of pending) {
    if (item.url !== from && (auxiliaries.has(item.url) || /\.(acl|acr)$/.test(item.url))) continue;
    const container = item.head.kind === "container";
    const opts = roleOptions(options, container, signal);
    const original = await moveGrants(item.url, opts);
    const grants: RoleGrant[] = [];
    for (const grant of original) {
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
    // Preflight the complete replacement, including caller lockout, without creating anything.
    await planMoveGrants(item.url, to, grants, opts);
    snapshots.push({ url: item.url, container, original, grants });
  }
  signal?.throwIfAborted();
  const moved = await storage.move(from, to, moveOptions);
  const reapplied: string[] = [];
  try {
    scoped(moved.url, storage.root);
    for (const item of snapshots) {
      signal?.throwIfAborted();
      const url = moved.url + item.url.slice(from.length);
      await apply(url, item.grants, roleOptions(options, item.container, signal));
      reapplied.push(url);
    }
    signal?.throwIfAborted();
    return { url: moved.url, preserved: dropped.length === 0, reapplied, dropped };
  } catch (error) {
    let location = moved.url;
    try {
      const current = await storage.head(moved.url);
      const returned = await storage.move(
        moved.url,
        new URL(from.endsWith("/") ? ".." : ".", from).href,
        {
          name: decodeURIComponent(from.replace(/\/$/, "").split("/").at(-1) as string),
          ifMatch: etag(current.etag, moved.url),
        },
      );
      location = returned.url;
      if (returned.url !== from) throw new Error("Rollback returned a different URL");
      for (const item of snapshots)
        await apply(item.url, item.original, roleOptions(options, item.container, undefined));
    } catch (rollbackError) {
      throw failure(
        "rollback-failed",
        from,
        moved.url,
        new AggregateError([error, rollbackError], "Reapplication and rollback failed"),
        location,
      );
    }
    throw failure("reapply", from, moved.url, error, from);
  }
}
