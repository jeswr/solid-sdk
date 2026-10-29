// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
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

import { resolveContentType } from "../files/resolve-content-type";
import {
  type AccessBinding,
  type AccessState,
  accessControl,
  accessGains,
  bindAccess,
  type ConfirmAccess,
  DriveAccessChangedError,
  DriveAccessError,
  type OwnAccess,
  policyOwner,
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
import { discardVersion, ownsEmptyContainer } from "./cleanup";
import {
  type CommitChecks,
  type CommitEffects,
  Compensation,
  checkIdentity,
  commitHttp,
  type ResourceIdentity,
} from "./commit";
import { containerVersions } from "./container-versions";
import { deletionControl, isDeletionFailure } from "./deletion";
import { protectionLedger } from "./protection-ledger";
import { containerData, containsGraph, relocate, sameGraph } from "./rdf";
import { sourceOperation } from "./source-operations";

export type { ContainerPolicy } from "./ancestors";
export { policyArchiveOf } from "./ancestors";
export { DriveDeletePendingError } from "./deletion";

/** Resolve historical ancestor requirements, falling back to verified owner-only access. */
export interface AncestorPolicy {
  readonly kind: "protect-ancestors";
}
export type WritePolicy = AncestorPolicy | Extract<ContainerPolicy, { kind: "owner-only" }>;
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
  /** Run one logical operation with a scoped client that already owns these URLs. */
  exclusive?<T>(urls: readonly string[], work: (client: DriveClient) => Promise<T>): Promise<T>;
  readonly confirmAccess?: ConfirmAccess;
  /** Bind recovery and survivor access across a multi-step restore. */
  bindAccess?(from: string, to: string): Promise<Pick<AccessBinding, "recheck">>;
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
    policy: WritePolicy,
  ): Promise<{ etag?: string }>;
  createFolder(url: string, policy: ContainerPolicy): Promise<void>;
  /** Establish owner-only default access before writing the Trash index or bytes. */
  prepareTrash(
    url: string,
    policy: Extract<ContainerPolicy, { kind: "owner-only" }>,
  ): Promise<void>;
  /** Merge surviving container data and restore the policy for a recreated container. */
  mergeContainer(
    from: string,
    to: string,
    policy: PreservePolicy,
    options?: { readonly ifMatch?: string; readonly sourceGuards?: readonly ResourceIdentity[] },
  ): Promise<
    Pick<AccessBinding, "recheck"> & {
      readonly disarm: readonly Compensation[];
      readonly source?: ResourceIdentity;
    }
  >;
  /** Copy a file (folders: recursive). Fails with a conflict when `to` exists. */
  copy(
    from: string,
    to: string,
    policy: PreservePolicy,
    options?: { readonly ifMatch?: string; readonly sourceGuards?: readonly ResourceIdentity[] },
  ): Promise<void>;
  /** Move = copy + verified, conditional delete; returns the copied identity. */
  move(
    from: string,
    to: string,
    policy: MovePolicy,
    options?: {
      /** Source version approved by the caller; never refreshed during retries. */
      ifMatch?: string;
      beforeDelete?: () => Promise<void>;
      privateOwner?: string;
      archiveContainers?: (archive: string) => Promise<void>;
      /** Approved ancestor versions, retained through partial-tree recovery. */
      readonly sourceGuards?: readonly ResourceIdentity[];
    },
  ): Promise<MoveResult>;
  /** `ifMatch` binds files and recursive roots to the approved version. */
  remove(
    url: string,
    options?: {
      recursive?: boolean;
      ifMatch?: string;
      commit?: CommitChecks &
        Pick<CommitEffects, "disarm"> & {
          /** Pre-hydrated survivor identities checked immediately before DELETE. */
          readonly survivors?: readonly ResourceIdentity[];
        };
    },
  ): Promise<void>;
  /** Re-read durable deletion guards on load or Retry without sending DELETE. */
  recheckDeletions?(): Promise<readonly string[]>;
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
  readonly binding?: AccessBinding;
  inheritedAccess?: OwnAccess;
  targetAccess?: OwnAccess;
}

interface CreatedResource {
  readonly url: string;
  readonly source: SourceSnapshot;
  etag: string | undefined;
  data?: Store;
  protection?: OwnAccess;
  ownAcl?: { url: string; policy: OwnAccess | null } | undefined;
}

/** Payload and MIME data are hydrated before the final HTTP commit boundary. */
interface PayloadWrite extends RequestInit {
  readonly body: Blob | string;
  readonly headers: Record<string, string> & { "content-type": string };
}

interface AccessCheck {
  binding: AccessBinding;
  compensation?: Compensation;
  until?: string;
}
type AccessScope = Set<AccessCheck>;

function compensationsFor(scope: AccessScope, url: string): Compensation[] {
  return [...scope].flatMap((check) =>
    check.until === url && check.compensation ? [check.compensation] : [],
  );
}

function retireScope(scope: AccessScope, url: string): void {
  for (const check of scope) check.binding.retire(url);
}

