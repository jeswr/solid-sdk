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

import {
  accessControl,
  accessGains,
  type ConfirmAccess,
  DriveAccessError,
  type OwnAccess,
  privateAcl,
} from "./access";
import { containerData, relocate, sameGraph } from "./rdf";

const IANA_TYPE = /^http:\/\/www\.w3\.org\/ns\/iana\/media-types\/(.+)#Resource$/;

/** One row in a Drive listing. */
export interface DriveItem {
  readonly url: string;
  readonly name: string;
  readonly kind: "folder" | "file";
  readonly contentType?: string;
  readonly size?: number;
  readonly modified?: Date;
  readonly etag?: string;
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
  write(url: string, body: Blob | string, options: WriteOptions): Promise<{ etag?: string }>;
  createFolder(url: string): Promise<void>;
  /** Establish owner-only default access before writing the Trash index or bytes. */
  prepareTrash(url: string, webId?: string): Promise<void>;
  /** Merge surviving container data and restore the policy for a recreated container. */
  mergeContainer(from: string, to: string, copyPolicy: boolean): Promise<void>;
  /** Copy a file (folders: recursive). Fails with a conflict when `to` exists. */
  copy(from: string, to: string): Promise<void>;
  /** Move = copy + verified, conditional delete; returns the copied identity. */
  move(
    from: string,
    to: string,
    options?: { beforeDelete?: () => Promise<void>; privateOwner?: string },
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
  readonly access?: OwnAccess;
  readonly demo?: boolean;
  readonly accessUnknown?: boolean;
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

function itemFromResource(resource: Resource): DriveItem {
  let contentType: string | undefined;
  for (const type of resource.type) {
    const match = IANA_TYPE.exec(type);
    if (match?.[1]) contentType = match[1];
  }
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

/** Private sibling receipt; it stays outside the resource's recovery tree. */
export function policyArchiveOf(url: string): string | undefined {
  const match = /^(.*\/\.trash\/[0-9a-f-]{36}\/)/i.exec(url);
  return match ? `${match[1]}.access.json` : undefined;
}

export function createSolidDriveClient(options: {
  storageUrl: string;
  fetch: typeof globalThis.fetch;
  confirmAccess?: ConfirmAccess;
}): DriveClient {
  const { storageUrl } = options;
  const http = options.fetch;
  const access = accessControl(http, storageUrl);

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
        items: members.map((child) =>
          itemFromResource(new Resource(child.id, result.dataset, DataFactory)),
        ),
      };
    } catch (error) {
      if (error instanceof RdfFetchError && error.status !== undefined)
        throw errorFor(error.status, folderUrl);
      throw error;
    }
  };

