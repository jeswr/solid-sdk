// AUTHORED-BY Codex GPT-6.1-Sol
// Conditional LWS mutations (ADR-003 §7, T-024).
import type { Quad, Term } from "@jeswr/fetch-rdf";
import { escapeIri } from "@jeswr/rdf-serialize";
import { DataFactory, Store } from "n3";
import { StorageError, storageErrorFrom } from "./errors.js";
import { discard, mediaTypeOf, readResultFrom, scoped, send } from "./http.js";
import { paginate, throwIfAborted } from "./internal.js";
import { jsonBody, type LwsBackendOptions, linksetOf } from "./lws-backend.js";
import {
  applyQuadPatch,
  type RdfPatchError,
  rebuildQuads,
  serializeQuads,
  TRIPLE_FORMATS,
  WRITABLE_RDF,
} from "./rdf.js";
import { rdfBody } from "./read.js";
import { isTrashEndpoint, postTrash } from "./services.js";
import { patchFormulas } from "./solid-patch.js";
import type {
  Body,
  JsonPatchOp,
  Metadata,
  MetadataOp,
  ReadResult,
  StorageClient,
  WriteResult,
} from "./types.js";

type Writes = Pick<
  StorageClient,
  "write" | "writeRdf" | "create" | "patch" | "delete" | "move" | "setMetadata"
>;
type Context = { anchor: string } & Record<string, unknown>;
type Linkset = { linkset: Context[] };
type Target = { href: string };
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
const pointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** Insertion blank nodes are local to the patch, never identities in the fetched dataset. */
function freshenInserts(inserts: readonly Quad[], store: Store): Quad[] {
  const taken = new Set(
    [...store]
      .flatMap((q) => [q.subject, q.object, q.graph])
      .filter((term) => term.termType === "BlankNode")
      .map((term) => term.value),
  );
  const labels = new Map<string, Term>();
  let next = 0;
  const freshen = (term: Term): Term => {
    if (term.termType !== "BlankNode") return term;
    let fresh = labels.get(term.value);
    if (fresh === undefined) {
      let label: string;
      do {
        label = `insert${next++}`;
      } while (taken.has(label));
      fresh = DataFactory.blankNode(label);
      labels.set(term.value, fresh);
    }
    return fresh;
  };
  return inserts.map((q) =>
    DataFactory.quad(
      freshen(q.subject) as Quad["subject"],
      q.predicate,
      freshen(q.object) as Quad["object"],
      freshen(q.graph) as Quad["graph"],
    ),
  );
}

/** Generate sequential JSON Patch operations without changing the fetched raw document. */
function metadataPatch(
  meta: Metadata,
  ops: readonly (MetadataOp & { anchor: string })[],
): JsonPatchOp[] {
  const raw = structuredClone(meta.raw) as Linkset;
  const patch: JsonPatchOp[] = [];
  for (const op of ops) {
    const anchor = op.anchor;
    const indices = raw.linkset.flatMap((entry, i) =>
      new URL(entry.anchor, meta.url).href === anchor ? [i] : [],
    );
    const rel = /^[a-z][a-z0-9.-]*$/i.test(op.rel) ? op.rel.toLowerCase() : op.rel;
    if (op.op === "remove") {
      for (const i of indices) {
        const context = raw.linkset[i] as Context;
        if (!Object.hasOwn(context, rel)) continue;
        const targets = context[rel] as Target[];
        // Descending indices preserve sequential JSON Patch semantics, including duplicates.
        for (let j = targets.length - 1; j >= 0; j--) {
          if (new URL((targets[j] as Target).href, meta.url).href !== op.href) continue;
          targets.splice(j, 1);
          patch.push({ op: "remove", path: `/linkset/${i}/${pointer(rel)}/${j}` });
        }
      }
      continue;
    }
    if (
      indices.some((i) => {
        const context = raw.linkset[i] as Context;
        return (
          Object.hasOwn(context, rel) &&
          (context[rel] as Target[]).some(
            (target) => new URL(target.href, meta.url).href === op.href,
          )
        );
      })
    )
      continue;
    let i = indices[0];
    if (i === undefined) {
      i = raw.linkset.length;
      raw.linkset.push({ anchor });
      patch.push({ op: "add", path: "/linkset/-", value: { anchor } });
    }
    const context = raw.linkset[i] as Context;
    const path = `/linkset/${i}/${pointer(rel)}`;
    if (!Object.hasOwn(context, rel)) {
      Object.defineProperty(context, rel, { value: [], enumerable: true, writable: true });
      patch.push({ op: "add", path, value: [] });
    }
    const targets = context[rel] as Target[];
    targets.push({ href: op.href });
    patch.push({ op: "add", path: `${path}/-`, value: { href: op.href } });
  }
  return patch;
}