async function recheckScope(scope: AccessScope): Promise<void> {
  for (const check of scope) {
    try {
      await check.binding.recheck();
    } catch (error) {
      await check.compensation?.rollback();
      throw error;
    }
  }
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
  const versions = containerVersions(http);
  const captureResource = (
    resource: CreatedResource,
    etag: string | null | undefined,
    headers?: Headers,
  ) => {
    if (headers && !resource.source.demo && !resource.ownAcl) {
      const endpoint = access.discover(resource.url, headers);
      if (endpoint) resource.ownAcl = { url: endpoint, policy: null };
    }
    resource.etag = etag ?? undefined;
    if (resource.url.endsWith("/")) versions.track(resource.url);
  };
  const checkContainerVersion = (resource: CreatedResource, etag: string | undefined) => {
    validator(resource.url, resource.etag);
    if (etag !== versions.current(resource.url, resource.etag))
      throw new DriveError("conflict", 412, resource.url);
  };
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
        fetch: (input, init) => http(input, { ...init, cache: "no-store" }),
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
    // Hydrate before HEAD: callers use this as their final HTTP identity check.
    const protectedState = await protection(url);
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
      ...protectedState,
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

  /** Preserve our bytes privately before clearing an exposed PUT. Never modify
   * the concurrently installed ACL, and never adopt its resource validator.
   */
  const quarantine = async (
    url: string,
    etag: string,
    policy: OwnAccess,
    copies: readonly { body: Blob | string; type: string }[],
  ): Promise<string[]> => {
    const webId = owner ?? policyOwner(policy);
    if (!webId) throw new DriveAccessError("Recovery owner unavailable");
    const folder = `${storageUrl}.drive-recovery-${crypto.randomUUID()}/`;
    await createFolder(folder, { kind: "owner-only", webId });
    const retained: string[] = [];
    for (const [index, copy] of copies.entries()) {
      const target = `${folder}${index}-${encodeURIComponent(nameOf(url))}`;
      await write(
        target,
        copy.body,
        { contentType: copy.type, ifNoneMatch: "*" },
        { kind: "protect-ancestors" },
      );
      retained.push(target);
    }
    const required = await ledger.get(url);
    try {
      const cleared = await commitHttp({
        http,
        url,
        error: errorFor,
        init: {
          method: "PUT",
          headers: {
            "if-match": etag,
            "content-type": url.endsWith("/") ? "text/turtle" : "application/octet-stream",
          },
          body: "",
        },
        response: async (response) => {
          await ensureOk(response, url);
          return response;
        },
      });
      if (required)
        await ledger.set(url, { ...required, etag: validator(url, cleared.headers.get("etag")) });
    } catch (cause) {
      throw new DrivePartialFailureError(url, [], [], retained, cause);
    }
    return retained;
  };

  // The payload/container PUT seam; quarantine clears a privately retained PUT
  // directly through commitHttp without editing a concurrently changed ACL.
  // A provisioner skips only its own unfinished ACL while creating an empty
  // placeholder, never its ancestors'.
  const guardedWrite = async (
    url: string,
    init: PayloadWrite,
    creating = false,
    verifyAccess?: () => Promise<void>,
    scope: AccessScope = new Set(),
    effects: Omit<CommitEffects, "onCommit"> &
      Pick<CommitChecks, "identityChecks"> & {
        readonly onWritten?: (response: Response) => void;
      } = {},
    required?: OwnAccess,
  ): Promise<Response> => {
    for (
      let target: string | undefined = url;
      target?.startsWith(storageUrl);
      target = parentOf(target)
    )
      await deletion.guard(target);
    await provision.guard(url, creating, new Headers(init.headers).get("if-none-match") === "*");
    if (!creating && !verifyAccess && new Headers(init.headers).get("if-none-match") === "*") {
      const current = await http(url, { method: "HEAD" });
      if (current.ok) throw errorFor(412, url);
      if (current.status !== 404) throw errorFor(current.status, url);
    }
    // Transfers/provisioning hold a two-endpoint binding and capture their PUT
    // validator before the post-write check. Standalone writes use the same helper.
    const binding =
      !creating && !verifyAccess ? await bindAccess(access, url, url, true) : undefined;
    const verifyProtection = async () => {
      if (required && accessGains(required, requireAccess(await access.effective(url), url)).length)
        throw new DriveAccessError("Owner-only protection changed");
    };
    const headers = new Headers(init.headers);
    const captured = headers.get("if-match");
    if (captured) headers.set("if-match", versions.current(url, captured) as string);
    let previous: { body: Blob; type: string } | undefined;
    if (binding && headers.get("if-none-match") !== "*") {
      const current = await http(url);
      if (current.status === 404) {
        if (!headers.has("if-match")) headers.set("if-none-match", "*");
      } else {
        await ensureOk(current, url);
        previous = {
          body: await current.blob(),
          type: current.headers.get("content-type") ?? "application/octet-stream",
        };
        if (!headers.has("if-match"))
          headers.set("if-match", validator(url, current.headers.get("etag") ?? undefined));
      }
    }
    let response: Response;
    const compensation = new Compensation(async () => {
      const etag = validator(url, response.headers.get("etag") ?? undefined);
      // Removing unchecked bytes needs only our PUT identity. Replaying an old
      // representation also requires restoring its captured audience first.
      await (binding as AccessBinding).rollback(async () => {
        if (previous) {
          const policy = required ?? (binding as AccessBinding).source;
          try {
            await replayProtected(
              url,
              policy,
              {
                method: "PUT",
                headers: { "content-type": previous.type, "if-match": etag },
                body: previous.body,
              },
              undefined,
              (binding as AccessBinding).destinationOwn,
            );
          } catch (cause) {
            if (cause instanceof DrivePartialFailureError) throw cause;
            // A foreign ACL is never a new compensation baseline. Keep both
            // versions privately before conditionally clearing only our upload.
            const retained = await quarantine(url, etag, policy, [
              previous,
              {
                body: init.body,
                type: init.headers["content-type"],
              },
            ]);
            throw new DrivePartialFailureError(url, [], [], retained, cause);
          }
        } else {
          try {
            await deleteVersion(url, etag, undefined, {
              rechecks: [() => access.checkOwn((binding as AccessBinding).destinationOwn)],
            });
          } catch (cause) {
            const retained = await quarantine(url, etag, (binding as AccessBinding).source, [
              {
                body: init.body,
                type: init.headers["content-type"],
              },
            ]);
            throw new DrivePartialFailureError(url, [], [], retained, cause);
          }
        }
      });
    });
    const ifMatch = headers.get("if-match");
    if (ifMatch) validator(url, ifMatch);
    const parents = await versions.prepare(url);
    response = await commitHttp({
      ...effects,
      arm: [...(binding ? [compensation] : []), ...(effects.arm ?? [])],
      rechecks: [
        async () => {
          await binding?.recheck();
          await recheckScope(scope);
          await verifyAccess?.();
          await verifyProtection();
        },
      ],
      identityChecks: effects.identityChecks ?? [],
      finalIdentities: parents.map((identity) => ({ ...identity, http, error: errorFor })),
      http,
      url,
      init: { ...init, headers },
      error: (status, url) => errorFor(status === 404 || status === 410 ? 412 : status, url),
      response: async (response) => {
        await ensureOk(response, url);
        effects.onWritten?.(response);
        return response;
      },
    });
    try {
      versions.committed(parents, response);
      await binding?.recheck();
      await recheckScope(scope);
      await verifyAccess?.();
      await verifyProtection();
      // Transfer callers must record this PUT's validator before their post-write
      // access check can fail and invoke cleanup of the new representation.
      compensation.disarm();
    } catch (error) {
      await compensation.rollback();
      throw error;
    }
    return response;
  };

  /** Replay under protection no wider than either captured or current grants. */
  const replayProtected = async (
    url: string,
    policy: OwnAccess | undefined,
    init: PayloadWrite,
    effects?: Pick<CommitChecks, "identityChecks">,
    expectedOwn?: { url: string; policy: OwnAccess | null },
  ) => {
    const etag = validator(url, new Headers(init.headers).get("if-match"));
    const protectedPolicy = policy
      ? await provision.protect(url, policy, url, {
          identity: { url, etag },
          restrict: true,
          knownAcl: expectedOwn?.url,
          expectedAcl: expectedOwn?.policy ?? null,
        })
      : undefined;
    let replayed: Response | undefined;
    try {
      return await guardedWrite(
        url,
        init,
        false,
        async () => {
          if (
            protectedPolicy &&
            accessGains(protectedPolicy, requireAccess(await access.effective(url), url)).length
          )
            throw new DriveAccessError("Rollback protection changed");
        },
        undefined,
        {
          ...effects,
          onWritten: (response) => {
            replayed = response;
          },
        },
      );
    } catch (error) {
      // A replay is already confidential. Secure our captured PUT even if Link
      // disappears; the previously verified own ACL remains the repair endpoint.
      if (replayed && protectedPolicy) {
        const receipt = validator(url, replayed.headers.get("etag"));
        try {
          await provision.protect(url, protectedPolicy, url, {
            identity: { url, etag: receipt },
            restrict: true,
            knownAcl: protectedPolicy.url,
            expectedAcl: protectedPolicy,
          });
        } catch (cause) {
          const retained = await quarantine(url, receipt, protectedPolicy, [
            {
              body: init.body,
              type: init.headers["content-type"],
            },
          ]);
          throw new DrivePartialFailureError(url, [], [], retained, cause);
        }
      }
      throw error;
    }
  };

  const write = async (
    url: string,
    body: Blob | string,
    opts: WriteOptions,
    policy: WritePolicy,
    verifyAccess?: () => Promise<void>,
    scope?: AccessScope,
    effects?: Omit<CommitEffects, "onCommit"> & {
      readonly onWritten?: (response: Response) => void;
    },
  ): Promise<{ etag?: string }> => {
    requirePolicy(policy, ["protect-ancestors", "owner-only"]);
    if (opts.ifMatch !== undefined) validator(url, opts.ifMatch);
    let required: OwnAccess | undefined;
    let protectedEtag: string | undefined;
    if (policy.kind === "owner-only") {
      const current = await http(url, { method: "HEAD", cache: "no-store" });
      if (current.headers.get("x-solid-demo-access-control") !== "none") {
        if (
          (opts.ifNoneMatch && current.ok) ||
          (opts.ifMatch && (!current.ok || current.headers.get("etag") !== opts.ifMatch))
        )
          throw new DriveError("conflict", 412, url);
        const webId = policy.webId ?? owner;
        if (!webId) throw new DriveAccessError("Owner WebID unavailable");
        required = { url: `${url}.acl`, etag: "", dataset: privateAcl(url, webId) };
        if (current.ok) {
          protectedEtag = validator(url, opts.ifMatch ?? current.headers.get("etag"));
          await provision.protect(url, required, url, {
            identity: { url, etag: protectedEtag },
          });
        } else {
          if (current.status !== 404) throw errorFor(current.status, url);
          const placeholder = await provision.file(
            url,
            required,
            url,
            () => rawPut(url, "", { "content-type": opts.contentType, "if-none-match": "*" }),
            () => {},
          );
          protectedEtag = validator(url, placeholder.response.headers.get("etag"));
        }
      }
    }
    const headers: PayloadWrite["headers"] = { "content-type": opts.contentType };
    if (opts.ifNoneMatch) headers["if-none-match"] = opts.ifNoneMatch;
    if (opts.ifMatch) headers["if-match"] = opts.ifMatch;
    if (protectedEtag) {
      delete headers["if-none-match"];
      headers["if-match"] = protectedEtag;
    }
    // Metadata updates may never mint a container. Even a concurrent deletion
    // must fail its precondition instead of recreating a folder outside its flight.
    if (url.endsWith("/") && !headers["if-match"])
      headers["if-match"] = validator(url, (await stat(url)).etag);
    const response = await guardedWrite(
      url,
      { method: "PUT", headers, body },
      false,
      verifyAccess,
      scope,
      effects,
      required,
    );
    // A replacement supersedes the previous listing's declarations before its refresh completes.
    resources.delete(url);
    responseTypes.delete(url);
    const etag = response.headers.get("etag");
    return etag ? { etag } : {};
  };

  const rawPut = async (
    target: string,
    body: string,
    headers: PayloadWrite["headers"],
  ): Promise<Response> => {
    return guardedWrite(
      target,
      {
        method: "PUT",
        body,
        headers,
      },
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
    deleteVersion: (url, etag) => deleteVersion(url, etag),
    ...(options.onPrivateFolder ? { onPrivateFolder: options.onPrivateFolder } : {}),
    ...(options.onProtectionChange ? { onProtectionChange: options.onProtectionChange } : {}),
  });
  const createFolder: DriveClient["createFolder"] = async (url, policy) => {
    const target = url.endsWith("/") ? url : `${url}/`;
    await provision.folder(target, policy);
  };

  // Read and validate the complete tree before the first destination write or DELETE.
  const snapshot = async (url: string, bodies: boolean): Promise<SourceSnapshot> => {
    if (bodies) await provision.check(url);
    const policy = (headers: Headers): Promise<AccessState> =>
      bodies
        ? access.snapshot(url, headers)
        : Promise.resolve({ status: "unknown", cause: "Not read" });
    if (url.endsWith("/")) {
      const { items, etag, dataset, headers } = await listing(url);
      validator(url, etag);
      const binding = bodies ? await bindAccess(access, url, url) : undefined;
      const children: SourceSnapshot[] = [];
      for (const child of items) children.push(await snapshot(child.url, bodies));
      const own = await policy(headers);
      // A cached listing cannot certify children inspected after a root replacement.
      await checkIdentity(http, url, validator(url, versions.current(url, etag)), errorFor);
      versions.track(url);
      return {
        url,
        etag,
        children,
        demo: headers.get("x-solid-demo-access-control") === "none",
        // Retain application RDF as well as the pinned identity. A matching
        // empty graph alone cannot authorize deleting a later container version.
        data: containerData(dataset, url),
        access: own,
        ...(binding ? { binding } : {}),
      };
    }
    const response = await ensureOk(await http(url, bodies ? undefined : { method: "HEAD" }), url);
    const binding = bodies ? await bindAccess(access, url, url) : undefined;
    const etag = response.headers.get("etag") ?? undefined;
    validator(url, etag);
    const own = await policy(response.headers);
    const body = bodies ? await response.blob() : undefined;
    await checkIdentity(http, url, validator(url, etag), errorFor);
    return {
      url,
      etag,
      children: undefined,
      demo: response.headers.get("x-solid-demo-access-control") === "none",
      access: own,
      ...(binding ? { binding } : {}),
      ...(bodies
        ? {
            body: body as Blob,
            contentType: response.headers.get("content-type") ?? "application/octet-stream",
          }
        : {}),
    };
  };

  function validator(url: string, etag: string | null | undefined): string {
    if (!etag || etag.startsWith("W/")) throw new DriveError("missing-validator", 409, url);
    return etag;
  }

  const deleteVersion = async (
    url: string,
    etag: string | undefined,
    recovery?: string,
    commit: CommitChecks &
      CommitEffects & { readonly survivors?: readonly ResourceIdentity[] } = {},
  ) => {
    const parents = await versions.prepare(url);
    await deletion.remove(url, validator(url, etag), recovery, {
      ...commit,
      survivors: [...(commit.survivors ?? []).map(versions.identity), ...parents],
      afterCommit: (response) => versions.committed(parents, response),
    });
    resources.delete(url);
    responseTypes.delete(url);
  };

  const deleteSnapshot = async (
    source: SourceSnapshot,
    deleted: string[],
    verifyCopy: (source: SourceSnapshot) => Promise<void>,
    recovery: ((url: string) => string) | undefined,
    retired: (url: string) => void,
    identityCheck: (source: SourceSnapshot) => Promise<void>,
    disarm: (url: string) => readonly Compensation[],
    survivors: readonly ResourceIdentity[] = [],
    ancestors: readonly ResourceIdentity[] = [],
  ) => {
    await verifyCopy(source);
    if (source.children?.length) {
      for (const child of source.children)
        await deleteSnapshot(
          child,
          deleted,
          verifyCopy,
          recovery,
          retired,
          identityCheck,
          disarm,
          survivors,
          [...ancestors, { url: source.url, etag: validator(source.url, source.etag) }],
        );
      // Only the receipts for our child DELETEs can explain a new validator.
      // A later listing cannot authorize recreation or introduce new members.
      const current = await listing(source.url);
      if (
        current.items.length ||
        !sameGraph(source.data as Store, containerData(current.dataset, source.url))
      )
        throw new DriveError("conflict", 409, source.url);
      if (current.etag !== versions.current(source.url, source.etag))
        throw new DriveError("conflict", 412, source.url);
      await verifyCopy(source);
    }
    await deleteVersion(
      source.url,
      versions.current(source.url, source.etag),
      recovery?.(source.url),
      {
        rechecks: [
          async () => {
            await verifyCopy(source);
          },
        ],
        identityChecks: [
          async () => {
            await identityCheck(source);
          },
        ],
        survivors: [...survivors, ...ancestors],
        disarm: disarm(source.url),
        onCommit: () => {
          deleted.push(source.url);
          retired(source.url);
        },
      },
    );
  };

  const copySnapshot = async (
    source: SourceSnapshot,
    to: string,
    created: CreatedResource[],
    bindAccess: (url: string, policy?: OwnAccess) => Promise<void>,
    verifyAccess: () => Promise<void>,
    compensation: Compensation,
  ) => {
    await verifyAccess();
    const policy =
      source.targetAccess ?? (source.access.status === "known" ? source.access.policy : undefined);
    if (source.children) {
      const resource: CreatedResource = {
        url: to,
        source,
        etag: undefined,
        data: new Store(),
      };
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
      if (!policy && !source.demo) await bindAccess(to);
      const result = await provision.folder(
        to,
        decision,
        (response) => {
          captureResource(resource, response.headers.get("etag"), response.headers);
          created.push(resource);
        },
        undefined,
        verifyAccess,
        { arm: [compensation] },
      );
      if (result.policy) await bindAccess(to, result.policy);
      await verifyAccess();
      const data = relocate(source.data as Store, [[source.url, to]]);
      if (data.size) {
        await write(
          to,
          await serialize([...data]),
          {
            contentType: "text/turtle",
            ifMatch: validator(to, resource.etag),
          },
          { kind: "protect-ancestors" },
          verifyAccess,
          undefined,
          {
            arm: [compensation],
            onWritten: (response) => {
              captureResource(resource, response.headers.get("etag"), response.headers);
              resource.data = data;
            },
          },
        );
        await verifyAccess();
        const current = await listing(to);
        if (!sameGraph(data, containerData(current.dataset, to)))
          throw new DriveError("conflict", 409, to);
      }
      for (const child of source.children)
        await copySnapshot(
          child,
          `${to}${child.url.slice(source.url.length)}`,
          created,
          bindAccess,
          verifyAccess,
          compensation,
        );
    } else {
      let placeholder: CreatedResource | undefined;
      if (!source.demo) {
        if (!policy) await bindAccess(to);
        const resource: CreatedResource = {
          url: to,
          source,
          etag: undefined,
        };
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
            captureResource(resource, response.headers.get("etag"), response.headers);
            created.push(resource);
          },
          verifyAccess,
          { arm: [compensation] },
        );
        placeholder = resource;
        if (result.policy) await bindAccess(to, result.policy);
      }
      await write(
        to,
        source.body as Blob,
        {
          contentType: source.contentType as string,
          ...(placeholder
            ? { ifMatch: validator(to, placeholder.etag) }
            : { ifNoneMatch: "*" as const }),
        },
        { kind: "protect-ancestors" },
        verifyAccess,
        undefined,
        {
          arm: [compensation],
          onWritten: (response) => {
            const etag = response.headers.get("etag") ?? undefined;
            if (placeholder) captureResource(placeholder, etag, response.headers);
            else created.push({ url: to, source, etag });
          },
        },
      );
      await verifyAccess();
    }
  };

  const verifySnapshotIdentity = async (source: SourceSnapshot) => {
    const etag = versions.current(source.url, source.etag);
    if (source.children) {
      // Membership may change as children are restored. The recovered application
      // RDF must still exist before its destination can be discarded or overwritten.
      const current = await listing(source.url);
      if (!containsGraph(source.data as Store, containerData(current.dataset, source.url)))
        throw new DriveError("conflict", 412, source.url);
      if (current.etag !== etag) throw new DriveError("conflict", 412, source.url);
    }
    await checkIdentity(http, source.url, validator(source.url, etag), errorFor);
  };

  const secureRetained = async (resource: CreatedResource): Promise<string[]> => {
    const policy =
      resource.protection ?? resource.source.targetAccess ?? resource.source.inheritedAccess;
    if (!policy || !resource.etag) return [resource.url];
    try {
      await provision.protect(
        resource.url,
        policy,
        resource.protection ? resource.url : resource.source.url,
        {
          identity: {
            url: resource.url,
            etag: validator(resource.url, versions.current(resource.url, resource.etag)),
          },
          restrict: true,
          ...(resource.protection
            ? { knownAcl: resource.protection.url, expectedAcl: resource.protection }
            : resource.ownAcl
              ? { knownAcl: resource.ownAcl.url, expectedAcl: resource.ownAcl.policy }
              : {}),
        },
      );
      return [resource.url];
    } catch {
      return quarantine(resource.url, validator(resource.url, resource.etag), policy, [
        {
          body: resource.source.body ?? (await serialize([...(resource.data as Store)])),
          type: resource.source.contentType ?? "text/turtle",
        },
      ]);
    }
  };

  const rollback = async (created: CreatedResource[], binding: AccessBinding) => {
    const retained: string[] = [];
    let pending: Error | undefined;
    for (const resource of [...created].reverse()) {
      try {
        if (resource.url.endsWith("/")) {
          const expected = resource.data as Store;
          validator(resource.url, resource.etag);
          // Our completed child cleanup changed membership. Capture the empty
          // representation once; a subsequent 412 must never refresh its identity.
          const current = await listing(resource.url);
          checkContainerVersion(resource, current.etag);
          await discardVersion({
            url: resource.url,
            captured: { content: current.dataset, etag: current.etag },
            read: async () => {
              const current = await listing(resource.url);
              return { content: current.dataset, etag: current.etag };
            },
            owns: (data) => ownsEmptyContainer(resource.url, expected, data),
            remove: (etag) =>
              binding.rollback(() =>
                deleteVersion(resource.url, etag, undefined, {
                  rechecks: [
                    () =>
                      access.checkOwn(
                        resource.protection
                          ? { url: resource.protection.url, policy: resource.protection }
                          : resource.ownAcl,
                      ),
                  ],
                  identityChecks: [() => verifySnapshotIdentity(resource.source)],
                }),
              ),
          });
        } else {
          await discardVersion({
            url: resource.url,
            captured: { content: resource.etag, etag: resource.etag },
            read: async () => {
              const current = await stat(resource.url);
              return { content: current.etag, etag: current.etag };
            },
            owns: (etag) => etag === resource.etag,
            remove: (etag) =>
              binding.rollback(() =>
                deleteVersion(resource.url, etag, undefined, {
                  rechecks: [
                    () =>
                      access.checkOwn(
                        resource.protection
                          ? { url: resource.protection.url, policy: resource.protection }
                          : resource.ownAcl,
                      ),
                  ],
                  identityChecks: [() => verifySnapshotIdentity(resource.source)],
                }),
              ),
          });
        }
      } catch (error) {
        if (isMissingItem(error) && (error as DriveError).url === resource.url) continue;
        // Refused source validation must not strand the retained recovery under
        // widened access. Only its captured destination identity authorizes repair.
        try {
          retained.push(...(await secureRetained(resource)));
        } catch (cause) {
          retained.push(resource.url);
          if (cause instanceof DrivePartialFailureError)
            retained.push(...cause.retainedDestinations);
          pending = cause instanceof Error ? cause : new DriveAccessError(cause);
        }
        if (isDeletionFailure(error) && !pending) pending = error;
      }
    }
    return { retained, pending };
  };

  /** Archived grants describe the original; the recovery copy is deliberately private. */
  const recoveryPolicy = async (url: string, own: AccessState): Promise<OwnAccess | undefined> => {
    const archiveUrl = policyArchiveOf(url);
    if (!archiveUrl) return undefined;
    const response = await http(archiveUrl);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new DriveAccessError(response.status);
    const saved = ((await response.json()) as Record<string, ArchivedAcl | null>)[url];
    if (saved === undefined) throw new DriveAccessError("Missing archived policy");
    if (saved === null)
      return requireAccess(own.status === "known" ? own : await access.effective(url), url);
    const acl = own.status === "known" ? own.policy.url : saved.acl;
    return {
      url: acl,
      etag: "",
      dataset: relocate(await parseRdf(saved.turtle, "text/turtle", { baseIRI: saved.acl }), [
        [saved.acl, acl],
        [saved.resource, url],
      ]),
    };
  };

  const preparePolicies = async (
    source: SourceSnapshot,
    from: string,
    to: string,
    privateOwner?: string,
    archiveContainers?: (archive: string) => Promise<void>,
    verifyAccess?: () => Promise<void>,
    scope?: AccessScope,
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
        await verifyAccess?.();
        await archiveContainers?.(JSON.stringify(containers));
        await verifyAccess?.();
        await write(
          policyArchiveOf(to) as string,
          JSON.stringify(archive),
          {
            contentType: "application/json",
            ifNoneMatch: "*",
          },
          { kind: "owner-only", webId: privateOwner },
          undefined,
          scope,
        );
        await verifyAccess?.();
      } else {
        for (const node of snapshots(source)) {
          const saved = await recoveryPolicy(node.url, node.access);
          if (saved) node.targetAccess = saved;
        }
      }
    }
  };

  const mergeContainer = async (
    from: string,
    to: string,
    decision: PreservePolicy,
    scope: AccessScope,
    opts: Parameters<DriveClient["mergeContainer"]>[3],
  ) => {
    requirePolicy(decision, ["preserve-source"]);
    for (const identity of opts?.sourceGuards ?? []) versions.track(identity.url);
    await provision.check(from);
    const original = await listing(from);
    versions.track(from);
    if (opts?.ifMatch !== undefined && original.etag !== opts.ifMatch)
      throw new DriveError("conflict", 412, from);
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
    if (effective.status === "known") source.inheritedAccess = effective.policy;
    const binding = await bindAccess(access, from, to);
    const verifyMerge = async () => {
      await binding.recheck();
      for (const identity of [
        ...(opts?.sourceGuards ?? []),
        { url: from, etag: validator(from, original.etag) },
      ])
        await checkIdentity(http, identity.url, versions.identity(identity).etag, errorFor);
    };
    await preparePolicies(source, from, to);
    const policy = source.demo
      ? undefined
      : (source.targetAccess ?? requireAccess(effective, from));
    let created = false;
    const resource: CreatedResource = {
      url: to,
      source,
      etag: undefined,
      data: new Store(),
    };
    let previous: Store | undefined;
    const compensation = new Compensation(async () => {
      // An ambiguous recovery DELETE may have committed despite response loss.
      // Never remove recovered RDF unless its recovery endpoint still exists.
      await deletion.guard(from);
      const recovery = await http(from, { method: "HEAD", cache: "no-store" });
      if (recovery.status === 404 || recovery.status === 410) return;
      await ensureOk(recovery, from);
      if (created) {
        const cleanup = await rollback([resource], binding);
        if (cleanup.pending) throw cleanup.pending;
      } else if (previous && resource.etag) {
        // Our restored children changed membership. Hydrate the resulting
        // representation before committing the undo; a refusal never rebases it.
        const body = await serialize([...previous]);
        const restoredPolicy = previous.size ? binding.destination : undefined;
        const expected = resource.data as Store;
        validator(to, resource.etag);
        const current = await listing(to);
        checkContainerVersion(resource, current.etag);
        await discardVersion({
          url: to,
          captured: { content: containerData(current.dataset, to), etag: current.etag },
          read: async () => {
            const current = await listing(to);
            return { content: containerData(current.dataset, to), etag: current.etag };
          },
          owns: (data) => sameGraph(expected, data),
          remove: async (etag) => {
            await binding.rollback(() =>
              replayProtected(
                to,
                restoredPolicy,
                {
                  method: "PUT",
                  headers: { "content-type": "text/turtle", "if-match": etag },
                  body,
                },
                { identityChecks: [() => verifySnapshotIdentity(source)] },
                binding.destinationOwn,
              ),
            );
          },
        });
        resource.etag = undefined;
      }
    });
    try {
      // Resolve the archive before creation, then hold one flight from the
      // durable requirement through empty PUT and ACL installation/verification.
      const result = await provision.folder(
        to,
        policy ? { kind: "archived", acl: policy, from } : { kind: "inherit-verified" },
        (response) => {
          captureResource(resource, response.headers.get("etag"), response.headers);
        },
        undefined,
        verifyMerge,
        { arm: [compensation] },
      );
      if (result.policy) {
        binding.installed(result.policy);
        resource.protection = result.policy;
      }
      created = true;
      await binding.recheck();
    } catch (error) {
      if (!(error instanceof DriveError && error.kind === "conflict")) {
        await compensation.rollback();
        throw error;
      }
    }
    if (
      !created &&
      policy &&
      accessGains(access.forResource(policy, from), requireAccess(await access.effective(to), to))
        .length
    )
      throw new DriveAccessError("Existing destination grants wider access");
    const check = { binding, compensation, until: from };
    const recheck = () => recheckScope(new Set([check]));
    try {
      await binding.recheck();
      const current = await listing(to);
      versions.track(to);
      previous = containerData(current.dataset, to);
      if (created && !ownsEmptyContainer(to, new Store(), current.dataset))
        throw new DriveError("conflict", 409, to);
      const data = new Store([
        ...containerData(current.dataset, to),
        ...relocate(source.data as Store, [[from, to]]),
      ]);
      if (sameGraph(containerData(current.dataset, to), data)) {
        scope.add(check);
        await recheck();
        return {
          recheck,
          disarm: [compensation],
          source: versions.identity({ url: from, etag: validator(from, original.etag) }),
        };
      }
      await write(
        to,
        await serialize([...data]),
        {
          contentType: "text/turtle",
          ifMatch: validator(to, current.etag),
        },
        { kind: "protect-ancestors" },
        verifyMerge,
        undefined,
        {
          arm: [compensation],
          onWritten: (response) => {
            captureResource(resource, response.headers.get("etag"), response.headers);
            resource.data = data;
          },
        },
      );
      await binding.recheck();
      if (!sameGraph(data, containerData((await listing(to)).dataset, to)))
        throw new DriveError("conflict", 409, to);
      await binding.recheck();
      scope.add(check);
      return {
        recheck,
        disarm: [compensation],
        source: versions.identity({ url: from, etag: validator(from, original.etag) }),
      };
    } catch (error) {
      await compensation.rollback();
      throw error;
    }
  };

  const transfer = async (
    from: string,
    to: string,
    moving: boolean,
    decision: MovePolicy,
    beforeDelete: (() => Promise<void>) | undefined,
    privateOwner: string | undefined,
    archiveContainers: ((archive: string) => Promise<void>) | undefined,
    held: ReadonlySet<string>,
    scope: AccessScope,
    acceptedAccess?: OwnAccess,
    approvedEtag?: string,
    sourceGuards: readonly ResourceIdentity[] = [],
  ): Promise<MoveResult> => {
    if (from.endsWith("/") !== to.endsWith("/") || (from.endsWith("/") && to.startsWith(from))) {
      throw new DriveError("conflict", 409, to);
    }
    const ordinaryMove =
      moving && decision.kind === "confirm-move" && !privateOwner && !policyArchiveOf(from);
    for (const identity of sourceGuards) versions.track(identity.url);
    await deletion.guard(from);
    const source = await snapshot(from, true);
    if (approvedEtag !== undefined && source.etag !== validator(from, approvedEtag))
      throw new DriveError("conflict", 412, from);
    // Reserve the captured tree before copying or removing any node. Child
    // cleanup shares the flight, including rollback after a failed copy.
    return sourceOperation(
      sourceUrls(source).flatMap((url) => [url, `${to}${url.slice(from.length)}`]),
      async (transferHeld) => {
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
        for (const node of nodes) requireAccess(effective.get(node) as AccessState, node.url);
        await provision.guard(to, true);
        const destinationBinding = await bindAccess(access, from, to);
        let keepAccess = !ordinaryMove;
        if (ordinaryMove && !source.demo) {
          const inherited: SourceSnapshot[] = [];
          const affected = (node: SourceSnapshot, protectedDefaults: boolean) => {
            if (node.access.status === "none" && !protectedDefaults) inherited.push(node);
            const protectedChildren =
              protectedDefaults ||
              (node.access.status === "known" && access.hasDefaults(node.access.policy, node.url));
            for (const child of node.children ?? []) affected(child, protectedChildren);
          };
          affected(source, false);
          if (inherited.length > 0) {
            const current = requireAccess(effective.get(source) as AccessState, from);
            const destination = requireAccess(await access.effective(to, true), to);
            const widened = new Set<string>();
            for (const node of inherited)
              for (const agent of accessGains(
                requireAccess(effective.get(node) as AccessState, node.url),
                destination,
              ))
                widened.add(agent);
            const gains = [...widened];
            if (
              gains.length &&
              !(
                acceptedAccess &&
                acceptedAccess.url === destination.url &&
                !accessGains(acceptedAccess, destination).length
              )
            ) {
              if (!options.confirmAccess)
                throw new DriveAccessError("Access change requires confirmation");
              const choice = await options.confirmAccess({ from, to, gains, canKeep: true });
              if (choice === "cancel") throw new Error("Move cancelled");
              if (choice === "keep") {
                source.targetAccess = current;
                keepAccess = true;
              }
            }
            destinationBinding.installed(destination, true);
          }
        }
        const created: CreatedResource[] = [];
        let cleanup: Awaited<ReturnType<typeof rollback>> | undefined;
        const compensation = new Compensation(async () => {
          cleanup = await rollback(created, destinationBinding);
        });
        const bindings = new Map<string, AccessBinding>();
        for (const node of nodes) bindings.set(`source:${node.url}`, node.binding as AccessBinding);
        bindings.set(to, destinationBinding);
        const group = new Set<AccessCheck>();
        const register = (binding: AccessBinding) => {
          const check = { binding };
          group.add(check);
          scope.add(check);
        };
        for (const binding of bindings.values()) register(binding);
        let accessFailure = false;
        let widenedAccess: readonly string[] | undefined;
        const verifyAccess = async () => {
          accessFailure = true;
          await recheckScope(scope);
          accessFailure = false;
          for (const identity of sourceGuards)
            await checkIdentity(http, identity.url, versions.identity(identity).etag, errorFor);
        };
        const bindDestination = async (url: string, policy?: OwnAccess) => {
          let binding = bindings.get(url);
          if (!binding) {
            await verifyAccess();
            binding = await bindAccess(access, `${from}${url.slice(to.length)}`, url);
            bindings.set(url, binding);
            register(binding);
          }
          if (policy) {
            binding.installed(policy);
            // Policies are registered only after onCreated captures the placeholder.
            const resource = created.find((resource) => resource.url === url) as CreatedResource;
            resource.protection = policy;
          }
          await verifyAccess();
        };
        const deleted: string[] = [];
        let deleting = false;
        let verifyingCopy = false;
        const destinations = new Map<string, MoveResource>();
        const verifyDestination = async (source: Pick<SourceSnapshot, "url">) => {
          const destination = destinations.get(source.url) as MoveResource;
          verifyingCopy = true;
          const etag = validator(destination.url, destination.etag);
          const response = await ensureOk(
            await http(destination.url, { method: "HEAD", headers: { "if-match": etag } }),
            destination.url,
          );
          // Also check servers that ignore HEAD preconditions.
          if (response.headers.get("etag") !== etag)
            throw new DriveError("conflict", 412, destination.url);
          verifyingCopy = false;
        };
        try {
          await preparePolicies(
            source,
            from,
            to,
            privateOwner,
            archiveContainers,
            verifyAccess,
            scope,
          );
          if (keepAccess) {
            for (const node of nodes)
              if (!node.demo && node.access.status === "none" && node.targetAccess === undefined)
                node.targetAccess = requireAccess(effective.get(node) as AccessState, node.url);
          }
          await bindDestination(to);
          await copySnapshot(source, to, created, bindDestination, verifyAccess, compensation);
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
                if (current.etag !== versions.current(url, copiedEtag))
                  throw new DriveError("conflict", 412, url);
                destinations.set(node.url, {
                  url,
                  // The populated destination supplies the later Undo receipt.
                  // Cleanup uses only transitions from our committed mutations.
                  etag: node.children.length ? validator(url, current.etag) : copiedEtag,
                  children: [...expected],
                });
              } else destinations.set(node.url, { url, etag: copiedEtag });
              for (const child of node.children ?? []) await capture(child);
            };
            await capture(source);
            for (const url of sourceUrls(source)) {
              // Each destination is checked again immediately before its source's
              // DELETE, since another child deletion may give a concurrent tab time.
              await verifyAccess();
              await verifyDestination({ url });
            }
            deleting = true;
            await deleteSnapshot(
              source,
              deleted,
              async () => {
                await beforeDelete?.();
                await verifyAccess();
              },
              (url) => `${to}${url.slice(from.length)}`,
              (url) => {
                for (const binding of bindings.values()) binding.retire(url);
              },
              verifyDestination,
              (url) => [compensation, ...compensationsFor(scope, url)],
              sourceGuards,
            );
          }
        } catch (error) {
          for (const check of group) scope.delete(check);
          if (error instanceof DriveAccessError) accessFailure = true;
          if (error instanceof DriveAccessChangedError && error.gains.length)
            widenedAccess = error.gains;
          // Retain recovery after source deletion. Before that, access failures
          // remove our copies even when detected during the final verification.
          const keep = deleted.length || (!accessFailure && (verifyingCopy || deleting));
          if (!keep) await compensation.rollback();
          const retained = cleanup ? cleanup.retained : created.map(({ url }) => url);
          let protectionFailure: unknown;
          if (keep) {
            retained.length = 0;
            for (const resource of created) {
              try {
                retained.push(...(await secureRetained(resource)));
              } catch (cause) {
                retained.push(resource.url);
                if (cause instanceof DrivePartialFailureError)
                  retained.push(...cause.retainedDestinations);
                protectionFailure = cause;
              }
            }
          }
          if (!deleted.length && !retained.length) {
            if (ordinaryMove && widenedAccess && options.confirmAccess) {
              // Roll back before asking: Cancel must leave no public recovery copy.
              const destination = requireAccess(await access.effective(to, true), to);
              const choice = await options.confirmAccess({
                from,
                to,
                gains: widenedAccess,
                canKeep: true,
              });
              if (choice === "cancel") throw new Error("Move cancelled");
              return transfer(
                from,
                to,
                moving,
                choice === "keep" ? { kind: "preserve-source" } : decision,
                beforeDelete,
                privateOwner,
                archiveContainers,
                transferHeld,
                scope,
                destination,
                approvedEtag ?? source.etag,
                sourceGuards,
              );
            }
            throw error;
          }
          const unverified = sourceUrls(source).filter((url) => !deleted.includes(url));
          throw new DrivePartialFailureError(
            from,
            deleted,
            unverified,
            retained,
            protectionFailure ?? cleanup?.pending ?? error,
          );
        }
        compensation.disarm();
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
      },
      held,
    );
  };

  const copy = async (
    from: string,
    to: string,
    policy: PreservePolicy,
    held: ReadonlySet<string>,
    scope: AccessScope,
    opts: Parameters<DriveClient["copy"]>[3],
  ) => {
    requirePolicy(policy, ["preserve-source"]);
    await transfer(
      from,
      to,
      false,
      policy,
      undefined,
      undefined,
      undefined,
      held,
      scope,
      undefined,
      opts?.ifMatch,
      opts?.sourceGuards,
    );
  };

  const move = async (
    from: string,
    to: string,
    policy: MovePolicy,
    opts: Parameters<DriveClient["move"]>[3],
    held: ReadonlySet<string>,
    scope: AccessScope,
  ) => {
    requirePolicy(policy, ["preserve-source", "confirm-move"]);
    return transfer(
      from,
      to,
      true,
      policy,
      opts?.beforeDelete,
      opts?.privateOwner,
      opts?.archiveContainers,
      held,
      scope,
      undefined,
      opts?.ifMatch,
      opts?.sourceGuards,
    );
  };

  const remove = async (
    url: string,
    opts: Parameters<DriveClient["remove"]>[1] = {},
    held: ReadonlySet<string> = new Set(),
    scope: AccessScope = new Set(),
  ) => {
    await deletion.guard(url);
    try {
      const capturedEtag = opts.ifMatch ?? (await stat(url)).etag;
      const verify = async () => {
        await recheckScope(scope);
        for (const recheck of opts.commit?.rechecks ?? []) await recheck();
      };
      const identityCheck = async () => {
        for (const check of opts.commit?.identityChecks ?? []) await check();
      };
      if (url.endsWith("/") && opts.recursive) {
        const source = await snapshot(url, false);
        if (source.etag !== validator(url, capturedEtag))
          throw new DriveError("conflict", 412, url);
        const deleted: string[] = [];
        try {
          await sourceOperation(
            sourceUrls(source),
            () =>
              deleteSnapshot(
                source,
                deleted,
                verify,
                undefined,
                (url) => retireScope(scope, url),
                identityCheck,
                (nodeUrl) => [
                  ...compensationsFor(scope, nodeUrl),
                  ...(nodeUrl === url ? (opts.commit?.disarm ?? []) : []),
                ],
                opts.commit?.survivors ?? [],
              ),
            held,
          );
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
        await deleteVersion(url, capturedEtag, undefined, {
          rechecks: [verify],
          identityChecks: [
            identityCheck,
            // Validate a compared recovery representation before its surviving
            // endpoints. The helper still repeats the target HEAD last.
            ...(opts.commit?.survivors?.length
              ? [() => checkIdentity(http, url, validator(url, capturedEtag), errorFor)]
              : []),
          ],
          survivors: opts.commit?.survivors ?? [],
          disarm: [...compensationsFor(scope, url), ...(opts.commit?.disarm ?? [])],
          onCommit: () => retireScope(scope, url),
        });
      }
    } catch (error) {
      const cause = error instanceof DrivePartialFailureError ? error.cause : error;
      if (!isMissingItem(cause) || (cause as DriveError).url !== url) throw error;
      for (const check of scope) check.binding.retire(url);
      await deletion.forget(url);
    }
  };

  const scopes = new WeakMap<DriveClient, ReadonlySet<string>>();
  const accessScopes = new WeakMap<DriveClient, AccessScope>();
  const scopeFor = (client: DriveClient): AccessScope => accessScopes.get(client) ?? new Set();
  const client: DriveClient = {
    storageUrl,
    ...(options.confirmAccess ? { confirmAccess: options.confirmAccess } : {}),
    async bindAccess(from, to) {
      const binding = await bindAccess(access, from, to);
      const archived = await recoveryPolicy(from, { status: "known", policy: binding.source });
      if (
        accessGains(
          archived ? access.forResource(archived, from) : binding.source,
          binding.destination,
        ).length
      )
        throw new DriveAccessError("Recovery destination grants wider access");
      scopeFor(this).add({ binding });
      return binding;
    },
    list,
    stat,
    read,
    readVersion,
    readRdf,
    exclusive(urls, work) {
      return sourceOperation(
        urls,
        (held) => {
          const scoped = { ...this };
          scopes.set(scoped, held);
          accessScopes.set(scoped, accessScopes.get(this) ?? new Set());
          return work(scoped);
        },
        scopes.get(this),
      );
    },
    write(url, ...args) {
      return sourceOperation(
        [url],
        async () => {
          await recheckScope(scopeFor(this));
          const saved = await write(url, ...args, undefined, scopeFor(this));
          await recheckScope(scopeFor(this));
          return saved;
        },
        scopes.get(this),
      );
    },
    createFolder,
    mergeContainer(from, to, policy, opts) {
      return sourceOperation(
        [from, to],
        () => mergeContainer(from, to, policy, scopeFor(this), opts),
        scopes.get(this),
      );
    },
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
        try {
          await provision.protect(url, policy, url, {
            identity: { url, etag: validator(url, response.headers.get("etag")) },
          });
        } catch (cause) {
          throw new DriveAccessError(cause);
        }
      }
    },
    copy(from, to, policy, opts) {
      return sourceOperation(
        [from, to],
        (held) => copy(from, to, policy, held, scopeFor(this), opts),
        scopes.get(this),
      );
    },
    move(from, to, ...args) {
      return sourceOperation(
        [from, to],
        (held) => move(from, to, args[0], args[1], held, scopeFor(this)),
        scopes.get(this),
      );
    },
    remove(url, opts) {
      return sourceOperation(
        [url],
        async (held) => {
          const scope = scopeFor(this);
          await recheckScope(scope);
          await remove(url, opts, held, scope);
          for (const check of scope) check.binding.retire(url);
        },
        scopes.get(this),
      );
    },
    recheckDeletions: () => deletion.recheck(storageUrl),
  };
  return client;
}