  const list: DriveClient["list"] = async (url, opts) => (await listing(url, opts)).items;

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
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    const etag = response.headers.get("etag");
    const isFolder = url.endsWith("/");
    return {
      url,
      name: nameOf(url),
      kind: isFolder ? "folder" : "file",
      ...(contentType && !isFolder ? { contentType } : {}),
      ...(length !== null && !isFolder ? { size: Number(length) } : {}),
      ...(modified ? { modified: new Date(modified) } : {}),
      ...(etag ? { etag } : {}),
    };
  };

  const readVersion: DriveClient["readVersion"] = async (url) => {
    const response = await ensureOk(await http(url), url);
    const body = await response.blob();
    const etag = response.headers.get("etag");
    return etag ? { body, etag } : { body };
  };

  const read: DriveClient["read"] = async (url) => (await readVersion(url)).body;

  const readRdf: DriveClient["readRdf"] = async (url) => {
    try {
      const result = await fetchRdf(url, { fetch: http });
      return result.etag
        ? { dataset: result.dataset, etag: result.etag }
        : { dataset: result.dataset };
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return undefined;
      if (error instanceof RdfFetchError && error.status !== undefined)
        throw errorFor(error.status, url);
      throw error;
    }
  };

  const write: DriveClient["write"] = async (url, body, opts) => {
    const headers: Record<string, string> = { "content-type": opts.contentType };
    if (opts.ifNoneMatch) headers["if-none-match"] = opts.ifNoneMatch;
    if (opts.ifMatch) headers["if-match"] = opts.ifMatch;
    const response = await ensureOk(await http(url, { method: "PUT", headers, body }), url);
    const etag = response.headers.get("etag");
    return etag ? { etag } : {};
  };

  const putFolder = async (url: string): Promise<Response> => {
    const target = url.endsWith("/") ? url : `${url}/`;
    return ensureOk(
      await http(target, {
        method: "PUT",
        headers: {
          "content-type": "text/turtle",
          "if-none-match": "*",
          link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
      }),
      target,
    );
  };

  const createFolder: DriveClient["createFolder"] = async (url) => {
    await putFolder(url);
  };

  // Read and validate the complete tree before the first destination write or DELETE.
  const snapshot = async (
    url: string,
    requireValidator: boolean,
    bodies: boolean,
    tolerateAccessErrors = false,
  ): Promise<SourceSnapshot> => {
    const policy = async (headers: Headers) => {
      if (!bodies) return {};
      try {
        const own = await access.snapshot(url, headers);
        return own ? { access: own } : {};
      } catch (error) {
        if (!tolerateAccessErrors) throw error;
        return { accessUnknown: true };
      }
    };
    if (url.endsWith("/")) {
      const { items, etag, dataset, headers } = await listing(url);
      if (requireValidator) validator(url, etag);
      const children: SourceSnapshot[] = [];
      for (const child of items)
        children.push(await snapshot(child.url, requireValidator, bodies, tolerateAccessErrors));
      const own = await policy(headers);
      return {
        url,
        etag,
        children,
        demo: headers.get("x-solid-demo-access-control") === "none",
        ...(bodies ? { data: containerData(dataset, url) } : {}),
        ...own,
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
      ...own,
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

  const deleteVersion = async (url: string, etag: string | undefined) => {
    await ensureOk(
      await http(url, { method: "DELETE", headers: { "if-match": validator(url, etag) } }),
      url,
    );
  };

  const deleteSnapshot = async (
    source: SourceSnapshot,
    deleted: string[],
    verifyCopy?: (source: SourceSnapshot) => Promise<void>,
  ) => {
    await verifyCopy?.(source);
    let etag = source.etag;
    if (source.children?.length) {
      for (const child of source.children) await deleteSnapshot(child, deleted, verifyCopy);
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
    await deleteVersion(source.url, etag);
    deleted.push(source.url);
  };

  const copySnapshot = async (
    source: SourceSnapshot,
    to: string,
    created: CreatedResource[],
    copiedAccess: Map<string, OwnAccess>,
  ) => {
    const policy = source.targetAccess === undefined ? source.access : source.targetAccess;
    if (source.children) {
      const response = await putFolder(to);
      const resource = { url: to, etag: response.headers.get("etag") ?? undefined };
      created.push(resource);
      if (policy) copiedAccess.set(to, await access.install(policy, source.url, to));
      const data = relocate(source.data as Store, [[source.url, to]]);
      if (data.size) {
        const saved = await write(to, await serialize([...data]), {
          contentType: "text/turtle",
          ifMatch: validator(to, resource.etag),
        });
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
        const empty = await write(to, "", {
          contentType: source.contentType as string,
          ifNoneMatch: "*",
        });
        placeholder = { url: to, etag: empty.etag };
        created.push(placeholder);
        copiedAccess.set(to, await access.install(policy, source.url, to));
      }
      const result = await write(to, source.body as Blob, {
        contentType: source.contentType as string,
        ...(placeholder
          ? { ifMatch: validator(to, placeholder.etag) }
          : { ifNoneMatch: "*" as const }),
      });
      if (placeholder) placeholder.etag = result.etag;
      else created.push({ url: to, etag: result.etag });
    }
  };

  const rollback = async (created: CreatedResource[]): Promise<string[]> => {
    const retained: string[] = [];
    for (const resource of [...created].reverse()) {
      try {
        let etag = resource.etag;
        if (resource.url.endsWith("/")) {
          const current = await listing(resource.url);
          if (current.items.length) throw new DriveError("conflict", 409, resource.url);
          etag = current.etag;
        }
        await deleteVersion(resource.url, etag);
      } catch {
        retained.push(resource.url);
      }
    }
    return retained;
  };

  const preparePolicies = async (
    source: SourceSnapshot,
    from: string,
    to: string,
    privateOwner?: string,
  ) => {
    if (!source.demo) {
      if (privateOwner) {
        // WAC own grants override defaults. Archive the original policies under
        // private Trash before replacing ALL recovery grants with owner-only ones.
        const archive: Record<string, { resource: string; acl: string; turtle: string }> = {};
        for (const node of snapshots(source)) {
          const destination = `${to}${node.url.slice(from.length)}`;
          const original = node.access ?? (await access.effective(node.url));
          archive[destination] = {
            resource: node.url,
            acl: original.url,
            turtle: await serialize([...original.dataset]),
          };
          node.targetAccess = {
            url: `${node.url}.acl`,
            etag: "",
            dataset: privateAcl(node.url, privateOwner),
          };
        }
        await write(policyArchiveOf(to) as string, JSON.stringify(archive), {
          contentType: "application/json",
          ifNoneMatch: "*",
        });
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
                  ? (node.access ?? (await access.effective(node.url)))
                  : {
                      url: node.access?.url ?? saved.acl,
                      etag: "",
                      dataset: relocate(
                        await parseRdf(saved.turtle, "text/turtle", { baseIRI: saved.acl }),
                        [
                          [saved.acl, node.access?.url ?? saved.acl],
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

  const mergeContainer: DriveClient["mergeContainer"] = async (from, to, copyPolicy) => {
    const original = await listing(from);
    const own = await access.snapshot(from, original.headers);
    const source: SourceSnapshot = {
      url: from,
      etag: original.etag,
      children: [],
      data: containerData(original.dataset, from),
      demo: original.headers.get("x-solid-demo-access-control") === "none",
      ...(own ? { access: own } : {}),
    };
    await preparePolicies(source, from, to);
    const policy =
      source.targetAccess ?? own ?? (source.demo ? undefined : await access.effective(from));
    if (copyPolicy && policy) await access.install(policy, from, to);
    else if (
      policy &&
      accessGains(access.forResource(policy, from), await access.effective(to)).length
    )
      throw new DriveAccessError("Existing destination grants wider access");
    const current = await listing(to);
    const data = new Store([
      ...containerData(current.dataset, to),
      ...relocate(source.data as Store, [[from, to]]),
    ]);
    if (sameGraph(containerData(current.dataset, to), data)) return;
    await write(to, await serialize([...data]), {
      contentType: "text/turtle",
      ifMatch: validator(to, current.etag),
    });
    if (!sameGraph(data, containerData((await listing(to)).dataset, to)))
      throw new DriveError("conflict", 409, to);
  };

  const transfer = async (
    from: string,
    to: string,
    moving: boolean,
    beforeDelete?: () => Promise<void>,
    privateOwner?: string,
  ) => {
    if (from.endsWith("/") !== to.endsWith("/") || (from.endsWith("/") && to.startsWith(from))) {
      throw new DriveError("conflict", 409, to);
    }
    const ordinaryMove = moving && !privateOwner && !policyArchiveOf(from);
    const source = await snapshot(from, moving, true, ordinaryMove);
    let keepAccess = !ordinaryMove;
    if (ordinaryMove && !source.demo) {
      const unknown = (node: SourceSnapshot): boolean =>
        !!node.accessUnknown || !!node.children?.some(unknown);
      const inherited: SourceSnapshot[] = [];
      const affected = (node: SourceSnapshot, protectedDefaults: boolean) => {
        if (!node.access && !protectedDefaults) inherited.push(node);
        const protectedChildren =
          protectedDefaults || !!(node.access && access.hasDefaults(node.access, node.url));
        for (const child of node.children ?? []) affected(child, protectedChildren);
      };
      affected(source, false);
      if ((inherited.length > 0 && parentOf(from) !== parentOf(to)) || unknown(source)) {
        let effective: OwnAccess | undefined;
        let gains: string[];
        try {
          if (unknown(source)) throw new DriveAccessError();
          const top = await access.effective(from);
          const policies: OwnAccess[] = [];
          for (const node of inherited)
            policies.push(node === source ? top : await access.effective(node.url));
          effective = top;
          const destination = await access.effective(to, true);
          const widened = new Set<string>();
          for (const current of policies)
            for (const agent of accessGains(current, destination)) widened.add(agent);
          gains = [...widened];
        } catch {
          gains = ["Access could not be determined (including unreadable ACLs or unsupported ACP)"];
        }
        if (gains.length) {
          const choice = await options.confirmAccess?.({
            from,
            to,
            gains,
            canKeep: !!effective && !unknown(source),
          });
          if (!choice || choice === "cancel") throw new Error("Move cancelled");
          if (choice === "keep") {
            if (!effective || unknown(source))
              throw new DriveAccessError("Current access is unknown");
            source.targetAccess = effective;
            keepAccess = true;
          }
        }
      }
    }
    const created: CreatedResource[] = [];
    const copiedAccess = new Map<string, OwnAccess>();
    await preparePolicies(source, from, to, privateOwner);
    if (keepAccess) {
      for (const node of snapshots(source))
        if (!node.demo && !node.access && node.targetAccess === undefined)
          node.targetAccess = await access.effective(node.url);
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
        if (!current || current.etag !== own.etag || !sameGraph(own.dataset, current.dataset))
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
        for (const url of sourceUrls(source)) {
          // Each destination is checked again immediately before its source's
          // DELETE, since another child deletion may give a concurrent tab time.
          await verifyDestination({ url });
        }
        deleting = true;
        await deleteSnapshot(source, deleted, async (node) => {
          await beforeDelete?.();
          await verifyDestination(node);
          if (node.access) {
            const current = await access.read(node.access.url);
            if (
              !current ||
              current.etag !== node.access.etag ||
              !sameGraph(node.access.dataset, current.dataset)
            )
              throw new DriveAccessError("Source policy changed");
          }
        });
      }
    } catch (error) {
      // A network failure during DELETE is ambiguous: keep the recovery copy.
      const retained =
        verifyingCopy ||
        deleted.length ||
        (deleting &&
          (!(error instanceof DriveError) || error.kind === "not-found" || error.status >= 500))
          ? created.map(({ url }) => url)
          : await rollback(created);
      if (!deleted.length && !retained.length) throw error;
      const unverified = sourceUrls(source).filter((url) => !deleted.includes(url));
      throw new DrivePartialFailureError(from, deleted, unverified, retained, error);
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

  const copy: DriveClient["copy"] = async (from, to) => {
    await transfer(from, to, false);
  };

  const move: DriveClient["move"] = async (from, to, opts) => {
    return transfer(from, to, true, opts?.beforeDelete, opts?.privateOwner);
  };

  const remove: DriveClient["remove"] = async (url, opts = {}) => {
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
    prepareTrash: async (url, webId) => {
      const response = await http(url, { method: "HEAD" });
      if (response.headers.get("x-solid-demo-access-control") === "none") return;
      try {
        await createFolder(url);
      } catch (error) {
        if (!(error instanceof DriveError && error.kind === "conflict"))
          throw new DriveAccessError(error);
      }
      await access.privateFolder(url, webId);
    },
    copy,
    move,
    remove,
  };
}