/** Attach writes to the read backend; every response retains its storage-binding checks. */
export function lwsWrites(
  options: LwsBackendOptions,
  client: () => StorageClient,
  inspect: (method: string, url: string, response: Response) => ReadResult["links"],
  metadata: (url: string, signal?: AbortSignal, described?: ReadResult) => Promise<Metadata>,
  list: StorageClient["list"],
): Writes {
  const { root, fetch } = options;
  function target(method: string, url: string): string {
    const dest = scoped(root, method, url);
    if (/[?#]/.test(dest)) throw new StorageError("bad-request", { method, url: dest });
    return dest;
  }
  function notRoot(method: string, url: string) {
    if (url === root) throw new StorageError("method-not-allowed", { method, url });
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
  async function remove(url: string, ifMatch: string, signal?: AbortSignal) {
    const response = await request("DELETE", url, { "If-Match": ifMatch }, signal);
    discard(response.body);
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
      if (dest === root) throw new StorageError("method-not-allowed", { method: "PUT", url: dest });
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
      if (isTrashEndpoint(client(), url)) {
        return postTrash(client(), fetch, url, body, opts.signal, inspect);
      }
      const parent = target("POST", url);
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
      // The shared SPARQL formula serializer accepts default-graph triples only.
      // Named graphs use RMW, which preserves graph identity in TriG and N-Quads.
      if (
        quads.every((q) => q.graph.termType === "DefaultGraph") &&
        Object.values(formats).some((types) => types.includes(SPARQL))
      ) {
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
        // Accept the stored representation, including native N-Triples, TriG and N-Quads.
        const read = await client().read(dest, { accept: "*/*", signal: opts.signal });
        const { type, dataset } = await rdfBody(read, "not-rdf");
        if (attempt === 0) checkEtag("PATCH", dest, read.etag, opts.ifMatch);
        const tag = requiredEtag("GET", dest, read.etag);
        if (!WRITABLE_RDF.has(type)) throw unsupported("PATCH", dest, "rdfConneg");
        const store = new Store([...dataset]);
        try {
          applyQuadPatch(store, freshenInserts(inserts, store), deletes, TRIPLE_FORMATS.has(type));
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
            contentType: read.contentType as string,
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
    async setMetadata(url, ops, opts) {
      const source = target("PATCH", url);
      conditional(opts?.ifMatch);
      const normalised = ops.map((op) => {
        if (op.op !== "add" && op.op !== "remove")
          throw new TypeError("Invalid metadata operation");
        relation(op.rel);
        iri(op.href);
        if (["linkset", "type", "up"].includes(op.rel.toLowerCase()))
          throw unsupported("PATCH", source, "patch");
        return {
          ...op,
          anchor: scoped(root, "PATCH", op.anchor ?? source),
          href: new URL(op.href).href,
        };
      });
      const meta = await metadata(source);
      const dest = target("PATCH", meta.url);
      checkEtag("PATCH", dest, meta.etag, opts.ifMatch);
      const patch = metadataPatch(meta, normalised);
      if (patch.length === 0) return { etag: meta.etag };
      return { etag: (await result(dest, await patchJson(dest, patch, opts.ifMatch))).etag };
    },
    async move(url, destination, opts = {}) {
      const source = target("MOVE", url);
      const dest = target("MOVE", destination);
      conditional(opts.ifMatch);
      notRoot("MOVE", source);
      const feature = client().features.move;
      if (feature.state !== "available") throw unsupported("MOVE", source, "move");
      if (dest === source) throw new StorageError("conflict", { method: "MOVE", url: source });
      const described = await client().head(source, { signal: opts.signal });
      checkEtag("MOVE", source, described.etag, opts.ifMatch);
      if (described.kind === "container" && !feature.detail.containers)
        throw unsupported("MOVE", source, "move");
      const meta = await metadata(source, opts.signal, described);
      const metaUrl = target("PATCH", meta.url);
      const tag = requiredEtag("GET", metaUrl, meta.etag);
      const contexts = (meta.raw as Linkset).linkset;
      const matches = contexts.flatMap((context, i) =>
        new URL(context.anchor, metaUrl).href === source && Object.hasOwn(context, "up")
          ? [{ context, i }]
          : [],
      );
      if (matches.length !== 1)
        throw invalid("GET", metaUrl, "Expected one resource context with up");
      const { context, i } = matches[0] as { context: Context; i: number };
      const up = context.up as Target[];
      if (up.length !== 1) throw invalid("GET", metaUrl, "Expected one parent target");
      const patch: JsonPatchOp[] = [
        { op: "test", path: `/linkset/${i}/anchor`, value: context.anchor },
        { op: "replace", path: `/linkset/${i}/up/0/href`, value: dest },
      ];
      const response = await request(
        "PATCH",
        metaUrl,
        { "Content-Type": JSON_PATCH, "If-Match": tag, Accept: "application/linkset+json" },
        opts.signal,
        JSON.stringify(patch),
      );
      const contentLocation = response.headers.get("content-location");
      let moved = source;
      if (contentLocation !== null || feature.detail.preservesIdentifier === false) {
        let delivered: string;
        try {
          if (!contentLocation) throw new TypeError("Missing Content-Location");
          delivered = target("PATCH", new URL(contentLocation, metaUrl).href);
        } catch {
          discard(response.body);
          throw invalid("PATCH", metaUrl, "Invalid moved linkset Content-Location");
        }
        const result = readResultFrom(
          response,
          delivered,
          {
            status: 200,
            kind: "resource",
            parent: null,
            metadataUrl: null,
            allow: null,
            links: new Map(),
            withBody: true,
          },
          opts.signal,
        );
        const raw = await jsonBody(
          result,
          ["application/linkset+json", "application/json"],
          opts.signal,
        );
        const returned = linksetOf(raw, delivered);
        // Context order is not stable across a move. Bind identity to the delivered
        // linkset and the requested destination, refusing missing or ambiguous matches.
        const anchors = [...returned].flatMap(([anchor, relations]) => {
          const parents = relations.get("up");
          const linksets = relations.get("linkset");
          return parents?.length === 1 &&
            parents[0]?.href === dest &&
            linksets?.length === 1 &&
            linksets[0]?.href === delivered
            ? [anchor]
            : [];
        });
        if (anchors.length !== 1)
          throw invalid("PATCH", metaUrl, "Expected one moved resource context");
        try {
          moved = target("MOVE", anchors[0] as string);
          if (moved === root) throw new TypeError("Cannot move to root");
        } catch {
          throw invalid("PATCH", metaUrl, "Invalid moved resource anchor");
        }
      } else discard(response.body);
      // The PATCH ETag belongs to the linkset, never to the resource's content.
      return { url: moved, etag: await etag(moved, null, opts.signal), created: moved !== source };
    },
    async delete(url, opts = {}) {
      const source = target("DELETE", url);
      conditional(opts.ifMatch);
      notRoot("DELETE", source);
      if (opts.recursive !== undefined && typeof opts.recursive !== "boolean")
        throw new TypeError("Invalid recursive option");
      if (!opts.recursive) {
        return remove(source, opts.ifMatch, opts.signal);
      }
      // RecursiveDeleteService advertises POST {container}, not DELETE with Depth support.
      // Retain conditional client traversal until recursive DELETE is established separately.
      const first = await client().head(source, { signal: opts.signal });
      checkEtag("DELETE", source, first.etag, opts.ifMatch);
      const nodes = [first];
      const seen = new Set([source]);
      // Follow logical containment, never path prefixes; preflight the whole tree before deleting.
      for (const node of nodes) {
        if (node.kind !== "container") continue;
        // HEAD already established the kind; an opaque container need not end in '/'.
        const entries = paginate(
          node.url,
          (cursor) => list(node.url, { cursor, signal: opts.signal }),
          opts.signal,
        );
        for await (const entry of entries) {
          const childUrl = target("DELETE", entry.url);
          if (childUrl === root || seen.has(childUrl) || nodes.length >= 10000)
            throw invalid("GET", node.url, "Invalid recursive containment tree");
          seen.add(childUrl);
          const child = await client().head(childUrl, { signal: opts.signal });
          if (child.parent !== node.url)
            throw invalid("HEAD", childUrl, "Member has a different parent");
          requiredEtag("HEAD", childUrl, child.etag);
          nodes.push(child);
        }
      }
      const changedMembership = new Set<string>();
      for (const node of nodes.reverse()) {
        // Keep the preflight validator unless our own child deletion changed membership.
        // Refreshing an untouched container would authorise deleting a replacement.
        let current = node;
        if (node.kind === "container" && changedMembership.has(node.url)) {
          current = await client().head(node.url, { signal: opts.signal });
          if (
            current.kind !== node.kind ||
            current.parent !== node.parent ||
            current.metadataUrl !== node.metadataUrl
          )
            throw invalid("HEAD", node.url, "Container identity changed during recursive deletion");
        }
        await remove(node.url, requiredEtag("HEAD", node.url, current.etag), opts.signal);
        if (node.parent !== null) changedMembership.add(node.parent);
      }
    },
  };
  return writes;
}
