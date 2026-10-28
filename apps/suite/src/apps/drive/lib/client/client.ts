// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
/**
 * The Drive screens' storage seam. Screens and operations only see
 * {@link DriveClient}; this module implements it over Solid LDP with an
 * injected (authenticated) `fetch`. It is the interim adapter until the SDK
 * `StorageClient` (ADR-003) and the DRV-00 model land, at which point the
 * implementation swaps and the interface stays.
 */

import { fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { Container, Resource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { mapConcurrent } from "../../../../lib/parallel";
import { resolveContentType } from "../files/resolve-content-type";
import {
  type AccessState,
  accessControl,
  accessGains,
  type ConfirmAccess,
  DriveAccessError,
  type OwnAccess,
  privateAcl,
  requireAccess,
} from "./access";
import {
  type ArchivedAcl,
  ancestorGuard,
  type ContainerPolicy,
  policyArchiveOf,
  requirePolicy,
} from "./ancestors";
import { DriveDeletePendingError, deletionControl, rethrowPendingDeletion } from "./deletion";
import { protectionLedger } from "./protection-ledger";
import { containerData, relocate, sameGraph } from "./rdf";

export type { ContainerPolicy } from "./ancestors";
export { policyArchiveOf } from "./ancestors";
export { DriveDeletePendingError } from "./deletion";

/** Resolve historical ancestor requirements, falling back to verified owner-only access. */
export interface AncestorPolicy {
  readonly kind: "protect-ancestors";
}
export interface PreservePolicy {
  readonly kind: "preserve-source";
}
export type MovePolicy = PreservePolicy | { readonly kind: "confirm-move" };

/** One row in a Drive listing. */
export interface DriveItem {
  readonly url: string;
  readonly name: string;
  readonly kind: "folder" | "file";
  readonly contentType?: string;
  readonly size?: number;
  readonly modified?: Date;
  readonly etag?: string;
  /** A durable own-ACL requirement is still awaiting verification. */
  readonly protectionRequired?: true;
}

export interface WriteOptions {
  readonly contentType: string;
  /** Rewritten restore: install the archived source ACL before any payload. */
  readonly restoreFrom?: { url: string; etag: string };
  /** `"*"`: fail with {@link DriveConflictError} when the target exists. */
  readonly ifNoneMatch?: "*";
  /** Overwrite only this version. */
  readonly ifMatch?: string;
}

export interface MoveResult {
  readonly url: string;
  /** Identity of the copied version, captured inside the move. */
  readonly etag?: string;
  readonly children?: readonly string[];
  /** Every copied identity and the final container memberships verified by the move. */
  readonly tree?: readonly MoveResource[];
}

export interface MoveResource {
  readonly url: string;
  readonly etag: string;
  readonly children?: readonly string[];
}

export interface DriveClient {
  readonly storageUrl: string;
  readonly confirmAccess?: ConfirmAccess;
  /** Children of a folder (hidden dot-names included; the UI filters them). */
  list(folderUrl: string, options?: { signal?: AbortSignal }): Promise<DriveItem[]>;
  /** Metadata for one item (HEAD), optionally conditional on the expected version. */
  stat(url: string, options?: { ifMatch: string }): Promise<DriveItem>;
  read(url: string): Promise<Blob>;
  /** Bytes and validator from the same GET, for subsequent conditional deletion. */
  readVersion(url: string): Promise<{ body: Blob; etag?: string }>;
  /** Parsed RDF and its validator; `undefined` when the resource does not exist. */
  readRdf(url: string): Promise<{ dataset: Store; etag?: string } | undefined>;
  write(
    url: string,
    body: Blob | string,
    options: WriteOptions,
    policy: AncestorPolicy,
  ): Promise<{ etag?: string }>;
  createFolder(url: string, policy: ContainerPolicy): Promise<void>;
  /** Establish owner-only default access before writing the Trash index or bytes. */
  prepareTrash(
    url: string,
    policy: Extract<ContainerPolicy, { kind: "owner-only" }>,
  ): Promise<void>;
  /** Merge surviving container data and restore the policy for a recreated container. */
  mergeContainer(from: string, to: string, policy: PreservePolicy): Promise<void>;
  /** Copy a file (folders: recursive). Fails with a conflict when `to` exists. */
  copy(from: string, to: string, policy: PreservePolicy): Promise<void>;
  /** Move = copy + verified, conditional delete; returns the copied identity. */
  move(
    from: string,
    to: string,
    policy: MovePolicy,
    options?: {
      beforeDelete?: () => Promise<void>;
      privateOwner?: string;
      archiveContainers?: (archive: string) => Promise<void>;
    },
  ): Promise<MoveResult>;
  /** Non-recursive `ifMatch` deletes exactly that version without refreshing its validator. */
  remove(url: string, options?: { recursive?: boolean; ifMatch?: string }): Promise<void>;
}

export type DriveErrorKind =
  | "conflict"
  | "not-found"
  | "forbidden"
  | "unauthenticated"
  | "failed"
  | "invalid-listing"
  | "missing-validator"
  | "partial-failure"
  | "invalid-trash-record";

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    readonly status: number,
    readonly url: string,
  ) {
    super(`${kind} (${status}) at ${url}`);
    this.name = "DriveError";
  }
}

