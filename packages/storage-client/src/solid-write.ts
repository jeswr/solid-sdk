// AUTHORED-BY Codex GPT-6.1-Sol
// Solid mutations (ADR-003 §6, T-022); the read side stays in solid-backend.ts.
import type { DatasetCore, Quad } from "@jeswr/fetch-rdf";
import { escapeIri } from "@jeswr/rdf-serialize";
import { DataFactory, Store } from "n3";
import { StorageError, type StorageErrorCode } from "./errors.js";
import { discard, failed, scoped, send } from "./http.js";
import { pathParent } from "./internal.js";
import { serializeQuads, WRITABLE_RDF } from "./rdf.js";
import type { SolidBackendOptions } from "./solid-backend.js";
import { buildN3Patch, n3Envelope, patchFormulas } from "./solid-patch.js";
import type { Body, ReadResult, ResourceKind, StorageClient, WriteResult } from "./types.js";

type Writes = Pick<
  StorageClient,
  "write" | "writeRdf" | "create" | "patch" | "delete" | "move" | "setMetadata"
>;
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const MEDIA = new RegExp(
  `^${TOKEN}/${TOKEN}(?:[ \\t]*;[ \\t]*${TOKEN}=(?:${TOKEN}|"(?:[\\t !#-\\[\\]-~\\x80-\\xff]|\\\\[\\t -~\\x80-\\xff])*"))*[ \\t]*$`,
);
const LDP_CONTAINER = '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"';
const LDP_RESOURCE = '<http://www.w3.org/ns/ldp#Resource>; rel="type"';
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function header(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.trim() !== value ||
    /[\r\n\0\u0100-\uFFFF]/.test(value)
  )
    throw new TypeError(`Invalid ${name}`);
}
function contentType(value: unknown): asserts value is string {
  header(value, "media type");
  if (!MEDIA.test(value)) throw new TypeError("Invalid media type");
}
function conditional(value: unknown, any = false): asserts value is string {
  header(value, "ifMatch");
  if (value === "*" && !any) throw new TypeError("ifMatch '*' is only allowed on write()");
}
function absoluteIri(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9+.-]*:/i.test(value) ||
    !URL.canParse(value) ||
    escapeIri(value) !== value
  )
    throw new TypeError("Expected an absolute IRI");
}
interface Node {
  url: string;
  kind: ResourceKind;
}
interface Copy extends Node {
  source: string;
  etag: string | null;
}

