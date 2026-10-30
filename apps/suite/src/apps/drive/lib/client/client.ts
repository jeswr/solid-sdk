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
import { DriveResource } from "../model/model";
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
  ownAccessGuards,
  policyOwner,
  privateAcl,
  requireAccess,
  resourceDiscoveryOptions,
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
  assertVersion,
  type CommitChecks,
  type CommitEffects,
  Compensation,
  checkIdentity,
  commitHttp,
  type PolicyIdentity,
  type ResourceAssertion,
  type ResourceIdentity,
  requireResourceAssertion,
} from "./commit";
import { containerVersions } from "./container-versions";
import { DriveDeletePendingError, deletionControl, isDeletionFailure } from "./deletion";
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
  readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
  /** A durable own-ACL requirement is still awaiting verification. */
  readonly protectionRequired?: true;
}

export interface WriteOptions {
  readonly contentType: string;
  /** `"*"`: fail with {@link DriveConflictError} when the target exists. */
  readonly ifNoneMatch?: "*";
  /** Overwrite only this version. */
  readonly ifMatch?: string;
  readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
}

export interface MoveResult {
  readonly url: string;
  /** Identity of the copied version, captured inside the move. */
  readonly etag?: string;
  readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
  readonly children?: readonly string[];
  /** Every copied identity and the final container memberships verified by the move. */
  readonly tree?: readonly MoveResource[];
}

export interface MoveResource {
  readonly url: string;
  readonly etag: string;
  readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
  readonly children?: readonly string[];
}