export function isMissingItem(error: unknown): boolean {
  return error instanceof DriveError && (error.status === 404 || error.status === 410);
}

/** Copies retained for recovery; a rejected DELETE may have reached the server. */
export class DrivePartialFailureError extends DriveError {
  constructor(
    url: string,
    readonly deletedSources: readonly string[],
    /** Not confirmed deleted; verify these URLs before recovery. */
    readonly unverifiedSources: readonly string[],
    readonly retainedDestinations: readonly string[],
    override readonly cause: unknown,
  ) {
    super("partial-failure", 409, url);
    this.name = "DrivePartialFailureError";
  }
}

/** An LDP member must name exactly one direct child, without URL aliases. */
function validateMember(container: string, member: string): void {
  try {
    const parent = new URL(container);
    const child = new URL(member);
    const suffix = child.pathname.slice(parent.pathname.length).replace(/\/$/, "");
    if (
      child.origin !== parent.origin ||
      child.username ||
      child.password ||
      !container.endsWith("/") ||
      !child.pathname.startsWith(parent.pathname) ||
      !suffix ||
      suffix.includes("/") ||
      /%2f|%5c/i.test(suffix) ||
      child.search ||
      child.hash ||
      child.href !== member
    )
      throw new Error("invalid container member");
  } catch {
    throw new DriveError("invalid-listing", 409, member);
  }
}

interface SourceSnapshot {
  readonly url: string;
  readonly etag: string | undefined;
  readonly children: readonly SourceSnapshot[] | undefined;
  readonly body?: Blob;
  readonly contentType?: string;
  readonly data?: Store;
  readonly access: AccessState;
  readonly demo?: boolean;
  inheritedAccess?: OwnAccess;
  targetAccess?: OwnAccess;
}

interface CreatedResource {
  readonly url: string;
  etag: string | undefined;
}

function snapshots(source: SourceSnapshot): SourceSnapshot[] {
  return [source, ...(source.children ?? []).flatMap(snapshots)];
}
function sourceUrls(source: SourceSnapshot): string[] {
  return snapshots(source).map((node) => node.url);
}

function errorFor(status: number, url: string): DriveError {
  const kind: DriveErrorKind =
    status === 409 || status === 412
      ? "conflict"
      : status === 404 || status === 410
        ? "not-found"
        : status === 403
          ? "forbidden"
          : status === 401
            ? "unauthenticated"
            : "failed";
  return new DriveError(kind, status, url);
}