/** Attach mutations without changing the read implementation or its closure. */
export function solidWrites(options: SolidBackendOptions, client: () => StorageClient): Writes {
  const { fetch } = options;
  const root = options.root;
  const error = (code: StorageErrorCode, method: string, url: string, message?: string) =>
    new StorageError(code, { method, url, message });
  function target(method: string, url: string): string {
    const result = scoped(root, method, url);
    if (/[?#]/.test(result))
      throw error("bad-request", method, result, "Mutation URLs cannot have a query or fragment");
    return result;
  }
  function container(method: string, url: string): string {
    const result = target(method, url);
    if (!result.endsWith("/"))
      throw error("bad-request", method, result, "Expected a container URL");
    return result;
  }
  function nameFor(method: string, url: string, name: string | undefined): string | undefined {
    if (name === undefined) return undefined;
    if (typeof name !== "string") throw new TypeError("name must be a string");
    if (
      name === "" ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      [...name].some((c) => {
        const code = c.codePointAt(0) as number;
        return code < 32 || (code >= 127 && code <= 159);
      })
    )
      throw error("bad-request", method, url, "Invalid name");
    return encodeURIComponent(name);
  }
  function checkEtag(method: string, url: string, current: string | null, expected: string) {
    if (current !== expected)
      throw new StorageError("precondition-failed", { method, url, status: 412, etag: current });
  }
  async function etag(
    url: string,
    value: string | null,
    signal?: AbortSignal,
    refresh = false,
  ): Promise<string | null> {
    if (!refresh && value !== null) return value;
    if (options.etagFollowUp === false) return refresh ? value : null;
    try {
      return (await client().head(scoped(root, "HEAD", url), { signal })).etag;
    } catch {
      return null;
    } // A successful mutation must never reject because its HEAD failed.
  }
  async function request(
    method: string,
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    body?: Body,
  ): Promise<Response> {
    const response = await send(fetch, method, target(method, url), headers, signal, body);
    if (![200, 201, 204, 205].includes(response.status)) {
      if (response.status < 200 || response.status >= 400) await failed(method, url, response);
      discard(response.body);
      throw new StorageError("invalid-response", { method, url, status: response.status });
    }
    discard(response.body);
    return response;
  }
  async function result(
    url: string,
    response: Response,
    signal?: AbortSignal,
  ): Promise<WriteResult> {
    return {
      url,
      etag: await etag(url, response.headers.get("etag"), signal),
      created: response.status === 201,
    };
  }
  // The segment is already encoded. Never decode it, even when moving a non-UTF-8 name.
  async function createExact(
    parent: string,
    segment: string,
    kind: ResourceKind,
    body: Body,
    type: string,
    signal?: AbortSignal,
  ): Promise<WriteResult> {
    const url = target(
      "PUT",
      `${container("PUT", parent)}${segment}${kind === "container" ? "/" : ""}`,
    );
    contentType(type);
    const headers: Record<string, string> = { "Content-Type": type, "If-None-Match": "*" };
    if (kind === "container") headers.Link = LDP_CONTAINER;
    let response: Response;
    try {
      response = await request("PUT", url, headers, signal, kind === "container" ? "" : body);
    } catch (cause) {
      if (cause instanceof StorageError && cause.status === 412)
        throw new StorageError("conflict", {
          method: "PUT",
          url,
          status: 412,
          etag: cause.etag,
          cause,
          message: "name taken",
        });
      throw cause;
    }
    return result(url, response, signal);
  }
  async function remove(url: string, signal?: AbortSignal, ifMatch?: string): Promise<void> {
    await request("DELETE", url, ifMatch === undefined ? {} : { "If-Match": ifMatch }, signal);
  }
  async function tree(
    url: string,
    limit = Number.POSITIVE_INFINITY,
    signal?: AbortSignal,
  ): Promise<Node[]> {
    const nodes: Node[] = [{ url, kind: "container" }];
    for (const node of nodes) {
      if (node.kind !== "container") continue;
      for await (const entry of client().listAll(node.url, { signal })) {
        const child = target("GET", entry.url);
        nodes.push({ url: child, kind: entry.kind });
        if (nodes.length > limit)
          throw new StorageError("unsupported", {
            method: "MOVE",
            url,
            feature: "move",
            message: "Emulated moves are capped at 2000 resources",
          });
      }
    }
    return nodes;
  }
  // Cleanup is independent of the caller's aborted signal. Continue after failures to free every
  // safe copy, but retain each failure so the original error can never disappear.
  async function rollback(copies: readonly Copy[], keep: ReadonlySet<string>): Promise<unknown[]> {
    const failures: unknown[] = [];
    for (const copy of [...copies].reverse()) {
      if (keep.has(copy.url)) continue;
      try {
        await remove(
          copy.url,
          undefined,
          copy.kind === "resource" ? (copy.etag ?? undefined) : undefined,
        );
      } catch (cause) {
        failures.push(cause);
      }
    }
    return failures;
  }
  const writes: Writes = {
    async write(url, body, opts) {
      const dest = target("PUT", url);
      contentType(opts?.contentType);
      conditional(opts?.ifMatch, true);
      if (dest.endsWith("/"))
        throw error("method-not-allowed", "PUT", dest, "Containers have no writable body");
      const headers: Record<string, string> = { "Content-Type": opts.contentType };
      if (opts.ifMatch !== "*") headers["If-Match"] = opts.ifMatch;
      return result(dest, await request("PUT", dest, headers, opts.signal, body), opts.signal);
    },
    async writeRdf(url, dataset, opts) {
      const dest = target("PUT", url);
      conditional(opts?.ifMatch, true);
      const type = opts?.contentType ?? "text/turtle";
      contentType(type);
      if (!WRITABLE_RDF.has(type))
        throw new StorageError("unsupported", { method: "PUT", url: dest, feature: "rdfConneg" });
      return writes.write(dest, await serializeQuads(dataset, type, opts?.prefixes), {
        ...opts,
        contentType: type,
      });
    },
    async create(url, body, opts = {}) {
      const parent = container("POST", url);
      const kind = opts.kind ?? "resource";
      if (kind !== "resource" && kind !== "container") throw new TypeError("Invalid kind");
      if (opts.contentType !== undefined || kind === "resource") contentType(opts.contentType);
      const type = kind === "container" ? "text/turtle" : (opts.contentType as string);
      const segment = nameFor("POST", parent, opts.name);
      if (segment !== undefined)
        return createExact(parent, segment, kind, body ?? "", type, opts.signal);
      const slug = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((byte) => BASE32[byte % 32])
        .join("");
      header(slug, "Slug");
      const response = await request(
        "POST",
        parent,
        {
          "Content-Type": type,
          Slug: slug,
          Link: kind === "container" ? LDP_CONTAINER : LDP_RESOURCE,
        },
        opts.signal,
        kind === "container" ? "" : (body ?? ""),
      );
      const location = response.headers.get("location");
      if (location === null) throw error("invalid-response", "POST", parent, "Missing Location");
      let dest: string;
      try {
        dest = target("POST", new URL(location, parent).href);
        if (pathParent(dest, root) !== parent || dest.endsWith("/") !== (kind === "container"))
          throw new TypeError("Invalid Location child or kind");
      } catch {
        // URL parsing and scope errors can carry the raw Location, including credentials.
        throw error("invalid-response", "POST", parent, "Invalid Location");
      }
      return result(dest, response, opts.signal);
    },
    async patch(url, patch, opts) {
      const dest = target("PATCH", url);
      conditional(opts?.ifMatch);
      let body: string;
      let type: string;
      const feature = client().features.patch;
      const formats = feature.detail.formats;
      if (patch.kind === "rdf") {
        const advertised = formats["text/turtle"] ?? [];
        const format =
          advertised.includes("text/n3") || feature.state !== "available"
            ? "text/n3"
            : advertised.includes("application/sparql-update")
              ? "application/sparql-update"
              : null;
        if (format === null)
          throw new StorageError("unsupported", { method: "PATCH", url: dest, feature: "patch" });
        const formulas = await patchFormulas(patch, dest, format);
        type = format;
        if (format === "text/n3") {
          body = n3Envelope(formulas);
        } else if (!patch.where?.length && !formulas.variables) {
          body = [
            formulas.deletes ? `DELETE DATA {\n${formulas.deletes}}` : "",
            formulas.inserts ? `INSERT DATA {\n${formulas.inserts}}` : "",
          ]
            .filter(Boolean)
            .join(";\n");
        } else
          throw new StorageError("unsupported", { method: "PATCH", url: dest, feature: "patch" });
      } else if (patch.kind === "json") {
        if (
          !Array.isArray(patch.ops) ||
          [...patch.ops].some(
            (op) =>
              !op ||
              typeof op !== "object" ||
              Array.isArray(op) ||
              !["add", "remove", "replace", "move", "copy", "test"].includes(op.op) ||
              typeof op.path !== "string",
          )
        )
          throw new TypeError("Invalid JSON Patch operations");
        if (!Object.values(formats).some((types) => types.includes("application/json-patch+json")))
          throw new StorageError("unsupported", { method: "PATCH", url: dest, feature: "patch" });
        type = "application/json-patch+json";
        body = JSON.stringify(patch.ops);
      } else {
        contentType(patch.mediaType);
        type = patch.mediaType;
        body = patch.body;
      }
      return result(
        dest,
        await request(
          "PATCH",
          dest,
          { "Content-Type": type, "If-Match": opts.ifMatch },
          opts.signal,
          body,
        ),
        opts.signal,
      );
    },
    async delete(url, opts = {}) {
      const dest = target("DELETE", url);
      conditional(opts.ifMatch);
      if (dest === root) throw error("method-not-allowed", "DELETE", dest);
      if (opts.recursive && dest.endsWith("/")) {
        checkEtag(
          "DELETE",
          dest,
          (await client().head(dest, { signal: opts.signal })).etag,
          opts.ifMatch,
        );
        for (const node of (await tree(dest, undefined, opts.signal)).sort((a, b) =>
          a.url < b.url ? 1 : -1,
        ))
          await remove(node.url, opts.signal);
      } else await remove(dest, opts.signal, opts.ifMatch);
    },
    async move(url, destination, opts = {}) {
      const source = target("MOVE", url);
      const parent = container("MOVE", destination);
      conditional(opts.ifMatch);
      if (source === root) throw error("method-not-allowed", "MOVE", source);
      const kind = source.endsWith("/") ? "container" : "resource";
      if (kind === "container" && parent.startsWith(source))
        throw error("conflict", "MOVE", source, "Cannot move a container into itself");
      const segment =
        nameFor("MOVE", source, opts.name) ??
        source.slice((pathParent(source, root) as string).length).replace(/\/$/, "");
      const dest = target("MOVE", `${parent}${segment}${kind === "container" ? "/" : ""}`);
      const first =
        kind === "container"
          ? await client().head(source, { signal: opts.signal })
          : await client().read(source, { signal: opts.signal });
      if (first.etag !== opts.ifMatch) discard(first.body);
      checkEtag("MOVE", source, first.etag, opts.ifMatch);
      const nodes: Node[] =
        kind === "container" ? await tree(source, 2000, opts.signal) : [{ url: source, kind }];
      const data = new Map<string, { body: Uint8Array; type: string | null }>();
      const excluded = new Set<string>();
      for (const node of nodes) {
        if (node.url !== source && (excluded.has(node.url) || /\.(acl|acr)$/.test(node.url))) {
          excluded.add(node.url);
          continue;
        }
        const read: ReadResult =
          node.url === source
            ? first
            : node.kind === "container"
              ? await client().head(node.url, { signal: opts.signal })
              : await client().read(node.url, { signal: opts.signal });
        if (read.metadataUrl) {
          const metadataUrl = target("GET", read.metadataUrl);
          if (metadataUrl !== source) excluded.add(metadataUrl);
        }
        if (node.kind === "resource")
          data.set(node.url, { body: await read.bytes(), type: read.contentType });
      }
      const planned = nodes.filter((node) => !excluded.has(node.url));
      // Metadata can precede its resource in the listing; validate only representations that
      // will actually be copied, after all describedby links have been discovered.
      for (const [url, value] of data) if (!excluded.has(url)) contentType(value.type);
      const copies: Copy[] = [];
      try {
        for (const node of planned) {
          const copyUrl = dest + node.url.slice(source.length);
          const copyParent = pathParent(copyUrl, root) as string;
          const copySegment = copyUrl.slice(copyParent.length).replace(/\/$/, "");
          const value = data.get(node.url);
          const copied = await createExact(
            copyParent,
            copySegment,
            node.kind,
            value?.body ?? "",
            value?.type ?? "text/turtle",
            opts.signal,
          );
          copies.push({ ...node, source: node.url, url: copied.url, etag: copied.etag });
        }
      } catch (cause) {
        const failures = await rollback(copies, new Set());
        if (failures.length)
          throw new StorageError("conflict", {
            method: "MOVE",
            url: source,
            cause: new AggregateError([cause, ...failures], "Copy and rollback failed"),
          });
        throw cause;
      }
      const deleted = new Set<string>();
      try {
        for (const node of [...nodes].sort((a, b) => (a.url < b.url ? 1 : -1))) {
          await remove(node.url, opts.signal, kind === "resource" ? opts.ifMatch : undefined);
          deleted.add(node.url);
        }
      } catch (cause) {
        const keep = new Set<string>();
        // Any failed DELETE may have committed, including a gateway's 5xx. Probe without the
        // caller's signal; only a successful HEAD makes removing a copy safe.
        for (const copy of copies) {
          let exists = !deleted.has(copy.source);
          if (exists) {
            try {
              await client().head(copy.source);
            } catch {
              exists = false;
            }
          }
          if (!exists) keep.add(copy.url);
        }
        // Preserve ancestors of every surviving copy.
        for (const copy of copies)
          if ([...keep].some((url) => url.startsWith(copy.url)) && copy.kind === "container")
            keep.add(copy.url);
        const failures = await rollback(copies, keep);
        throw new StorageError("conflict", {
          method: "MOVE",
          url: source,
          cause: failures.length
            ? new AggregateError([cause, ...failures], "Delete and rollback failed")
            : cause,
          message:
            deleted.size || keep.size || failures.length
              ? "The move was partial; some copies were preserved or could not be removed"
              : "Source delete failed; the copy was rolled back",
        });
      }
      const top = copies[0] as Copy;
      return {
        url: dest,
        etag: await etag(dest, top.etag, opts.signal, kind === "container"),
        created: true,
      };
    },
    async setMetadata(url, ops, opts) {
      const dest = target("PATCH", url);
      conditional(opts?.ifMatch);
      const changes = ops.map((op) => {
        const anchor = scoped(root, "PATCH", op.anchor ?? dest);
        absoluteIri(op.href);
        let rel = op.rel;
        if (/^[a-z][a-z0-9.-]*$/i.test(rel))
          rel = `http://www.iana.org/assignments/relation/${rel.toLowerCase()}`;
        else absoluteIri(rel);
        if (op.op !== "add" && op.op !== "remove")
          throw new TypeError("Invalid metadata operation");
        return {
          op: op.op,
          quad: DataFactory.quad(
            DataFactory.namedNode(anchor),
            DataFactory.namedNode(rel),
            DataFactory.namedNode(op.href),
          ),
        };
      });
      const document = await client().metadata(dest);
      const metadataUrl = target("PATCH", document.url);
      checkEtag("PATCH", metadataUrl, document.etag, opts.ifMatch);
      const original = document.raw as DatasetCore;
      const effective = new Store([...(original as Iterable<Quad>)]);
      for (const change of changes) {
        if (change.op === "add") effective.add(change.quad);
        else effective.delete(change.quad);
      }
      const inserts = [...effective].filter((q) => !original.has(q));
      const deletes = [...(original as Iterable<Quad>)].filter((q) => !effective.has(q));
      if (!inserts.length && !deletes.length) return { etag: document.etag };
      const response = await request(
        "PATCH",
        metadataUrl,
        { "Content-Type": "text/n3", "If-Match": opts.ifMatch },
        undefined,
        await buildN3Patch({ inserts, deletes }),
      );
      return { etag: await etag(metadataUrl, response.headers.get("etag")) };
    },
  };
  return writes;
}
