// AUTHORED-BY Codex GPT-6.1-Sol
// Conditional LWS mutations (ADR-003 §7, T-024).
import { escapeIri } from "@jeswr/rdf-serialize";
import { Store } from "n3";
import { StorageError, storageErrorFrom } from "./errors.js";
import { discard, mediaTypeOf, scoped, send } from "./http.js";
import { throwIfAborted } from "./internal.js";
import type { LwsBackendOptions } from "./lws-backend.js";
import {
  applyQuadPatch,
  type RdfPatchError,
  rebuildQuads,
  serializeQuads,
  TRIPLE_FORMATS,
  WRITABLE_RDF,
} from "./rdf.js";
import { patchFormulas } from "./solid-patch.js";
import type { Body, JsonPatchOp, ReadResult, StorageClient, WriteResult } from "./types.js";

type Writes = Pick<StorageClient, "write" | "writeRdf" | "create" | "patch">;
const LWS = "https://www.w3.org/ns/lws#";
const JSON_PATCH = "application/json-patch+json";
const SPARQL = "application/sparql-update";
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const MEDIA = new RegExp(
  `^${TOKEN}/${TOKEN}(?:[ \\t]*;[ \\t]*${TOKEN}=(?:${TOKEN}|"(?:[\\t !#-\\[\\]-~\\x80-\\xff]|\\\\[\\t -~\\x80-\\xff])*"))*[ \\t]*$`,
);
function header(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.trim() !== value ||
    /[\r\n\0\u0100-\uFFFF]/.test(value)
  )
    throw new TypeError("Invalid header value");
}
function contentType(value: unknown): asserts value is string {
  header(value);
  if (!MEDIA.test(value)) throw new TypeError("Invalid media type");
}
function conditional(value: unknown, any = false): asserts value is string {
  header(value);
  if (value === "*" && !any) throw new TypeError("ifMatch '*' is only allowed on write()");
}
function iri(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9+.-]*:/i.test(value) ||
    !URL.canParse(value) ||
    escapeIri(value) !== value
  )
    throw new TypeError("Expected an absolute IRI");
}
function relation(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new TypeError("Invalid relation");
  if (!/^[a-z][a-z0-9.-]*$/i.test(value)) iri(value);
  // `anchor` is linkset structure, never a relation array.
  if (value.toLowerCase() === "anchor") throw new TypeError("anchor is reserved");
}
function invalid(method: string, url: string, message: string): StorageError {
  return new StorageError("invalid-response", { method, url, message });
}
function unsupported(method: string, url: string, feature: "move" | "patch" | "rdfConneg") {
  return new StorageError("unsupported", { method, url, feature });
}
function checkEtag(method: string, url: string, current: string | null, expected: string) {
  if (current !== expected)
    throw new StorageError("precondition-failed", { method, url, status: 412, etag: current });
}
function requiredEtag(method: string, url: string, value: string | null): string {
  try {
    conditional(value);
  } catch {
    throw invalid(method, url, "A conditional mutation requires a usable response ETag");
  }
  return value;
}
/** Attach writes to the read backend; every response retains its storage-binding checks. */
export function lwsWrites(
  options: LwsBackendOptions,
  client: () => StorageClient,
  inspect: (method: string, url: string, response: Response) => ReadResult["links"],
): Writes {
  const { root, fetch } = options;
  function target(method: string, url: string): string {
    const dest = scoped(root, method, url);
    if (/[?#]/.test(dest)) throw new StorageError("bad-request", { method, url: dest });
    return dest;
  }
  function container(method: string, url: string): string {
    const dest = target(method, url);
    if (!dest.endsWith("/")) throw new StorageError("bad-request", { method, url: dest });
    return dest;
  }
  async function request(
    method: string,
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    body?: Body,
  ): Promise<Response> {
    const response = await send(fetch, method, target(method, url), headers, signal, body);
    inspect(method, url, response);
    if (response.status >= 400) {
      const error = await storageErrorFrom(method, url, response);
      throwIfAborted(method, url, signal);
      throw body instanceof ReadableStream
        ? new StorageError(error.code, { ...error, message: error.message, retryable: false })
        : error;
    }
    const accepted = method === "POST" ? [201] : [200, 204, 205];
    if (!accepted.includes(response.status)) {
      discard(response.body);
      throw invalid(method, url, "Unexpected mutation status");
    }
    return response;
  }
  async function etag(url: string, value: string | null, signal?: AbortSignal) {
    if (value !== null) return value;
    try {
      return (await client().head(url, { signal })).etag;
    } catch {
      return null; // The mutation already committed; a failed observation must not mask it.
    }
  }
  async function result(
    url: string,
    response: Response,
    signal?: AbortSignal,
  ): Promise<WriteResult> {
    discard(response.body);
    return {
      url,
      etag: await etag(url, response.headers.get("etag"), signal),
      created: response.status === 201,
    };
  }
  async function patchJson(
    url: string,
    ops: readonly JsonPatchOp[],
    ifMatch: string,
    signal?: AbortSignal,
  ) {
    return request(
      "PATCH",
      url,
      { "Content-Type": JSON_PATCH, "If-Match": ifMatch },
      signal,
      JSON.stringify(ops),
    );
  }
  const writes: Writes = {
    async write(url, body, opts) {
      const dest = target("PUT", url);
      conditional(opts?.ifMatch, true);
      contentType(opts?.contentType);
      if (dest.endsWith("/"))
        throw new StorageError("method-not-allowed", { method: "PUT", url: dest });
      return result(
        dest,
        await request(
          "PUT",
          dest,
          { "Content-Type": opts.contentType, "If-Match": opts.ifMatch },
          opts.signal,
          body,
        ),
        opts.signal,
      );
    },
    async writeRdf(url, dataset, opts) {
      const dest = target("PUT", url);
      conditional(opts?.ifMatch, true);
      const type = opts.contentType ?? "text/turtle";
      contentType(type);
      if (!WRITABLE_RDF.has(type)) throw unsupported("PUT", dest, "rdfConneg");
      return writes.write(dest, await serializeQuads(dataset, type, opts.prefixes), {
        ...opts,
        contentType: type,
      });
    },
    async create(url, body, opts = {}) {
      const parent = container("POST", url);
      const kind = opts.kind ?? "resource";
      if (kind !== "resource" && kind !== "container") throw new TypeError("Invalid kind");
      const type = opts.contentType ?? (kind === "container" ? "application/lws+json" : undefined);
      contentType(type);
      const headers: Record<string, string> = { "Content-Type": type };
      if (opts.name !== undefined) {
        header(opts.name);
        headers.Slug = opts.name;
      }
      const links = [`<${LWS}${kind === "container" ? "Container" : "DataResource"}>; rel="type"`];
      for (const link of opts.links ?? []) {
        relation(link.rel);
        iri(link.target);
        if (["up", "linkset"].includes(link.rel.toLowerCase()))
          throw unsupported("POST", parent, "patch");
        const value = `<${link.target}>; rel="${link.rel}"`;
        header(value);
        links.push(value);
      }
      headers.Link = links.join(", ");
      const response = await request("POST", parent, headers, opts.signal, body ?? "");
      const location = response.headers.get("location");
      let dest: string;
      try {
        if (location === null || location.trim() === "") throw new TypeError("Missing Location");
        dest = target("POST", new URL(location, parent).href);
        if (dest === parent || dest === root) throw new TypeError("Not a new resource");
      } catch {
        discard(response.body);
        // Never retain credentials or foreign URLs from an untrusted Location in the cause.
        throw invalid("POST", parent, "Invalid Location");
      }
      return result(dest, response, opts.signal);
    },
    async patch(url, patch, opts) {
      const dest = target("PATCH", url);
      conditional(opts?.ifMatch);
      if (patch.kind === "json") {
        if (
          !Array.isArray(patch.ops) ||
          patch.ops.some(
            (op) =>
              !op ||
              !["add", "remove", "replace", "move", "copy", "test"].includes(op.op) ||
              typeof op.path !== "string",
          )
        )
          throw new TypeError("Invalid JSON Patch operations");
        return result(
          dest,
          await patchJson(dest, patch.ops, opts.ifMatch, opts.signal),
          opts.signal,
        );
      }
      if (patch.kind === "raw") {
        contentType(patch.mediaType);
        if (typeof patch.body !== "string") throw new TypeError("Invalid raw patch body");
        return result(
          dest,
          await request(
            "PATCH",
            dest,
            { "Content-Type": patch.mediaType, "If-Match": opts.ifMatch },
            opts.signal,
            patch.body,
          ),
          opts.signal,
        );
      }
      if (patch.kind !== "rdf") throw new TypeError("Invalid patch kind");
      if (patch.inserts.length === 0 && patch.deletes.length === 0)
        throw new TypeError("empty patch");
      // Rebuild before any asynchronous read so callers cannot change the patch during RMW.
      let inserts: ReturnType<typeof rebuildQuads>;
      let deletes: ReturnType<typeof rebuildQuads>;
      let where: ReturnType<typeof rebuildQuads>;
      try {
        inserts = rebuildQuads(patch.inserts);
        deletes = rebuildQuads(patch.deletes);
        where = rebuildQuads(patch.where ?? []);
      } catch (cause) {
        throw new StorageError("bad-request", { method: "PATCH", url: dest, cause });
      }
      const quads = [...inserts, ...deletes, ...where];
      if (
        where.length ||
        quads.some((q) =>
          [q.subject, q.predicate, q.object, q.graph].some((term) => term.termType === "Variable"),
        )
      )
        throw unsupported("PATCH", dest, "patch");
      if (
        quads.some(
          (q) =>
            !["NamedNode", "BlankNode"].includes(q.subject.termType) ||
            q.predicate.termType !== "NamedNode" ||
            !["NamedNode", "BlankNode", "Literal"].includes(q.object.termType) ||
            !["DefaultGraph", "NamedNode", "BlankNode"].includes(q.graph.termType),
        )
      )
        throw new StorageError("bad-request", { method: "PATCH", url: dest });
      const formats = client().features.patch.detail.formats;
      if (Object.values(formats).some((types) => types.includes(SPARQL))) {
        const described = await client().head(dest, { signal: opts.signal });
        const type = mediaTypeOf(described.contentType);
        if (type !== null && formats[type]?.includes(SPARQL)) {
          const formulas = await patchFormulas({ inserts, deletes }, dest, SPARQL);
          const body = [
            formulas.deletes ? `DELETE DATA {\n${formulas.deletes}}` : "",
            formulas.inserts ? `INSERT DATA {\n${formulas.inserts}}` : "",
          ]
            .filter(Boolean)
            .join(";\n");
          return result(
            dest,
            await request(
              "PATCH",
              dest,
              { "Content-Type": SPARQL, "If-Match": opts.ifMatch },
              opts.signal,
              body,
            ),
            opts.signal,
          );
        }
      }
      for (let attempt = 0; ; attempt++) {
        const read = await client().readRdf(dest, { signal: opts.signal });
        if (attempt === 0) checkEtag("PATCH", dest, read.etag, opts.ifMatch);
        const tag = requiredEtag("GET", dest, read.etag);
        const type = mediaTypeOf(read.contentType) as string;
        if (!WRITABLE_RDF.has(type)) throw unsupported("PATCH", dest, "rdfConneg");
        const store = new Store([...read.dataset]);
        try {
          applyQuadPatch(store, inserts, deletes, TRIPLE_FORMATS.has(type));
        } catch (cause) {
          throw new StorageError(
            (cause as RdfPatchError).kind === "conflict" ? "conflict" : "bad-request",
            {
              method: "PATCH",
              url: dest,
              cause,
            },
          );
        }
        const body = await serializeQuads(store, type);
        try {
          return await writes.write(dest, body, {
            contentType: read.contentType,
            ifMatch: tag,
            signal: opts.signal,
          });
        } catch (cause) {
          if (
            attempt !== 0 ||
            !(cause instanceof StorageError) ||
            cause.code !== "precondition-failed"
          )
            throw cause;
        }
      }
    },
  };
  return writes;
}