/** Display name for a URL: the decoded last path segment. */
export function nameOf(url: string): string {
  const path = new URL(url).pathname;
  const segment = path.split("/").filter(Boolean).pop() ?? new URL(url).host;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The folder that contains `url` (`undefined` for a storage root). */
export function parentOf(url: string): string | undefined {
  const parsed = new URL(url);
  if (parsed.pathname === "/") return undefined;
  return new URL(url.endsWith("/") ? ".." : ".", url).href;
}

function itemFromResource(resource: Resource, knownType: string | undefined): DriveItem {
  const contentType = resource.isContainer
    ? undefined
    : resolveContentType(nameOf(resource.id), knownType, resource);
  const size = (() => {
    try {
      return resource.size;
    } catch {
      return undefined;
    }
  })();
  const modified = (() => {
    try {
      return resource.lastModified;
    } catch {
      return undefined;
    }
  })();
  return {
    url: resource.id,
    name: nameOf(resource.id),
    kind: resource.isContainer ? "folder" : "file",
    ...(contentType ? { contentType } : {}),
    ...(size !== undefined && !resource.isContainer ? { size } : {}),
    ...(modified && Number.isFinite(modified.getTime()) ? { modified } : {}),
  };
}

export function createSolidDriveClient(options: {
  storageUrl: string;
  fetch: typeof globalThis.fetch;
  confirmAccess?: ConfirmAccess;
  webId?: string;
  onPrivateFolder?: (url: string) => void;
  onProtectionChange?: (url: string) => void;
}): DriveClient {
  const { storageUrl } = options;
  const http = options.fetch;
  const access = accessControl(http, storageUrl);
  const ledger = protectionLedger(http);
  const deletion = deletionControl(http, errorFor);
  const protection = async (url: string): Promise<{ protectionRequired?: true }> =>
    (await ledger.get(url)) ? { protectionRequired: true } : {};
  let owner = options.webId;
  // Scoped to this authenticated client; listings retain their declared metadata for HEAD users.
  const resources = new Map<string, Resource>();
  const responseTypes = new Map<string, string>();
  const rememberType = (url: string, headers: Headers) => {
    const type = headers.get("content-type");
    if (type) responseTypes.set(url, type);
    return responseTypes.get(url);
  };

  const ensureOk = async (response: Response, url: string) => {
    if (!response.ok) throw errorFor(response.status, url);
    return response;
  };

  const listing = async (folderUrl: string, opts: { signal?: AbortSignal } = {}) => {
    try {
      const result = await fetchRdf(folderUrl, {
        fetch: http,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const container = new Container(folderUrl, result.dataset, DataFactory);
      const members = [...container.contains];
      for (const child of members) validateMember(folderUrl, child.id);
      return {
        etag: result.etag ?? undefined,
        dataset: result.dataset,
        headers: result.response.headers,
        items: members.map((child) => {
          const resource = new Resource(child.id, result.dataset, DataFactory);
          resources.set(child.id, resource);
          return itemFromResource(resource, responseTypes.get(child.id));
        }),
      };
    } catch (error) {
      if (error instanceof RdfFetchError && error.status !== undefined)
        throw errorFor(error.status, folderUrl);
      throw error;
    }
  };

  const list: DriveClient["list"] = async (url, opts) => {
    await provision.check(url);
    return Promise.all(
      (await listing(url, opts)).items.map(async (item) => ({
        ...item,
        ...(await protection(item.url)),
      })),
    );
  };

  const stat: DriveClient["stat"] = async (url, opts) => {
    const response = await ensureOk(
      await http(url, {
        method: "HEAD",
        ...(opts ? { headers: { "if-match": opts.ifMatch } } : {}),
      }),
      url,
    );
    const length = response.headers.get("content-length");
    const modified = response.headers.get("last-modified");
    const knownType = rememberType(url, response.headers);
    const etag = response.headers.get("etag");
    const isFolder = url.endsWith("/");
    const contentType = isFolder
      ? undefined
      : resolveContentType(nameOf(url), knownType, resources.get(url));
    return {
      url,
      name: nameOf(url),
      kind: isFolder ? "folder" : "file",
      ...(contentType ? { contentType } : {}),
      ...(length !== null && !isFolder ? { size: Number(length) } : {}),
      ...(modified ? { modified: new Date(modified) } : {}),
      ...(etag ? { etag } : {}),
      ...(await protection(url)),
    };
  };

  const readVersion: DriveClient["readVersion"] = async (url) => {
    await provision.check(url);
    const response = await ensureOk(await http(url), url);
    rememberType(url, response.headers);
    const body = await response.blob();
    const etag = response.headers.get("etag");
    return etag ? { body, etag } : { body };
  };

  const read: DriveClient["read"] = async (url) => (await readVersion(url)).body;

  const readRdf: DriveClient["readRdf"] = async (url) => {
    await provision.check(url);
    try {
      const result = await fetchRdf(url, { fetch: http });
      rememberType(url, result.response.headers);
      return result.etag
        ? { dataset: result.dataset, etag: result.etag }
        : { dataset: result.dataset };
    } catch (error) {
      if (error instanceof RdfFetchError && (error.status === 404 || error.status === 410))
        return undefined;
      if (error instanceof RdfFetchError && error.status !== undefined)
        throw errorFor(error.status, url);
      throw error;
    }
  };

  // Payload writes check ancestors and completed resource protection. An empty
  // provisioning PUT has already guarded its ancestors before taking the flight;
  // it must not enter provisioning again while that flight is held.
  const guardedWrite = async (
    url: string,
    init: RequestInit,
    creating = false,
    provisioned = false,
  ): Promise<Response> => {
    for (
      let target: string | undefined = url;
      target?.startsWith(storageUrl);
      target = parentOf(target)
    )
      await deletion.guard(target);
    if (!provisioned)
      await provision.guard(url, creating, new Headers(init.headers).get("if-none-match") === "*");
    return ensureOk(await http(url, init), url);
  };

  const write: DriveClient["write"] = async (url, body, opts, policy) => {
    requirePolicy(policy, ["protect-ancestors"]);
    if (opts.restoreFrom) {
      const source = await snapshot(opts.restoreFrom.url, true, true);
      if (source.etag !== opts.restoreFrom.etag) throw new DriveError("conflict", 412, source.url);
      if (!source.demo) {
        await preparePolicies(source, source.url, url);
        const restorePolicy =
          source.targetAccess ??
          requireAccess(
            source.access.status === "known" ? source.access : await access.effective(source.url),
            source.url,
          );
        // Rewritten Docs snapshots need the same durable protection requirement
        // and single flight as ordinary file restores, before writing any bytes.
        const empty: CreatedResource = { url, etag: undefined };
        const provisioned = await provision.file(
          url,
          restorePolicy,
          source.url,
          () =>
            rawPut(url, "", {
              "content-type": opts.contentType,
              "if-none-match": "*",
            }),
          (response) => {
            empty.etag = response.headers.get("etag") ?? undefined;
          },
        );
        try {
          const own = provisioned.policy as OwnAccess;
          const verifyPolicies = async () => {
            for (const expected of [
              own,
              ...(source.access.status === "known" ? [source.access.policy] : []),
            ]) {
              const current = await access.read(expected.url);
              if (
                current.status !== "known" ||
                current.policy.etag !== expected.etag ||
                !sameGraph(expected.dataset, current.policy.dataset)
              )
                throw new DriveAccessError("Restore policy changed");
            }
          };
          try {
            return await write(
              url,
              body,
              {
                contentType: opts.contentType,
                ifMatch: validator(url, empty.etag),
              },
              policy,
            );
          } finally {
            // Recheck policies even when a payload's acknowledgement is lost.
            // Byte equality alone cannot settle an access-control failure.
            await verifyPolicies();
          }
        } catch (error) {
          // Delete only our unchanged placeholder; retain any durable payload.
          await deleteVersion(url, empty.etag).catch(() => undefined);
          throw error;
        }
      }
    }
    const headers: Record<string, string> = { "content-type": opts.contentType };
    if (opts.ifNoneMatch) headers["if-none-match"] = opts.ifNoneMatch;
    if (opts.ifMatch) headers["if-match"] = opts.ifMatch;
    // Metadata updates may never mint a container. Even a concurrent deletion
    // must fail its precondition instead of recreating a folder outside its flight.
    if (url.endsWith("/"))
      headers["if-match"] = opts.ifMatch ?? validator(url, (await stat(url)).etag);
    const response = await guardedWrite(url, { method: "PUT", headers, body });
    // A replacement supersedes the previous listing's declarations before its refresh completes.
    resources.delete(url);
    responseTypes.delete(url);
    const etag = response.headers.get("etag");
    return etag ? { etag } : {};
  };

  const rawPut = async (target: string, body: string, headers: HeadersInit): Promise<Response> => {
    // Only the provisioner calls this seam, after guarding ancestors and while
    // holding the target's flight. Re-entering guard here reverses lock order
    // (child -> parent), and can wait on the provisioner's own unfinished work.
    return guardedWrite(
      target,
      {
        method: "PUT",
        body,
        headers,
      },
      true,
      true,
    );
  };

  const provision = ancestorGuard({
    storageUrl,
    http,
    access,
    readRdf,
    putFolder: (url) =>
      rawPut(url, "", {
        "content-type": "text/turtle",
        "if-none-match": "*",
        link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      }),
    error: errorFor,
    owner: () => owner,
    deleteVersion: (url, etag) => deletion.remove(url, etag),
    ...(options.onPrivateFolder ? { onPrivateFolder: options.onPrivateFolder } : {}),
    ...(options.onProtectionChange ? { onProtectionChange: options.onProtectionChange } : {}),
  });
  const createFolder: DriveClient["createFolder"] = async (url, policy) => {
    const target = url.endsWith("/") ? url : `${url}/`;
    await provision.folder(target, policy);
  };

  // Read and validate the complete tree before the first destination write or DELETE.
  const snapshot = async (
    url: string,
    requireValidator: boolean,
    bodies: boolean,
  ): Promise<SourceSnapshot> => {
    if (bodies) await provision.check(url);
    const policy = (headers: Headers): Promise<AccessState> =>
      bodies
        ? access.snapshot(url, headers)
        : Promise.resolve({ status: "unknown", cause: "Not read" });
    if (url.endsWith("/")) {
      const { items, etag, dataset, headers } = await listing(url);
      if (requireValidator) validator(url, etag);
      const children: SourceSnapshot[] = [];
      for (const child of items) children.push(await snapshot(child.url, requireValidator, bodies));
      const own = await policy(headers);
      return {
        url,
        etag,
        children,
        demo: headers.get("x-solid-demo-access-control") === "none",
        ...(bodies ? { data: containerData(dataset, url) } : {}),
        access: own,
      };
    }
    const response = await ensureOk(await http(url, bodies ? undefined : { method: "HEAD" }), url);
    const etag = response.headers.get("etag") ?? undefined;
    if (requireValidator) validator(url, etag);
    const own = await policy(response.headers);
    return {
      url,
      etag,
      children: undefined,
      demo: response.headers.get("x-solid-demo-access-control") === "none",
      access: own,
      ...(bodies
        ? {
            body: await response.blob(),
            contentType: response.headers.get("content-type") ?? "application/octet-stream",
          }
        : {}),
    };
  };

  function validator(url: string, etag: string | undefined): string {
    if (!etag || etag.startsWith("W/")) throw new DriveError("missing-validator", 409, url);
    return etag;
  }

  const deleteVersion = async (url: string, etag: string | undefined, recovery?: string) => {
    await deletion.remove(url, validator(url, etag), recovery);
    resources.delete(url);
    responseTypes.delete(url);
  };

  const deleteSnapshot = async (
    source: SourceSnapshot,
    deleted: string[],
    verifyCopy?: (source: SourceSnapshot) => Promise<void>,
    recovery?: (url: string) => string,
  ) => {
    await verifyCopy?.(source);
    let etag = source.etag;
    if (source.children?.length) {
      for (const child of source.children)
        await deleteSnapshot(child, deleted, verifyCopy, recovery);
      // Our own child deletions change a container's ETag. Read its new empty
      // representation, then conditionally delete it. Never walk new members.
      const current = await listing(source.url);
      if (
        current.items.length ||
        (source.data && !sameGraph(source.data, containerData(current.dataset, source.url)))
      )
        throw new DriveError("conflict", 409, source.url);
      etag = current.etag;
      await verifyCopy?.(source);
    }
    await deleteVersion(source.url, etag, recovery?.(source.url));
    deleted.push(source.url);
  };

  const copySnapshot = async (
    source: SourceSnapshot,
    to: string,
    created: CreatedResource[],
    copiedAccess: Map<string, OwnAccess>,
  ) => {
    const policy =
      source.targetAccess ?? (source.access.status === "known" ? source.access.policy : undefined);
    if (source.children) {
      const resource: CreatedResource = { url: to, etag: undefined };
      let decision: ContainerPolicy;
      if (policy) decision = { kind: "archived", acl: policy, from: source.url };
      else if (source.demo) decision = { kind: "inherit-verified" };
      else {
        const inherited = requireAccess(await access.effective(to, true), to);
        // Ordinary moves retain inheritance when it is no wider than the
        // source. Confirmed widening gets a ledger and an explicit ACL instead.
        decision =
          source.inheritedAccess && !accessGains(source.inheritedAccess, inherited).length
            ? {
                kind: "inherit-verified",
                original: {
                  ...source.inheritedAccess,
                  dataset: relocate(source.inheritedAccess.dataset, [[source.url, to]]),
                },
              }
            : { kind: "archived", acl: inherited, from: to };
      }
      const result = await provision.folder(to, decision, (response) => {
        resource.etag = response.headers.get("etag") ?? undefined;
        created.push(resource);
      });
      if (result.policy) copiedAccess.set(to, result.policy);
      const data = relocate(source.data as Store, [[source.url, to]]);
      if (data.size) {
        const saved = await write(
          to,
          await serialize([...data]),
          {
            contentType: "text/turtle",
            ifMatch: validator(to, resource.etag),
          },
          { kind: "protect-ancestors" },
        );
        resource.etag = saved.etag;
        const current = await listing(to);
        if (!sameGraph(data, containerData(current.dataset, to)))
          throw new DriveError("conflict", 409, to);
      }
      for (const child of source.children)
        await copySnapshot(
          child,
          `${to}${child.url.slice(source.url.length)}`,
          created,
          copiedAccess,
        );
    } else {
      let placeholder: CreatedResource | undefined;
      if (policy) {
        const resource: CreatedResource = { url: to, etag: undefined };
        const result = await provision.file(
          to,
          policy,
          source.url,
          () =>
            rawPut(to, "", {
              "content-type": source.contentType as string,
              "if-none-match": "*",
            }),
          (response) => {
            resource.etag = response.headers.get("etag") ?? undefined;
            created.push(resource);
          },
        );
        placeholder = resource;
        copiedAccess.set(to, result.policy as OwnAccess);
      }
      const result = await write(
        to,
        source.body as Blob,
        {
          contentType: source.contentType as string,
          ...(placeholder
            ? { ifMatch: validator(to, placeholder.etag) }
            : { ifNoneMatch: "*" as const }),
        },
        { kind: "protect-ancestors" },
      );
      if (placeholder) placeholder.etag = result.etag;
      else created.push({ url: to, etag: result.etag });
    }
  };

  const rollback = async (created: CreatedResource[]) => {
    const retained: string[] = [];
    let pending: DriveDeletePendingError | undefined;
    for (const resource of [...created].reverse()) {
      try {
        let etag = resource.etag;
        if (resource.url.endsWith("/")) {
          const current = await listing(resource.url);
          if (current.items.length) throw new DriveError("conflict", 409, resource.url);
          etag = current.etag;
        }
        await deleteVersion(resource.url, etag);
      } catch (error) {
        retained.push(resource.url);
        if (error instanceof DriveDeletePendingError) pending = error;
      }
    }
    return { retained, pending };
  };

  const preparePolicies = async (
    source: SourceSnapshot,
    from: string,
    to: string,
    privateOwner?: string,
    archiveContainers?: (archive: string) => Promise<void>,
  ) => {
    if (!source.demo) {
      if (privateOwner) {
        // WAC own grants override defaults. Archive the original policies under
        // private Trash before replacing ALL recovery grants with owner-only ones.
        const archive: Record<string, ArchivedAcl> = {};
        const containers: Record<string, ArchivedAcl> = {};
        for (const node of snapshots(source)) {
          const destination = `${to}${node.url.slice(from.length)}`;
          const original = requireAccess(
            node.access.status === "known" ? node.access : await access.effective(node.url),
            node.url,
          );
          archive[destination] = {
            resource: node.url,
            acl: original.url,
            turtle: await serialize([...original.dataset]),
          };
          if (node.children && node.access.status === "known")
            containers[node.url] = {
              resource: node.url,
              acl: node.access.policy.url,
              turtle: await serialize([...node.access.policy.dataset]),
            };
          node.targetAccess = {
            url: `${node.url}.acl`,
            etag: "",
            dataset: privateAcl(node.url, privateOwner),
          };
        }
        await archiveContainers?.(JSON.stringify(containers));
        await write(
          policyArchiveOf(to) as string,
          JSON.stringify(archive),
          {
            contentType: "application/json",
            ifNoneMatch: "*",
          },
          { kind: "protect-ancestors" },
        );
      } else {
        const archiveUrl = policyArchiveOf(from);
        if (archiveUrl) {
          const response = await http(archiveUrl);
          if (!response.ok && response.status !== 404) throw new DriveAccessError(response.status);
          if (response.ok) {
            const archive = (await response.json()) as Record<
              string,
              { resource: string; acl: string; turtle: string } | null
            >;
            for (const node of snapshots(source)) {
              const saved = archive[node.url];
              if (saved === undefined) throw new DriveAccessError("Missing archived policy");
              node.targetAccess =
                saved === null
                  ? requireAccess(
                      node.access.status === "known"
                        ? node.access
                        : await access.effective(node.url),
                      node.url,
                    )
                  : {
                      url: node.access.status === "known" ? node.access.policy.url : saved.acl,
                      etag: "",
                      dataset: relocate(
                        await parseRdf(saved.turtle, "text/turtle", { baseIRI: saved.acl }),
                        [
                          [
                            saved.acl,
                            node.access.status === "known" ? node.access.policy.url : saved.acl,
                          ],
                          [saved.resource, node.url],
                        ],
                      ),
                    };
            }
          }
        }
      }
    }
  };

  const mergeContainer: DriveClient["mergeContainer"] = async (from, to, decision) => {
    requirePolicy(decision, ["preserve-source"]);
    await provision.check(from);
    const original = await listing(from);
    const own = await access.snapshot(from, original.headers);
    const source: SourceSnapshot = {
      url: from,
      etag: original.etag,
      children: [],
      data: containerData(original.dataset, from),
      demo: original.headers.get("x-solid-demo-access-control") === "none",
      access: own,
    };
    const effective = own.status === "none" && !own.demo ? await access.effective(from) : own;
    requireAccess(effective, from);
    await preparePolicies(source, from, to);
    const policy = source.demo
      ? undefined
      : (source.targetAccess ?? requireAccess(effective, from));
    let created = false;
    try {
      // Resolve the archive before creation, then hold one flight from the
      // durable requirement through empty PUT and ACL installation/verification.
      await provision.folder(
        to,
        policy ? { kind: "archived", acl: policy, from } : { kind: "inherit-verified" },
      );
      created = true;
    } catch (error) {
      if (!(error instanceof DriveError && error.kind === "conflict")) throw error;
    }
    if (
      !created &&
      policy &&
      accessGains(access.forResource(policy, from), requireAccess(await access.effective(to), to))
        .length
    )
      throw new DriveAccessError("Existing destination grants wider access");
    try {
      const current = await listing(to);
      const data = new Store([
        ...containerData(current.dataset, to),
        ...relocate(source.data as Store, [[from, to]]),
      ]);
      if (sameGraph(containerData(current.dataset, to), data)) return;
      await write(
        to,
        await serialize([...data]),
        {
          contentType: "text/turtle",
          ifMatch: validator(to, current.etag),
        },
        { kind: "protect-ancestors" },
      );
      if (!sameGraph(data, containerData((await listing(to)).dataset, to)))
        throw new DriveError("conflict", 409, to);
    } catch (error) {
      if (created) await remove(to).catch(rethrowPendingDeletion);
      throw error;
    }
  };

  const transfer = async (
    from: string,
    to: string,
    moving: boolean,
    decision: MovePolicy,
    beforeDelete?: () => Promise<void>,
    privateOwner?: string,
    archiveContainers?: (archive: string) => Promise<void>,
  ) => {
    if (from.endsWith("/") !== to.endsWith("/") || (from.endsWith("/") && to.startsWith(from))) {
      throw new DriveError("conflict", 409, to);
    }
    const ordinaryMove =
      moving && decision.kind === "confirm-move" && !privateOwner && !policyArchiveOf(from);
    await deletion.guard(from);
    const source = await snapshot(from, moving, true);
    const nodes = snapshots(source);
    // Resolve every node, even for same-folder renames and descendants with own ACLs.
    // A missing Link or unreadable ancestor can never stand in for known absence.
    const effective = new Map<SourceSnapshot, AccessState>();
    for (const node of nodes) {
      const state =
        node.access.status === "none" && !node.access.demo
          ? await access.effective(node.url)
          : node.access;
      effective.set(node, state);
      if (state.status === "known") node.inheritedAccess = state.policy;
    }
    const unknown = nodes.some((node) => (effective.get(node) as AccessState).status === "unknown");
    // Copy, Trash and Restore preserve access, and refuse uncertainty before writes.
    if (!ordinaryMove && unknown) throw new DriveAccessError("Current access is unknown");
    await provision.guard(to, true);
    let keepAccess = !ordinaryMove;
    if (ordinaryMove && (!source.demo || unknown)) {
      const inherited: SourceSnapshot[] = [];
      const affected = (node: SourceSnapshot, protectedDefaults: boolean) => {
        if (node.access.status === "none" && !protectedDefaults) inherited.push(node);
        const protectedChildren =
          protectedDefaults ||
          (node.access.status === "known" && access.hasDefaults(node.access.policy, node.url));
        for (const child of node.children ?? []) affected(child, protectedChildren);
      };
      affected(source, false);
      if ((inherited.length > 0 && parentOf(from) !== parentOf(to)) || unknown) {
        let current: OwnAccess | undefined;
        let gains: string[];
        try {
          if (unknown) throw new DriveAccessError();
          current = requireAccess(effective.get(source) as AccessState, from);
          const destination = requireAccess(await access.effective(to, true), to);
          const widened = new Set<string>();
          for (const node of inherited)
            for (const agent of accessGains(
              requireAccess(effective.get(node) as AccessState, node.url),
              destination,
            ))
              widened.add(agent);
          gains = [...widened];
        } catch {
          gains = ["Access could not be determined (including unreadable ACLs or unsupported ACP)"];
        }
        if (gains.length) {
          if (!options.confirmAccess)
            throw new DriveAccessError("Access change requires confirmation");
          const choice = await options.confirmAccess({
            from,
            to,
            gains,
            canKeep: !!current && !unknown,
          });
          if (choice === "cancel") throw new Error("Move cancelled");
          if (choice === "keep") {
            if (!current || unknown) throw new DriveAccessError("Current access is unknown");
            source.targetAccess = current;
            keepAccess = true;
          }
        }
      }
    }
    const created: CreatedResource[] = [];
    const copiedAccess = new Map<string, OwnAccess>();
    await preparePolicies(source, from, to, privateOwner, archiveContainers);
    if (keepAccess) {
      for (const node of nodes)
        if (!node.demo && node.access.status === "none" && node.targetAccess === undefined)
          node.targetAccess = requireAccess(effective.get(node) as AccessState, node.url);
    }
    const deleted: string[] = [];
    let deleting = false;
    let verifyingCopy = false;
    const destinations = new Map<string, MoveResource>();
    const verifyDestination = async (source: Pick<SourceSnapshot, "url">) => {
      const destination = destinations.get(source.url) as CreatedResource;
      verifyingCopy = true;
      const etag = validator(destination.url, destination.etag);
      const response = await ensureOk(
        await http(destination.url, { method: "HEAD", headers: { "if-match": etag } }),
        destination.url,
      );
      // Also check servers that ignore HEAD preconditions.
      if (response.headers.get("etag") !== etag)
        throw new DriveError("conflict", 412, destination.url);
      const own = copiedAccess.get(destination.url);
      if (own) {
        const current = await access.read(own.url);
        if (
          current.status !== "known" ||
          current.policy.etag !== own.etag ||
          !sameGraph(own.dataset, current.policy.dataset)
        )
          throw new DriveAccessError("Destination policy changed");
      }
      verifyingCopy = false;
    };
    try {
      await copySnapshot(source, to, created, copiedAccess);
      if (moving) {
        await beforeDelete?.();
        verifyingCopy = true;
        const capture = async (node: SourceSnapshot) => {
          const url = `${to}${node.url.slice(from.length)}`;
          const copied = created.find((resource) => resource.url === url) as CreatedResource;
          // A later HEAD must never invent an identity missing from the PUT.
          const copiedEtag = validator(url, copied.etag);
          if (node.children) {
            // Populating a container changes its creation validator. Bind its
            // final listing to the expected children, whose PUT identities are
            // independently checked before any source deletion.
            const current = await listing(url);
            const expected = new Set(
              node.children.map((child) => `${url}${child.url.slice(node.url.length)}`),
            );
            if (
              !sameGraph(
                relocate(node.data as Store, [[node.url, url]]),
                containerData(current.dataset, url),
              ) ||
              current.items.length !== expected.size ||
              current.items.some((item) => !expected.has(item.url))
            )
              throw new DriveError("conflict", 409, url);
            destinations.set(node.url, {
              url,
              etag: node.children.length ? validator(url, current.etag) : copiedEtag,
              children: [...expected],
            });
          } else destinations.set(node.url, { url, etag: copiedEtag });
          for (const child of node.children ?? []) await capture(child);
        };
        await capture(source);
        // Independent identities can be checked together. Drain every check
        // before deleting anything or deciding whether copies can be rolled back.
        try {
          await mapConcurrent(sourceUrls(source), (url) => verifyDestination({ url }));
        } catch (error) {
          verifyingCopy = true;
          throw error;
        }
        // Each destination is checked again immediately before its source's
        // DELETE, since another child deletion may give a concurrent tab time.
        deleting = true;
        await deleteSnapshot(
          source,
          deleted,
          async (node) => {
            await beforeDelete?.();
            await verifyDestination(node);
            if (node.access.status === "known") {
              const current = await access.read(node.access.policy.url);
              if (
                current.status !== "known" ||
                current.policy.etag !== node.access.policy.etag ||
                !sameGraph(node.access.policy.dataset, current.policy.dataset)
              )
                throw new DriveAccessError("Source policy changed");
            }
          },
          (url) => `${to}${url.slice(from.length)}`,
        );
      }
    } catch (error) {
      // A network failure during DELETE is ambiguous: keep the recovery copy.
      const keep =
        verifyingCopy ||
        deleted.length ||
        (deleting &&
          (!(error instanceof DriveError) || error.kind === "not-found" || error.status >= 500));
      const cleanup = keep ? undefined : await rollback(created);
      const retained = cleanup ? cleanup.retained : created.map(({ url }) => url);
      if (!deleted.length && !retained.length) throw error;
      const unverified = sourceUrls(source).filter((url) => !deleted.includes(url));
      throw new DrivePartialFailureError(
        from,
        deleted,
        unverified,
        retained,
        cleanup?.pending ?? error,
      );
    }
    const etag = destinations.get(from)?.etag;
    return {
      url: to,
      ...(etag ? { etag } : {}),
      ...(source.children
        ? {
            children: source.children.map((child) => `${to}${child.url.slice(from.length)}`),
            tree: [...destinations.values()],
          }
        : {}),
    };
  };

  const copy: DriveClient["copy"] = async (from, to, policy) => {
    requirePolicy(policy, ["preserve-source"]);
    await transfer(from, to, false, policy);
  };

  const move: DriveClient["move"] = async (from, to, policy, opts) => {
    requirePolicy(policy, ["preserve-source", "confirm-move"]);
    return transfer(
      from,
      to,
      true,
      policy,
      opts?.beforeDelete,
      opts?.privateOwner,
      opts?.archiveContainers,
    );
  };

  const remove: DriveClient["remove"] = async (url, opts = {}) => {
    await deletion.guard(url);
    try {
      if (url.endsWith("/") && opts.recursive) {
        const source = await snapshot(url, true, false);
        const deleted: string[] = [];
        try {
          await deleteSnapshot(source, deleted);
        } catch (error) {
          if (deleted.length)
            throw new DrivePartialFailureError(
              url,
              deleted,
              sourceUrls(source).filter((url) => !deleted.includes(url)),
              [],
              error,
            );
          throw error;
        }
      } else {
        await deleteVersion(url, opts.ifMatch ?? (await stat(url)).etag);
      }
    } catch (error) {
      if (!isMissingItem(error) || (error as DriveError).url !== url) throw error;
      await deletion.forget(url);
    }
  };

  return {
    storageUrl,
    ...(options.confirmAccess ? { confirmAccess: options.confirmAccess } : {}),
    list,
    stat,
    read,
    readVersion,
    readRdf,
    write,
    createFolder,
    mergeContainer,
    prepareTrash: async (url, decision) => {
      requirePolicy(decision, ["owner-only"]);
      const webId = decision.webId;
      if (webId) owner = webId;
      const response = await http(url, { method: "HEAD" });
      if (response.headers.get("x-solid-demo-access-control") === "none") return;
      if (!webId) throw new DriveAccessError("Owner WebID unavailable");
      const policy: OwnAccess = { url: `${url}.acl`, etag: "", dataset: privateAcl(url, webId) };
      try {
        await provision.folder(url, decision);
      } catch (error) {
        if (!(error instanceof DriveError && error.kind === "conflict"))
          throw new DriveAccessError(error);
        await provision.protect(url, policy);
      }
    },
    copy,
    move,
    remove,
  };
}
