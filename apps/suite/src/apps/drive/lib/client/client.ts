// AUTHORED-BY Claude Opus 5.5
/**
 * The Drive screens' storage seam. Screens and operations only see
 * {@link DriveClient}; this module implements it over Solid LDP with an
 * injected (authenticated) `fetch`. It is the interim adapter until the SDK
 * `StorageClient` (ADR-003) and the DRV-00 model land, at which point the
 * implementation swaps and the interface stays.
 */

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { Container, Resource } from "@solid/object";
import { DataFactory } from "n3";

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

export interface DriveClient {
  readonly storageUrl: string;
  /** Children of a folder (hidden dot-names included; the UI filters them). */
  list(folderUrl: string, options?: { signal?: AbortSignal }): Promise<DriveItem[]>;
  /** Metadata for one item (HEAD). */
  stat(url: string): Promise<DriveItem & { etag?: string }>;
  read(url: string): Promise<Blob>;
  write(url: string, body: Blob | string, options: WriteOptions): Promise<{ etag?: string }>;
  createFolder(url: string): Promise<void>;
  /** Copy a file (folders: recursive). Fails with a conflict when `to` exists. */
  copy(from: string, to: string): Promise<void>;
  /** Move = copy + delete (no native move on Solid); returns the new URL. */
  move(from: string, to: string): Promise<string>;
  remove(url: string, options?: { recursive?: boolean }): Promise<void>;
}

export type DriveErrorKind = "conflict" | "not-found" | "forbidden" | "unauthenticated" | "failed";

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

  const list: DriveClient["list"] = async (folderUrl, opts = {}) => {
    try {
      const result = await fetchRdf(folderUrl, {
        fetch: http,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const container = new Container(folderUrl, result.dataset, DataFactory);
      return [...container.contains].map((child) =>
        itemFromResource(new Resource(child.id, result.dataset, DataFactory)),
      );
    } catch (error) {
      if (error instanceof RdfFetchError && error.status !== undefined)
        throw errorFor(error.status, folderUrl);
      throw error;
    }
  };

  const stat: DriveClient["stat"] = async (url) => {
    const response = await ensureOk(await http(url, { method: "HEAD" }), url);
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

  const read: DriveClient["read"] = async (url) => {
    const response = await ensureOk(await http(url), url);
    return response.blob();
  };

  const write: DriveClient["write"] = async (url, body, opts) => {
    const headers: Record<string, string> = { "content-type": opts.contentType };
    if (opts.ifNoneMatch) headers["if-none-match"] = opts.ifNoneMatch;
    if (opts.ifMatch) headers["if-match"] = opts.ifMatch;
    const response = await ensureOk(await http(url, { method: "PUT", headers, body }), url);
    const etag = response.headers.get("etag");
    return etag ? { etag } : {};
  };

  const createFolder: DriveClient["createFolder"] = async (url) => {
    const target = url.endsWith("/") ? url : `${url}/`;
    await ensureOk(
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

  const copy: DriveClient["copy"] = async (from, to) => {
    if (from.endsWith("/")) {
      await createFolder(to);
      for (const child of await list(from)) {
        const suffix = child.url.slice(from.length);
        await copy(child.url, `${to}${suffix}`);
      }
      return;
    }
    const response = await ensureOk(await http(from), from);
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    await write(to, await response.blob(), { contentType, ifNoneMatch: "*" });
  };

  const remove: DriveClient["remove"] = async (url, opts = {}) => {
    if (url.endsWith("/") && opts.recursive) {
      for (const child of await list(url)) await remove(child.url, { recursive: true });
    }
    await ensureOk(await http(url, { method: "DELETE" }), url);
  };

  const move: DriveClient["move"] = async (from, to) => {
    if (to.startsWith(from) && from.endsWith("/")) {
      throw new DriveError("conflict", 409, to);
    }
    await copy(from, to);
    try {
      await remove(from, { recursive: true });
    } catch (error) {
      // Roll back the copy so a failed move never leaves two live copies.
      await remove(to, { recursive: true }).catch(() => undefined);
      throw error;
    }
    return to;
  };

  return { storageUrl, list, stat, read, write, createFolder, copy, move, remove };
}