export interface DriveClient {
  readonly storageUrl: string;
  /** Run one logical operation with a scoped client that already owns these URLs. */
  exclusive?<T>(urls: readonly string[], work: (client: DriveClient) => Promise<T>): Promise<T>;
  readonly confirmAccess?: ConfirmAccess;
  /** Bind recovery and survivor access across a multi-step restore. */
  bindAccess?(from: string, to: string): Promise<Pick<AccessBinding, "recheck">>;
  /** Pin the policy archive captured at Restore preflight, including its absence. */
  bindRecoveryPolicy?(
    url: string,
    captured:
      | {
          readonly content: string;
          readonly etag: string | undefined;
          readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
        }
      | undefined,
  ): void;
  /** Children of a folder (hidden dot-names included; the UI filters them). */
  list(folderUrl: string, options?: { signal?: AbortSignal }): Promise<DriveItem[]>;
  /** Metadata for one item (HEAD), optionally conditional on the expected version. */
  stat(
    url: string,
    options?: { ifMatch: string; readonly verifyHeaders?: ResourceAssertion["verifyHeaders"] },
  ): Promise<DriveItem>;
  read(url: string): Promise<Blob>;
  /** Bytes and validator from the same GET, for subsequent conditional deletion. */
  readVersion(url: string): Promise<{
    body: Blob;
    etag?: string;
    readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
  }>;
  /** Parsed RDF and its validator; `undefined` when the resource does not exist. */
  readRdf(
    url: string,
  ): Promise<
    | { dataset: Store; etag?: string; readonly verifyHeaders?: ResourceAssertion["verifyHeaders"] }
    | undefined
  >;
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
    options?: {
      readonly ifMatch?: string;
      readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
      readonly sourceGuards?: readonly ResourceIdentity[];
    },
  ): Promise<
    Pick<AccessBinding, "recheck"> & {
      readonly disarm: readonly Compensation[];
      readonly source?: ResourceIdentity;
      readonly destination: ResourceIdentity;
    }
  >;
  /** Copy a file (folders: recursive). Fails with a conflict when `to` exists. */
  copy(
    from: string,
    to: string,
    policy: PreservePolicy,
    options?: {
      readonly ifMatch?: string;
      readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
      readonly sourceGuards?: readonly ResourceIdentity[];
    },
  ): Promise<void>;
  /** Move = copy + verified, conditional delete; returns the copied identity. */
  move(
    from: string,
    to: string,
    policy: MovePolicy,
    options?: {
      /** Source version approved by the caller; never refreshed during retries. */
      ifMatch?: string;
      readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
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
      readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
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
  readonly verifyHeaders: NonNullable<CommitChecks["verifyHeaders"]>;
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
  ownAcl?: AccessState["own"];
}

/** Payload and MIME data are hydrated before the final HTTP commit boundary. */
interface PayloadWrite extends RequestInit {
  readonly body: Blob | string;
  readonly headers: Record<string, string> & { "content-type": string };
}

interface AccessCheck {
  binding: Pick<AccessBinding, "recheck" | "retire" | "identities"> &
    Partial<Pick<AccessBinding, "verifyEndpoint">>;
  compensation?: Compensation;
  until?: string;
}
type PolicyArchiveSnapshot = {
  readonly content: string;
  readonly etag: string | undefined;
  readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
};
type AccessScope = Set<AccessCheck> & { archives?: Map<string, PolicyArchiveSnapshot | null> };
function scopePolicyGuards(scope: AccessScope): readonly PolicyIdentity[] {
  return [...scope].flatMap((check) => check.binding.identities);
}

function compensationsFor(scope: AccessScope, url: string): Compensation[] {
  return [...scope].flatMap((check) =>
    check.until === url && check.compensation ? [check.compensation] : [],
  );
}

function retireScope(scope: AccessScope, url: string): void {
  for (const check of scope) check.binding.retire(url);
}

function verifyScopeHeaders(scope: AccessScope, url: string, headers: Headers): undefined {
  for (const check of scope) check.binding.verifyEndpoint?.(url, headers);
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

/** Preserve complete own ACLs, and take inherited grants from the same binding
 * that checks them. A fresh effective-policy read must never replace a capture.
 */
function capturedAccess(source: SourceSnapshot): AccessState {
  return source.access.status === "none" && !source.access.demo
    ? { status: "known", policy: (source.binding as AccessBinding).source }
    : source.access;
}

function errorFor(status: number, url: string): DriveError {
  const kind: DriveErrorKind =
    status === 428
      ? "missing-validator"
      : status === 409 || status === 412
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
  const modified = new DriveResource(resource.id, resource.dataset, DataFactory).modifiedAt;
  return {
    url: resource.id,
    name: nameOf(resource.id),
    kind: resource.isContainer ? "folder" : "file",
    ...(contentType ? { contentType } : {}),
    ...(size !== undefined && !resource.isContainer ? { size } : {}),
    ...(modified && Number.isFinite(modified.getTime()) ? { modified } : {}),
  };
}

/** A target's headers cannot say whether it is another resource's absent ACL.
 * Discover the storage namespace before ordinary mutations, rather than relying
 * on which access panes this client happened to open. Custom endpoints may live
 * outside their protected resource's folder. Incomplete discovery fails closed.
 * This is preflight hydration; commitHttp still owns every final identity check.
 */
export async function discoverContentTargets(
  http: typeof fetch,
  storageUrl: string,
  access: ReturnType<typeof accessControl>,
  targets: readonly string[],
): Promise<void> {
  for (const target of targets) access.assertContentDestination(target);
  const visit = async (
    folder: string,
    verifyHeaders: ResourceAssertion["verifyHeaders"],
  ): Promise<void> => {
    const current = await fetchRdf(folder, {
      fetch: (input, init) => http(input, { ...init, cache: "no-store" }),
    });
    verifyHeaders(current.response.headers);
    access.discover(folder, current.response.headers, true);
    // A partial containment page cannot prove that a candidate is ordinary
    // content. Do not silently omit resources beyond the first page.
    for (const link of (current.response.headers.get("link") ?? "").matchAll(
      /<([^>]*)>\s*((?:;\s*[^,]*)*)/g,
    )) {
      const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(link[2] as string);
      if ((rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("next"))
        throw new DriveAccessError("Incomplete containment discovery");
    }
    const folders: { url: string; verifyHeaders: ResourceAssertion["verifyHeaders"] }[] = [];
    const members = [...new Container(folder, current.dataset, DataFactory).contains];
    for (const child of members) validateMember(folder, child.id);
    for (const item of members) {
      const response = await http(item.id, { method: "HEAD", cache: "no-store" });
      if (!response.ok) throw errorFor(response.status, item.id);
      access.discover(item.id, response.headers, true);
      if (item.id.endsWith("/"))
        folders.push({
          url: item.id,
          verifyHeaders: access.captureEndpoint(item.id, response.headers),
        });
    }
    for (const folder of folders) await visit(folder.url, folder.verifyHeaders);
  };
  try {
    const root = await http(storageUrl, { method: "HEAD", cache: "no-store" });
    if (!root.ok) throw errorFor(root.status, storageUrl);
    if (root.headers.get("x-solid-demo-access-control") !== "none")
      await visit(storageUrl, access.captureEndpoint(storageUrl, root.headers));
  } catch (cause) {
    throw new DriveAccessError(
      cause,
      "Drive could not discover the storage's access-control resources. Retry once its contents can be read.",
    );
  }
  for (const target of targets) access.assertContentDestination(target);
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
  const versions = containerVersions(http, access.captureEndpoint);
  // Supplemental identities follow the same invariant as the mutation target:
  // captured version AND synchronous endpoint assertion, with all I/O pre-hydrated.
  const finalIdentity = (
    identity: ResourceIdentity,
    verifyHeaders: NonNullable<CommitChecks["verifyHeaders"]>,
  ) => {
    const captured = requireResourceAssertion(identity, errorFor);
    return {
      ...versions.identity(captured),
      verifyHeaders: (headers: Headers): undefined => {
        captured.verifyHeaders(headers);
        verifyHeaders(headers);
      },
      http,
      error: errorFor,
    };
  };
  // Content identity includes its captured access discovery. Every resource HEAD,
  // including completion/recovery checks, must assert both from the same response.
  const checkResourceIdentity = (
    url: string,
    etag: string | null | undefined,
    verifyHeaders: NonNullable<CommitChecks["verifyHeaders"]>,
  ) => checkIdentity(http, url, validator(url, etag), errorFor, false, verifyHeaders);
  const captureResource = (
    resource: CreatedResource,
    etag: string | null | undefined,
    headers?: Headers,
  ) => {
    if (headers && !resource.source.demo && !resource.ownAcl) {
      const endpoint = access.discover(resource.url, headers);
      if (endpoint)
        resource.ownAcl = {
          url: endpoint,
          policy: null,
          verifyResourceHeaders: access.captureEndpoint(resource.url, headers),
        };
    }
    resource.etag = etag ?? undefined;
    if (resource.url.endsWith("/")) versions.track(resource.url);
  };
  const checkContainerVersion = (resource: CreatedResource, etag: string | undefined) => {
    assertVersion(
      versions.identity({ url: resource.url, etag: validator(resource.url, resource.etag) }),
      etag,
      errorFor,
    );
  };
  const requireOwnReceipt = (own: AccessState["own"], demo: boolean | undefined) => {
    // Missing discovery is unknown ownership. Neither cleanup nor protection may
    // adopt another writer's ACL just because our content PUT still matches.
    if (!own && !demo) throw new DriveAccessError("Own ACL receipt unavailable");
    return own;
  };
  const captureOwnAccess = async (url: string, headers: Headers) => {
    const state = await access.snapshot(url, headers);
    if (state.status === "unknown") throw new DriveAccessError(state.cause);
    return requireOwnReceipt(state.own, false);
  };
  const createdOwnAccess = (resource: CreatedResource) =>
    requireOwnReceipt(
      resource.protection
        ? {
            ...resource.ownAcl,
            url: resource.protection.url,
            policy: resource.protection,
            ...resourceDiscoveryOptions(resource.protection),
          }
        : resource.ownAcl,
      resource.source.demo,
    );
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

  const prepareContentTargets = async (targets: readonly string[]): Promise<void> => {
    for (const target of targets) {
      access.assertContentDestination(target);
      // Pending deletion owns both endpoints; preserve its specific retry signal.
      await deletion.guard(target);
    }
    await discoverContentTargets(http, storageUrl, access, targets);
  };

  const stat = async (
    url: string,
    opts?: { ifMatch: string; readonly verifyHeaders?: ResourceAssertion["verifyHeaders"] },
    captureHeaders?: (headers: Headers) => void,
  ): Promise<DriveItem> => {
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
    if (opts) assertVersion({ url, etag: opts.ifMatch }, etag, errorFor);
    opts?.verifyHeaders?.(response.headers);
    captureHeaders?.(response.headers);
    return {
      url,
      name: nameOf(url),
      kind: isFolder ? "folder" : "file",
      ...(contentType ? { contentType } : {}),
      ...(length !== null && !isFolder ? { size: Number(length) } : {}),
      ...(modified ? { modified: new Date(modified) } : {}),
      ...(etag ? { etag } : {}),
      ...protectedState,
      verifyHeaders: access.captureEndpoint(url, response.headers),
    };
  };

  const readVersion: DriveClient["readVersion"] = async (url) => {
    await provision.check(url);
    const response = await ensureOk(await http(url), url);
    rememberType(url, response.headers);
    const body = await response.blob();
    const etag = response.headers.get("etag");
    return {
      body,
      ...(etag ? { etag } : {}),
      verifyHeaders: access.captureEndpoint(url, response.headers),
    };
  };

  const read: DriveClient["read"] = async (url) => (await readVersion(url)).body;

  const readRdf: DriveClient["readRdf"] = async (url) => {
    await provision.check(url);
    try {
      const result = await fetchRdf(url, { fetch: http });
      rememberType(url, result.response.headers);
      return {
        dataset: result.dataset,
        ...(result.etag ? { etag: result.etag } : {}),
        verifyHeaders: access.captureEndpoint(url, result.response.headers),
      };
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
    clear: ResourceAssertion | null,
    policy: OwnAccess,
    copies: readonly { body: Blob | string; type: string }[],
    demo = false,
  ): Promise<string[]> => {
    const webId = owner ?? policyOwner(policy);
    if (!webId && !demo) throw new DriveAccessError("Recovery owner unavailable");
    const folder = `${storageUrl}.drive-recovery-${crypto.randomUUID()}/`;
    const retained: string[] = [];
    let committedBackup: string | undefined;
    try {
      await createFolder(
        folder,
        demo ? { kind: "inherit-verified" } : { kind: "owner-only", webId },
      );
      const recoveryAccess = await bindAccess(access, folder, folder);
      const survivors: ResourceAssertion[] = [];
      const backupAccess: AccessBinding[] = [];
      for (const [index, copy] of copies.entries()) {
        const target = `${folder}${index}-${encodeURIComponent(nameOf(url))}`;
        const binding = await bindAccess(access, target, target);
        backupAccess.push(binding);
        const saved = await write(
          target,
          copy.body,
          { contentType: copy.type, ifNoneMatch: "*" },
          { kind: "protect-ancestors" },
          undefined,
          undefined,
          {
            retainOnFailure: true,
            onWritten: () => {
              committedBackup = target;
            },
          },
        );
        // A committed backup remains discoverable even if its receipt is missing.
        retained.push(target);
        committedBackup = undefined;
        survivors.push({
          url: target,
          etag: validator(target, saved.etag),
          verifyHeaders: (headers) => {
            binding.verifyEndpoint(target, headers);
          },
        });
      }
      if (clear) {
        access.assertContentDestination(url);
        const required = await ledger.get(url);
        const cleared = await commitHttp({
          verifyHeaders: clear.verifyHeaders,
          rechecks: [recoveryAccess, ...backupAccess].map((binding) => () => binding.recheck()),
          policyGuards: [recoveryAccess, ...backupAccess].flatMap((binding) => binding.identities),
          finalIdentities: survivors.map((identity) =>
            finalIdentity(identity, (headers) => {
              for (const binding of [recoveryAccess, ...backupAccess])
                binding.verifyEndpoint(identity.url, headers);
            }),
          ),
          http,
          url,
          error: errorFor,
          init: {
            method: "PUT",
            headers: {
              "if-match": clear.etag,
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
      }
      // Retirement may touch IndexedDB even after the exposed PUT was cleared.
      // Verify the captured backup policies and identities before reporting them.
      await recoveryAccess.recheck();
      for (const binding of backupAccess) await binding.recheck();
      for (const identity of survivors)
        await checkResourceIdentity(identity.url, identity.etag, (headers) => {
          for (const binding of [recoveryAccess, ...backupAccess])
            binding.verifyEndpoint(identity.url, headers);
        });
    } catch (cause) {
      // write() may fail after its PUT commits. Nested quarantine reports the
      // useful replacement locations itself; otherwise retain this receipt too,
      // unless read-only discovery confirms that compensation removed it.
      if (
        committedBackup &&
        !(cause instanceof DrivePartialFailureError && cause.retainedDestinations.length)
      ) {
        const current = await http(committedBackup, { method: "HEAD", cache: "no-store" }).catch(
          () => undefined,
        );
        if (current?.status !== 404 && current?.status !== 410) retained.push(committedBackup);
      }
      throw new DrivePartialFailureError(
        url,
        [],
        [],
        [
          ...new Set([
            ...(isMissingItem(cause)
              ? retained.filter((target) => target !== (cause as DriveError).url)
              : retained),
            ...(cause instanceof DrivePartialFailureError ? cause.retainedDestinations : []),
          ]),
        ],
        cause,
      );
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
      Pick<CommitChecks, "identityChecks" | "policyGuards" | "verifyHeaders"> & {
        readonly onWritten?: (response: Response) => void;
        /** Keep uncertain private backups; evacuate confirmed access changes. */
        readonly retainOnFailure?: boolean;
      } = {},
    required?: OwnAccess,
  ): Promise<Response> => {
    access.assertContentDestination(url);
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
    // The payload's approved validator is immutable. Parent receipts can advance
    // ancestor guards during a tree operation, never a separate overwrite decision.
    let previous: { body: Blob; type: string } | undefined;
    if (binding && headers.get("if-none-match") !== "*") {
      const current = await http(url);
      if (current.status === 404) {
        if (!headers.has("if-match")) headers.set("if-none-match", "*");
      } else {
        await ensureOk(current, url);
        const approved = headers.get("if-match");
        if (approved) assertVersion({ url, etag: approved }, current.headers.get("etag"), errorFor);
        previous = {
          body: await current.blob(),
          type: current.headers.get("content-type") ?? "application/octet-stream",
        };
        if (!headers.has("if-match"))
          headers.set("if-match", validator(url, current.headers.get("etag") ?? undefined));
      }
    }
    // A 404 without discovery says nothing about a pre-existing own ACL. Only
    // an empty conditional creation may cross that uncertainty. The provisioner
    // verifies its actual endpoint/policy before this receipt authorizes bytes.
    // Copy/Move/Restore and owner-only writes already provision their placeholders.
    if (
      binding &&
      headers.get("if-none-match") === "*" &&
      !headers.has("if-match") &&
      binding.source.etag
    ) {
      const placeholder = await provision.file(
        url,
        undefined,
        url,
        () =>
          rawPut(url, "", { "content-type": init.headers["content-type"], "if-none-match": "*" }),
        () => {},
        () => recheckScope(scope),
      );
      headers.delete("if-none-match");
      headers.set("if-match", validator(url, placeholder.response.headers.get("etag")));
      if (placeholder.policy) binding.installed(placeholder.policy);
    }
    let response: Response;
    const compensation = new Compensation(async () => {
      const receipt = response.headers.get("etag");
      if (!receipt || receipt.startsWith("W/")) {
        // No write receipt authorizes touching the current representation.
        // Preserve both captured versions without clearing an unknown payload.
        const retained = await quarantine(
          url,
          null,
          (binding as AccessBinding).destinationPolicy,
          [
            ...(previous ? [previous] : []),
            { body: init.body, type: init.headers["content-type"] },
          ],
          !(binding as AccessBinding).source.etag,
        );
        throw new DrivePartialFailureError(
          url,
          [],
          [],
          retained,
          new DriveError("missing-validator", 409, url),
        );
      }
      const etag = receipt;
      // Cleanup needs our content AND own-ACL receipts: resource DELETE also
      // removes its ACL. Replays restore only the captured audience.
      await (binding as AccessBinding).rollback(async () => {
        if (previous) {
          const policy = (binding as AccessBinding).destinationPolicy;
          await replayOrQuarantine(
            url,
            policy,
            {
              method: "PUT",
              headers: { "content-type": previous.type, "if-match": etag },
              body: previous.body,
            },
            (binding as AccessBinding).destinationOwn,
            [
              previous,
              {
                body: init.body,
                type: init.headers["content-type"],
              },
            ],
          );
        } else {
          try {
            const own = requireOwnReceipt(
              (binding as AccessBinding).destinationOwn,
              response.headers.get("x-solid-demo-access-control") === "none",
            );
            await deleteVersion(url, etag, undefined, {
              policyGuards: ownAccessGuards(own),
              verifyHeaders: (headers) => access.verifyEndpoint(url, headers, own),
              rechecks: [() => access.checkOwn(own)],
            });
          } catch (cause) {
            const retained = await quarantine(
              url,
              {
                url,
                etag,
                verifyHeaders: (headers) => {
                  (binding as AccessBinding).verifyEndpoint(url, headers);
                },
              },
              (binding as AccessBinding).destinationPolicy,
              [
                {
                  body: init.body,
                  type: init.headers["content-type"],
                },
              ],
            );
            throw new DrivePartialFailureError(url, [], [], retained, cause);
          }
        }
      });
    });
    const ifMatch = headers.get("if-match");
    if (ifMatch) validator(url, ifMatch);
    const parents = await versions.prepare(url);
    const verifyHeaders: NonNullable<CommitChecks["verifyHeaders"]> = (headers) => {
      binding?.verifyEndpoint(url, headers);
      verifyScopeHeaders(scope, url, headers);
      effects.verifyHeaders?.(headers);
    };
    // Discovery above may reveal a nonstandard ACL endpoint at this URL.
    // This synchronous invariant also guards demo/direct and replay writes.
    access.assertContentDestination(url);
    response = await commitHttp({
      ...effects,
      verifyHeaders,
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
      policyGuards: [
        ...scopePolicyGuards(scope),
        ...(binding?.identities ?? []),
        ...(effects.policyGuards ?? []),
      ],
      finalIdentities: parents.map((identity) =>
        finalIdentity(identity, (headers) => {
          identity.verifyHeaders(headers);
          binding?.verifyEndpoint(identity.url, headers);
          verifyScopeHeaders(scope, identity.url, headers);
        }),
      ),
      http,
      url,
      init: { ...init, headers },
      error: (status, url) => errorFor(status === 404 || status === 410 ? 412 : status, url),
      response: async (response) => {
        await ensureOk(response, url);
        if (headers.get("if-none-match") === "*") access.recordCreation(url, response.headers);
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
      // Access HEADs cannot certify the bytes we just wrote. Keep recovery
      // armed until this PUT's own receipt survives every post-write await.
      if (!creating) await checkResourceIdentity(url, response.headers.get("etag"), verifyHeaders);
      // Transfer callers must record this PUT's validator before their post-write
      // access check can fail and invoke cleanup of the new representation.
      compensation.disarm();
    } catch (error) {
      if (effects.retainOnFailure && !(error instanceof DriveAccessChangedError)) {
        compensation.disarm();
      }
      await compensation.rollback();
      throw error;
    }
    return response;
  };

  /** Replay under protection no wider than either captured or current grants. */
  const replayProtected = async (
    url: string,
    policy: OwnAccess,
    init: PayloadWrite,
    effects?: Pick<CommitChecks, "identityChecks">,
    expectedOwn?: { url: string; policy: OwnAccess | null },
  ) => {
    validator(url, new Headers(init.headers).get("if-match"));
    // Replays preserve the complete captured own policy or its absence. They
    // verify that receipt; an unexpected policy is never repaired by an ACL PUT.
    const protectedPolicy = policy;
    const verifyProtection = async () => {
      const state = await access.effective(url);
      const current = requireAccess(state, url);
      // Captured absence is part of the policy. Replaying inherited bytes
      // must not freeze today's audience into a new own ACL.
      if (
        expectedOwn &&
        (state.own?.url !== expectedOwn.url || state.own.policy?.etag !== expectedOwn.policy?.etag)
      )
        throw new DriveAccessChangedError(["The item's own ACL changed"]);
      if (
        current.url !== protectedPolicy.url ||
        current.etag !== protectedPolicy.etag ||
        accessGains(protectedPolicy, current).length
      )
        throw new DriveAccessError("Rollback protection changed");
    };
    let replayed: Response | undefined;
    try {
      return await guardedWrite(url, init, false, verifyProtection, undefined, {
        ...effects,
        verifyHeaders: (headers) => access.verifyEndpoint(url, headers, expectedOwn),
        policyGuards: [
          ...ownAccessGuards(expectedOwn),
          ...(protectedPolicy.etag ? [protectedPolicy] : []),
        ],
        onWritten: (response) => {
          replayed = response;
        },
      });
    } catch (error) {
      // A post-replay failure cannot authorize rewriting a concurrent ACL.
      if (replayed) {
        const receipt = validator(url, replayed.headers.get("etag"));
        try {
          await verifyProtection();
        } catch (cause) {
          const retained = await quarantine(
            url,
            {
              url,
              etag: receipt,
              verifyHeaders: (headers) => access.verifyEndpoint(url, headers, expectedOwn),
            },
            protectedPolicy,
            [{ body: init.body, type: init.headers["content-type"] }],
          );
          throw new DrivePartialFailureError(url, [], [], retained, cause);
        }
      }
      throw error;
    }
  };

  /** Failed file and metadata replay share the same conditional evacuation.
   * Unexpected access never authorizes materializing or reverting its ACL.
   */
  const replayOrQuarantine = async (
    url: string,
    policy: OwnAccess,
    init: PayloadWrite,
    expectedOwn: AccessState["own"],
    copies: readonly { body: Blob | string; type: string }[],
    effects?: Pick<CommitChecks, "identityChecks">,
  ) => {
    try {
      return await replayProtected(url, policy, init, effects, expectedOwn);
    } catch (cause) {
      if (cause instanceof DrivePartialFailureError) throw cause;
      // Loss/replacement of the independent source is not permission to clear
      // the surviving destination. Its captured content must stay recoverable.
      for (const check of effects?.identityChecks ?? []) await check();
      const retained = await quarantine(
        url,
        {
          url,
          etag: validator(url, new Headers(init.headers).get("if-match")),
          verifyHeaders: (headers) => access.verifyEndpoint(url, headers, expectedOwn),
        },
        policy,
        copies,
      );
      throw new DrivePartialFailureError(url, [], [], retained, cause);
    }
  };

  const write = async (
    url: string,
    body: Blob | string,
    opts: WriteOptions,
    policy: WritePolicy,
    verifyAccess?: () => Promise<void>,
    scope?: AccessScope,
    effects?: Omit<CommitEffects, "onCommit"> &
      Pick<CommitChecks, "verifyHeaders"> & {
        readonly onWritten?: (response: Response) => void;
        readonly retainOnFailure?: boolean;
      },
  ): Promise<{ etag?: string }> => {
    requirePolicy(policy, ["protect-ancestors", "owner-only"]);
    access.assertContentDestination(url);
    if (opts.ifMatch !== undefined) validator(url, opts.ifMatch);
    let required: OwnAccess | undefined;
    let protectedEtag: string | undefined;
    if (policy.kind === "owner-only") {
      const current = await http(url, { method: "HEAD", cache: "no-store" });
      opts.verifyHeaders?.(current.headers);
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
          const own = await captureOwnAccess(url, current.headers);
          await provision.protect(url, required, url, {
            identity: {
              url,
              etag: protectedEtag,
              verifyHeaders: opts.verifyHeaders ?? access.captureEndpoint(url, current.headers),
            },
            knownAcl: own?.url,
            expectedAcl: own?.policy ?? null,
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
      {
        ...effects,
        verifyHeaders: (headers) => {
          opts.verifyHeaders?.(headers);
          effects?.verifyHeaders?.(headers);
        },
      },
      required,
    );
    // A replacement supersedes the previous listing's declarations before its refresh completes.
    resources.delete(url);
    responseTypes.delete(url);
    return { etag: validator(url, response.headers.get("etag")) };
  };

  const rawPut = async (
    target: string,
    body: "",
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
    deleteVersion: (url, etag, checks) => deleteVersion(url, etag, undefined, checks),
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
    bodies: boolean,
    approvedDiscovery?: ResourceAssertion["verifyHeaders"],
  ): Promise<SourceSnapshot> => {
    if (bodies) await provision.check(url);
    const policy = (headers: Headers): Promise<AccessState> =>
      bodies
        ? access.snapshot(url, headers)
        : Promise.resolve({ status: "unknown", cause: "Not read" });
    if (url.endsWith("/")) {
      const { items, etag, dataset, headers } = await listing(url);
      approvedDiscovery?.(headers);
      validator(url, etag);
      const own = await policy(headers);
      const binding = bodies ? await bindAccess(access, url, url, false, own) : undefined;
      const capturedDiscovery = access.captureEndpoint(url, headers);
      const verifyHeaders: ResourceAssertion["verifyHeaders"] = (headers) => {
        approvedDiscovery?.(headers);
        capturedDiscovery(headers);
      };
      const children: SourceSnapshot[] = [];
      for (const child of items) children.push(await snapshot(child.url, bodies));
      // A cached listing cannot certify children inspected after a root replacement.
      await checkResourceIdentity(url, versions.current(url, etag), verifyHeaders);
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
        verifyHeaders,
        ...(binding ? { binding } : {}),
      };
    }
    const response = await ensureOk(await http(url, bodies ? undefined : { method: "HEAD" }), url);
    approvedDiscovery?.(response.headers);
    const etag = response.headers.get("etag") ?? undefined;
    validator(url, etag);
    const own = await policy(response.headers);
    const binding = bodies ? await bindAccess(access, url, url, false, own) : undefined;
    const body = bodies ? await response.blob() : undefined;
    const capturedDiscovery = access.captureEndpoint(url, response.headers);
    const verifyHeaders: ResourceAssertion["verifyHeaders"] = (headers) => {
      approvedDiscovery?.(headers);
      capturedDiscovery(headers);
    };
    await checkResourceIdentity(url, etag, verifyHeaders);
    return {
      url,
      etag,
      children: undefined,
      demo: response.headers.get("x-solid-demo-access-control") === "none",
      access: own,
      verifyHeaders,
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
    recovery: string | undefined,
    commit: CommitChecks &
      CommitEffects & {
        readonly verifyHeaders: NonNullable<CommitChecks["verifyHeaders"]>;
        readonly survivors?: readonly ResourceAssertion[];
      },
    scope: AccessScope = new Set(),
  ) => {
    access.assertContentDestination(url);
    const parents = await versions.prepare(url);
    await deletion.remove(url, validator(url, etag), recovery, {
      ...commit,
      survivors: [...(commit.survivors ?? []), ...parents].map((identity) =>
        finalIdentity(identity, (headers) => {
          identity.verifyHeaders(headers);
          verifyScopeHeaders(scope, identity.url, headers);
        }),
      ),
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
    survivors: readonly ResourceAssertion[] = [],
    ancestors: readonly ResourceAssertion[] = [],
    scope: AccessScope = new Set(),
    policyGuards: readonly PolicyIdentity[] = [],
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
          [
            ...ancestors,
            {
              url: source.url,
              etag: validator(source.url, source.etag),
              verifyHeaders: source.verifyHeaders,
            },
          ],
          scope,
          policyGuards,
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
        verifyHeaders: (headers) => {
          source.verifyHeaders(headers);
          verifyScopeHeaders(scope, source.url, headers);
        },
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
        policyGuards: [...scopePolicyGuards(scope), ...policyGuards],
        disarm: disarm(source.url),
        onCommit: () => {
          deleted.push(source.url);
          retired(source.url);
        },
      },
      scope,
    );
  };

  const copySnapshot = async (
    source: SourceSnapshot,
    to: string,
    created: CreatedResource[],
    bindAccess: (url: string, policy?: OwnAccess) => Promise<void>,
    verifyAccess: () => Promise<void>,
    compensation: Compensation,
    scope: AccessScope,
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
                  dataset: access.retarget(source.inheritedAccess, source.url, to).dataset,
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
          scope,
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
        checkContainerVersion(resource, current.etag);
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
          scope,
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
        scope,
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
    await checkResourceIdentity(source.url, etag, source.verifyHeaders);
  };

  const secureRetained = async (
    resource: CreatedResource,
    privateWebId?: string,
  ): Promise<{ urls: string[]; warning?: unknown }> => {
    let policy =
      resource.protection ??
      resource.source.targetAccess ??
      resource.source.inheritedAccess ??
      resource.source.binding?.source;
    if (!policy || !resource.etag) return { urls: [resource.url] };
    if (privateWebId) {
      policy = { ...policy, dataset: privateAcl(resource.url, privateWebId) };
    }
    try {
      const identity = {
        url: resource.url,
        etag: validator(resource.url, versions.current(resource.url, resource.etag)),
      };
      if (resource.source.demo)
        await checkResourceIdentity(identity.url, identity.etag, (headers) =>
          access.verifyEndpoint(identity.url, headers, undefined),
        );
      else {
        const own = createdOwnAccess(resource);
        await provision.protect(
          resource.url,
          policy,
          privateWebId || resource.protection ? resource.url : resource.source.url,
          {
            identity: {
              ...identity,
              verifyHeaders: (headers) => access.verifyEndpoint(identity.url, headers, own),
            },
            restrict: true,
            knownAcl: own?.url,
            expectedAcl: own?.policy ?? null,
          },
        );
      }
      return { urls: [resource.url] };
    } catch (warning) {
      const urls = await quarantine(
        resource.url,
        {
          url: resource.url,
          etag: validator(resource.url, resource.etag),
          verifyHeaders: (headers) =>
            access.verifyEndpoint(resource.url, headers, createdOwnAccess(resource)),
        },
        policy,
        [
          {
            body: resource.source.body ?? (await serialize([...(resource.data as Store)])),
            type: resource.source.contentType ?? "text/turtle",
          },
        ],
        resource.source.demo,
      );
      return { urls, warning };
    }
  };

  const rollback = async (created: CreatedResource[], binding: AccessBinding) => {
    const retained: string[] = [];
    let pending: unknown;
    for (const resource of [...created].reverse()) {
      try {
        const own = createdOwnAccess(resource);
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
                  policyGuards: ownAccessGuards(own),
                  verifyHeaders: (headers) => access.verifyEndpoint(resource.url, headers, own),
                  rechecks: [() => access.checkOwn(own)],
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
                  policyGuards: ownAccessGuards(own),
                  verifyHeaders: (headers) => access.verifyEndpoint(resource.url, headers, own),
                  rechecks: [() => access.checkOwn(own)],
                  identityChecks: [() => verifySnapshotIdentity(resource.source)],
                }),
              ),
          });
        }
      } catch (error) {
        if (isMissingItem(error) && (error as DriveError).url === resource.url) continue;
        if (error instanceof DriveDeletePendingError) pending = error;
        // Refused source validation must not strand the retained recovery under
        // widened access. Only its captured destination identity authorizes repair.
        try {
          const secured = await secureRetained(resource);
          retained.push(...secured.urls);
          if (!pending) pending = secured.warning;
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

  const bindRecoveryPolicy = (
    url: string,
    captured: PolicyArchiveSnapshot | undefined,
    scope: AccessScope,
  ) => {
    const archiveUrl = policyArchiveOf(url) as string;
    const identity = {
      url: archiveUrl,
      etag: captured ? validator(archiveUrl, captured.etag) : null,
      ...(captured?.verifyHeaders ? { verifyHeaders: captured.verifyHeaders } : {}),
    };
    scope.archives ??= new Map();
    scope.archives.set(archiveUrl, captured ?? null);
    let active = true;
    scope.add({
      binding: {
        get identities() {
          return active ? [identity] : [];
        },
        recheck: async () => {
          if (active)
            await checkIdentity(
              http,
              identity.url,
              identity.etag,
              errorFor,
              false,
              identity.verifyHeaders,
            );
        },
        retire: (removed) => {
          if (removed === archiveUrl) active = false;
        },
      },
    });
  };
  /** Archived grants describe the original; use the preflight bytes and validator throughout. */
  const recoveryPolicy = async (
    url: string,
    own: OwnAccess,
    scope: AccessScope,
  ): Promise<OwnAccess | undefined> => {
    const archiveUrl = policyArchiveOf(url);
    if (!archiveUrl) return undefined;
    if (!scope.archives?.has(archiveUrl)) {
      const response = await http(archiveUrl);
      if (!response.ok && response.status !== 404) throw new DriveAccessError(response.status);
      bindRecoveryPolicy(
        url,
        response.status === 404
          ? undefined
          : {
              content: await response.text(),
              etag: response.headers.get("etag") ?? undefined,
              verifyHeaders: access.captureEndpoint(archiveUrl, response.headers),
            },
        scope,
      );
    }
    const captured = (scope.archives as Map<string, PolicyArchiveSnapshot | null>).get(archiveUrl);
    await checkIdentity(
      http,
      archiveUrl,
      captured?.etag ?? null,
      errorFor,
      false,
      captured?.verifyHeaders,
    );
    if (!captured) return undefined;
    const saved = (JSON.parse(captured.content) as Record<string, ArchivedAcl | null>)[url];
    if (saved === undefined) throw new DriveAccessError("Missing archived policy");
    if (saved === null) return own;
    return access.retarget(
      {
        url: saved.acl,
        etag: "",
        dataset: await parseRdf(saved.turtle, "text/turtle", { baseIRI: saved.acl }),
      },
      saved.resource,
      url,
      own.url,
    );
  };

  const preparePolicies = async (
    source: SourceSnapshot,
    from: string,
    to: string,
    privateOwner?: string,
    archiveContainers?: (archive: string) => Promise<void>,
    verifyAccess?: () => Promise<void>,
    scope: AccessScope = new Set(),
  ) => {
    if (!source.demo) {
      if (privateOwner) {
        // WAC own grants override defaults. Archive the original policies under
        // private Trash before replacing ALL recovery grants with owner-only ones.
        const archive: Record<string, ArchivedAcl> = {};
        const containers: Record<string, ArchivedAcl> = {};
        for (const node of snapshots(source)) {
          const destination = `${to}${node.url.slice(from.length)}`;
          const original = requireAccess(capturedAccess(node), node.url);
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
          const saved = await recoveryPolicy(
            node.url,
            requireAccess(capturedAccess(node), node.url),
            scope,
          );
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
    access.assertContentDestination(to);
    const capturedGuards = (opts?.sourceGuards ?? []).map((identity) =>
      requireResourceAssertion(identity, errorFor),
    );
    for (const identity of capturedGuards) versions.track(identity.url);
    await provision.check(from);
    const original = await listing(from);
    const originalDiscovery = access.captureEndpoint(from, original.headers);
    opts?.verifyHeaders?.(original.headers);
    versions.track(from);
    if (opts?.ifMatch !== undefined && original.etag !== opts.ifMatch)
      throw new DriveError("conflict", 412, from);
    const own = await access.snapshot(from, original.headers);
    const binding = await bindAccess(access, from, to, false, own);
    const source: SourceSnapshot = {
      url: from,
      etag: original.etag,
      children: [],
      data: containerData(original.dataset, from),
      demo: original.headers.get("x-solid-demo-access-control") === "none",
      access: own,
      verifyHeaders: (headers) => {
        opts?.verifyHeaders?.(headers);
        originalDiscovery(headers);
      },
      binding,
    };
    const effective = capturedAccess(source);
    requireAccess(effective, from);
    if (effective.status === "known") source.inheritedAccess = effective.policy;
    const verifyMerge = async () => {
      await binding.recheck();
      for (const identity of [
        ...capturedGuards,
        { url: from, etag: validator(from, original.etag), verifyHeaders: source.verifyHeaders },
      ])
        await checkResourceIdentity(identity.url, versions.identity(identity).etag, (headers) => {
          identity.verifyHeaders(headers);
          binding.verifyEndpoint(identity.url, headers);
          verifyScopeHeaders(scope, identity.url, headers);
        });
    };
    await preparePolicies(source, from, to, undefined, undefined, undefined, scope);
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
        const restoredPolicy = binding.destinationPolicy;
        const expected = resource.data as Store;
        const mergedBody = await serialize([...expected]);
        validator(to, resource.etag);
        const current = await listing(to);
        checkContainerVersion(resource, current.etag);
        if (!sameGraph(expected, containerData(current.dataset, to)))
          throw new DriveError("conflict", 409, to);
        await binding.rollback(() =>
          replayOrQuarantine(
            to,
            restoredPolicy,
            {
              method: "PUT",
              headers: { "content-type": "text/turtle", "if-match": validator(to, current.etag) },
              body,
            },
            binding.destinationOwn,
            [
              { body, type: "text/turtle" },
              { body: mergedBody, type: "text/turtle" },
            ],
            { identityChecks: [() => verifySnapshotIdentity(source)] },
          ),
        );
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
      if (created) checkContainerVersion(resource, current.etag);
      else resource.etag = current.etag;
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
          source: versions.identity({
            url: from,
            etag: validator(from, original.etag),
            verifyHeaders: source.verifyHeaders,
          }),
          destination: versions.identity({
            url: to,
            etag: validator(to, resource.etag),
            verifyHeaders: (headers: Headers): undefined => {
              binding.verifyEndpoint(to, headers);
            },
          }),
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
          verifyHeaders: (headers) => {
            binding.verifyEndpoint(to, headers);
          },
          onWritten: (response) => {
            captureResource(resource, response.headers.get("etag"), response.headers);
            resource.data = data;
          },
        },
      );
      await binding.recheck();
      const verified = await listing(to);
      checkContainerVersion(resource, verified.etag);
      if (!sameGraph(data, containerData(verified.dataset, to)))
        throw new DriveError("conflict", 409, to);
      await binding.recheck();
      scope.add(check);
      return {
        recheck,
        disarm: [compensation],
        source: versions.identity({
          url: from,
          etag: validator(from, original.etag),
          verifyHeaders: source.verifyHeaders,
        }),
        destination: versions.identity({
          url: to,
          etag: validator(to, resource.etag),
          verifyHeaders: (headers: Headers): undefined => {
            binding.verifyEndpoint(to, headers);
          },
        }),
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
    approvedDiscovery?: ResourceAssertion["verifyHeaders"],
  ): Promise<MoveResult> => {
    access.assertContentDestination(to);
    if (moving) access.assertContentDestination(from);
    if (from.endsWith("/") !== to.endsWith("/") || (from.endsWith("/") && to.startsWith(from))) {
      throw new DriveError("conflict", 409, to);
    }
    const ordinaryMove =
      moving && decision.kind === "confirm-move" && !privateOwner && !policyArchiveOf(from);
    const capturedGuards = sourceGuards.map((identity) =>
      requireResourceAssertion(identity, errorFor),
    );
    for (const identity of capturedGuards) versions.track(identity.url);
    await deletion.guard(from);
    const source = await snapshot(from, true, approvedDiscovery);
    if (approvedEtag !== undefined && source.etag !== validator(from, approvedEtag))
      throw new DriveError("conflict", 412, from);
    // A late revocation must leave a private recovery copy. Establish its owner
    // before copying bytes or retiring any node, including children without Control.
    const recoveryOwner = owner ?? policyOwner((source.binding as AccessBinding).source);
    if (moving && !source.demo && !recoveryOwner)
      throw new DriveAccessError("Recovery owner unavailable");
    // Reserve the captured tree before copying or removing any node. Child
    // cleanup shares the flight, including rollback after a failed copy.
    return sourceOperation(
      sourceUrls(source).flatMap((url) => [url, `${to}${url.slice(from.length)}`]),
      async (transferHeld) => {
        const nodes = snapshots(source);
        // Validate the whole tree before creating any destination or archive.
        for (const node of nodes) {
          access.assertContentDestination(`${to}${node.url.slice(from.length)}`);
          if (moving) access.assertContentDestination(node.url);
        }
        // Resolve every node, even for same-folder renames and descendants with own ACLs.
        // A missing Link or unreadable ancestor can never stand in for known absence.
        const effective = new Map<SourceSnapshot, AccessState>();
        for (const node of nodes) {
          const state = capturedAccess(node);
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
            // Any own ACL ends inheritance, including a deny-all default projection.
            const protectedChildren = protectedDefaults || node.access.status === "known";
            for (const child of node.children ?? []) affected(child, protectedChildren);
          };
          affected(source, false);
          if (inherited.length > 0) {
            const current = requireAccess(effective.get(source) as AccessState, from);
            const destination = requireAccess(await access.effective(to, true), to);
            let approvedDestination = acceptedAccess ?? destination;
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
              approvedDestination = destination;
              const choice = await options.confirmAccess({ from, to, gains, canKeep: true });
              if (choice === "cancel") throw new Error("Move cancelled");
              if (choice === "keep") {
                source.targetAccess = current;
                keepAccess = true;
              }
            }
            // Retry verifies the last consent's capture rather than adopting
            // the policy read after that consent, even with identical grants.
            destinationBinding.installed(approvedDestination, true);
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
          for (const identity of capturedGuards)
            await checkResourceIdentity(
              identity.url,
              versions.identity(identity).etag,
              (headers) => {
                identity.verifyHeaders(headers);
                verifyScopeHeaders(scope, identity.url, headers);
              },
            );
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
          await checkResourceIdentity(destination.url, etag, (headers) =>
            verifyScopeHeaders(scope, destination.url, headers),
          );
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
          await copySnapshot(
            source,
            to,
            created,
            bindDestination,
            verifyAccess,
            compensation,
            scope,
          );
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
                  verifyHeaders: (headers) => {
                    verifyScopeHeaders(scope, url, headers);
                  },
                  // The populated destination supplies the later Undo receipt.
                  // Cleanup uses only transitions from our committed mutations.
                  etag: node.children.length ? validator(url, current.etag) : copiedEtag,
                  children: [...expected],
                });
              } else
                destinations.set(node.url, {
                  url,
                  etag: copiedEtag,
                  verifyHeaders: (headers) => {
                    verifyScopeHeaders(scope, url, headers);
                  },
                });
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
              capturedGuards.map((identity) =>
                finalIdentity(identity, (headers) =>
                  verifyScopeHeaders(scope, identity.url, headers),
                ),
              ),
              [],
              scope,
            );
            // Source retirement includes durable local work. Check surviving
            // access while partial-transfer recovery is still available.
            await verifyAccess();
            for (const node of nodes) await verifyDestination(node);
          } else {
            // Copy also reports success only for the versions our PUTs created.
            verifyingCopy = true;
            for (const resource of created)
              await checkResourceIdentity(
                resource.url,
                versions.current(resource.url, resource.etag),
                (headers) => verifyScopeHeaders(scope, resource.url, headers),
              );
            verifyingCopy = false;
          }
        } catch (error) {
          for (const check of group) scope.delete(check);
          if (error instanceof DriveAccessError) accessFailure = true;
          if (error instanceof DriveAccessChangedError && error.gains.length)
            widenedAccess = error.gains;
          // Keep completed recovery once deletion starts. A late source policy
          // disagreement needs private copies, even before the first DELETE.
          const changedBeforeDelete = deleting && error instanceof DriveAccessChangedError;
          const keep =
            deleted.length ||
            changedBeforeDelete ||
            (!accessFailure && (verifyingCopy || deleting));
          if (!keep) await compensation.rollback();
          const retained = cleanup ? cleanup.retained : created.map(({ url }) => url);
          let protectionFailure: unknown;
          if (keep) {
            retained.length = 0;
            for (const resource of created) {
              try {
                const secured = await secureRetained(
                  resource,
                  changedBeforeDelete && !privateOwner ? recoveryOwner : undefined,
                );
                retained.push(...secured.urls);
                if (secured.warning) protectionFailure = secured.warning;
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
                capturedGuards,
                approvedDiscovery,
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
            error instanceof DriveDeletePendingError
              ? error
              : (protectionFailure ?? cleanup?.pending ?? error),
          );
        }
        compensation.disarm();
        const etag = destinations.get(from)?.etag;
        return {
          url: to,
          ...(etag ? { etag } : {}),
          ...(destinations.get(from)?.verifyHeaders
            ? {
                verifyHeaders: destinations.get(from)
                  ?.verifyHeaders as ResourceAssertion["verifyHeaders"],
              }
            : {}),
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
      opts?.verifyHeaders,
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
      opts?.verifyHeaders,
    );
  };

  const remove = async (
    url: string,
    opts: Parameters<DriveClient["remove"]>[1] = {},
    held: ReadonlySet<string> = new Set(),
    scope: AccessScope = new Set(),
  ) => {
    access.assertContentDestination(url);
    await deletion.guard(url);
    const deleted: string[] = [];
    let recovery: SourceSnapshot | undefined;
    const survivors = (opts.commit?.survivors ?? []).map((identity) =>
      finalIdentity(identity, (headers) => verifyScopeHeaders(scope, identity.url, headers)),
    );
    try {
      let capturedHeaders!: Headers;
      const observed = await stat(
        url,
        opts.ifMatch
          ? {
              ifMatch: opts.ifMatch,
              ...(opts.verifyHeaders ? { verifyHeaders: opts.verifyHeaders } : {}),
            }
          : undefined,
        (headers) => {
          capturedHeaders = headers;
        },
      );
      const capturedEtag = opts.ifMatch ?? observed.etag;
      assertVersion({ url, etag: validator(url, capturedEtag) }, observed.etag, errorFor);
      const verifyHeaders = access.captureEndpoint(url, capturedHeaders);
      const verify = async () => {
        await recheckScope(scope);
        for (const recheck of opts.commit?.rechecks ?? []) await recheck();
      };
      const identityCheck = async () => {
        for (const check of opts.commit?.identityChecks ?? []) await check();
      };
      // Partial Restore discards a duplicate only while its compared survivor
      // remains intact. Hydrate recoverable bytes before any final DELETE check.
      if (survivors.length) {
        recovery = await snapshot(url, true);
        if (!owner && !recovery.demo && !policyOwner((recovery.binding as AccessBinding).source))
          throw new DriveAccessError("Recovery owner unavailable");
      }
      if (url.endsWith("/") && opts.recursive) {
        const capturedSource = recovery ?? (await snapshot(url, false));
        const source: SourceSnapshot = {
          ...capturedSource,
          verifyHeaders: (headers) => {
            capturedSource.verifyHeaders(headers);
            verifyHeaders(headers);
            opts.verifyHeaders?.(headers);
            opts.commit?.verifyHeaders?.(headers);
          },
        };
        if (source.etag !== validator(url, capturedEtag))
          throw new DriveError("conflict", 412, url);
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
                survivors,
                [],
                scope,
                opts.commit?.policyGuards ?? [],
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
        await deleteVersion(
          url,
          capturedEtag,
          undefined,
          {
            verifyHeaders: (headers) => {
              verifyHeaders(headers);
              verifyScopeHeaders(scope, url, headers);
              opts.verifyHeaders?.(headers);
              opts.commit?.verifyHeaders?.(headers);
            },
            policyGuards: [...scopePolicyGuards(scope), ...(opts.commit?.policyGuards ?? [])],
            rechecks: [verify],
            identityChecks: [
              identityCheck,
              // Validate a compared recovery representation before its surviving
              // endpoints. The helper still repeats the target HEAD last.
              ...(opts.commit?.survivors?.length
                ? [() => checkResourceIdentity(url, capturedEtag, verifyHeaders)]
                : []),
            ],
            survivors,
            disarm: [...compensationsFor(scope, url), ...(opts.commit?.disarm ?? [])],
            onCommit: () => {
              deleted.push(url);
              retireScope(scope, url);
            },
          },
          scope,
        );
      }
      if (recovery) {
        await verify();
        for (const identity of survivors)
          await checkResourceIdentity(
            identity.url,
            versions.identity(identity).etag,
            identity.verifyHeaders,
          );
      }
    } catch (error) {
      if (deleted.length && recovery) {
        let retained: string[] = [];
        let recoveryFailure: unknown;
        try {
          const copies = await Promise.all(
            snapshots(recovery).map(async (node) => ({
              body: node.body ?? (await serialize([...(node.data as Store)])),
              type: node.contentType ?? "text/turtle",
            })),
          );
          retained = await quarantine(
            url,
            null,
            (recovery.binding as AccessBinding).source,
            copies,
            recovery.demo,
          );
        } catch (cause) {
          if (cause instanceof DrivePartialFailureError) retained = [...cause.retainedDestinations];
          recoveryFailure = cause;
        }
        throw new DrivePartialFailureError(
          url,
          deleted,
          sourceUrls(recovery).filter((source) => !deleted.includes(source)),
          retained,
          recoveryFailure ?? error,
        );
      }
      const cause = error instanceof DrivePartialFailureError ? error.cause : error;
      if (!isMissingItem(cause) || (cause as DriveError).url !== url || survivors.length)
        throw error;
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
      const archived = await recoveryPolicy(from, binding.source, scopeFor(this));
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
    bindRecoveryPolicy(url, captured) {
      bindRecoveryPolicy(url, captured, scopeFor(this));
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
          requirePolicy(args[2], ["protect-ancestors", "owner-only"]);
          await prepareContentTargets([url]);
          await recheckScope(scopeFor(this));
          const saved = await write(url, ...args, undefined, scopeFor(this));
          await recheckScope(scopeFor(this));
          return saved;
        },
        scopes.get(this),
      );
    },
    async createFolder(url, policy) {
      requirePolicy(policy, ["inherit-verified", "archived", "owner-only"]);
      await prepareContentTargets([url]);
      await createFolder(url, policy);
    },
    mergeContainer(from, to, policy, opts) {
      return sourceOperation(
        [from, to],
        async () => {
          requirePolicy(policy, ["preserve-source"]);
          await prepareContentTargets([to]);
          return mergeContainer(from, to, policy, scopeFor(this), opts);
        },
        scopes.get(this),
      );
    },
    prepareTrash: async (url, decision) => {
      requirePolicy(decision, ["owner-only"]);
      await prepareContentTargets([url]);
      const webId = decision.webId;
      if (webId) owner = webId;
      const response = await http(url, { method: "HEAD" });
      if (response.headers.get("x-solid-demo-access-control") === "none") return;
      if (!webId) throw new DriveAccessError("Owner WebID unavailable");
      const policy: OwnAccess = { url: `${url}.acl`, etag: "", dataset: privateAcl(url, webId) };
      const own = response.ok ? await captureOwnAccess(url, response.headers) : undefined;
      try {
        await provision.folder(url, decision);
      } catch (error) {
        if (!(error instanceof DriveError && error.kind === "conflict"))
          throw new DriveAccessError(error);
        try {
          await provision.protect(url, policy, url, {
            identity: {
              url,
              etag: validator(url, response.headers.get("etag")),
              verifyHeaders: access.captureEndpoint(url, response.headers),
            },
            knownAcl: own?.url,
            expectedAcl: own?.policy ?? null,
          });
        } catch (cause) {
          throw new DriveAccessError(cause);
        }
      }
    },
    copy(from, to, policy, opts) {
      return sourceOperation(
        [from, to],
        async (held) => {
          requirePolicy(policy, ["preserve-source"]);
          await prepareContentTargets([to]);
          return copy(from, to, policy, held, scopeFor(this), opts);
        },
        scopes.get(this),
      );
    },
    move(from, to, ...args) {
      return sourceOperation(
        [from, to],
        async (held) => {
          requirePolicy(args[0], ["preserve-source", "confirm-move"]);
          await prepareContentTargets([from, to]);
          return move(from, to, args[0], args[1], held, scopeFor(this));
        },
        scopes.get(this),
      );
    },
    remove(url, opts) {
      return sourceOperation(
        [url],
        async (held) => {
          await prepareContentTargets([url]);
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
