// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
/**
 * The Drive screens' storage seam. Screens and operations only see
 * {@link DriveClient}; this module implements it over Solid LDP with an
 * injected (authenticated) `fetch`. It is the interim adapter until the SDK
 * `StorageClient` (ADR-003) and the DRV-00 model land, at which point the
 * implementation swaps and the interface stays.
 */

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { Container, Resource } from "@solid/object";
import { DataFactory, type Store } from "n3";
import { mapConcurrent } from "../../../../lib/parallel";

const IANA_TYPE = /^http:\/\/www\.w3\.org\/ns\/iana\/media-types\/(.+)#Resource$/;

/** One row in a Drive listing. */
export interface DriveItem {
  readonly url: string;
  readonly name: string;
  readonly kind: "folder" | "file";
  readonly contentType?: string;
  readonly size?: number;
  readonly modified?: Date;
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
  /** Children of a folder (hidden dot-names included; the UI filters them). */
  list(folderUrl: string, options?: { signal?: AbortSignal }): Promise<DriveItem[]>;
  /** Metadata for one item (HEAD), optionally conditional on the expected version. */
  stat(url: string, options?: { ifMatch: string }): Promise<DriveItem & { etag?: string }>;
  read(url: string): Promise<Blob>;
  /** Bytes and validator from the same GET, for subsequent conditional deletion. */
  readVersion(url: string): Promise<{ body: Blob; etag?: string }>;
  /** Parsed RDF and its validator; `undefined` when the resource does not exist. */
  readRdf(url: string): Promise<{ dataset: Store; etag?: string } | undefined>;
  write(url: string, body: Blob | string, options: WriteOptions): Promise<{ etag?: string }>;
  createFolder(url: string): Promise<void>;
  /** Copy a file (folders: recursive). Fails with a conflict when `to` exists. */
  copy(from: string, to: string): Promise<void>;
  /** Move = copy + verified, conditional delete; returns the copied identity. */
  move(
    from: string,
    to: string,
    options?: { beforeDelete?: () => Promise<void> },
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
}

interface CreatedResource {
  readonly url: string;
  readonly etag: string | undefined;
}

function sourceUrls(source: SourceSnapshot): string[] {
  return [source.url, ...(source.children ?? []).flatMap(sourceUrls)];
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

export function createSolidDriveClient(options: {
  storageUrl: string;
  fetch: typeof globalThis.fetch;
}): DriveClient {
  const { storageUrl } = options;
  const http = options.fetch;

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
  ): Promise<SourceSnapshot> => {
    if (url.endsWith("/")) {
      const { items, etag } = await listing(url);
      if (requireValidator) validator(url, etag);
      const children: SourceSnapshot[] = [];
      for (const child of items) children.push(await snapshot(child.url, requireValidator, bodies));
      return { url, etag, children };
    }
    const response = await ensureOk(await http(url, bodies ? undefined : { method: "HEAD" }), url);
    const etag = response.headers.get("etag") ?? undefined;
    if (requireValidator) validator(url, etag);
    return {
      url,
      etag,
      children: undefined,
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
      if (current.items.length) throw new DriveError("conflict", 409, source.url);
      etag = current.etag;
      await verifyCopy?.(source);
    }
    await deleteVersion(source.url, etag);
    deleted.push(source.url);
  };

  const copySnapshot = async (source: SourceSnapshot, to: string, created: CreatedResource[]) => {
    if (source.children) {
      const response = await putFolder(to);
      created.push({ url: to, etag: response.headers.get("etag") ?? undefined });
      for (const child of source.children)
        await copySnapshot(child, `${to}${child.url.slice(source.url.length)}`, created);
    } else {
      const result = await write(to, source.body as Blob, {
        contentType: source.contentType as string,
        ifNoneMatch: "*",
      });
      created.push({ url: to, etag: result.etag });
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

  const transfer = async (
    from: string,
    to: string,
    moving: boolean,
    beforeDelete?: () => Promise<void>,
  ) => {
    if (from.endsWith("/") !== to.endsWith("/") || (from.endsWith("/") && to.startsWith(from))) {
      throw new DriveError("conflict", 409, to);
    }
    const source = await snapshot(from, moving, true);
    const created: CreatedResource[] = [];
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
      verifyingCopy = false;
    };
    try {
      await copySnapshot(source, to, created);
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
        await deleteSnapshot(source, deleted, verifyDestination);
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
    return transfer(from, to, true, opts?.beforeDelete);
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
    list,
    stat,
    read,
    readVersion,
    readRdf,
    write,
    createFolder,
    copy,
    move,
    remove,
  };
}
