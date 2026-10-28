// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import { SolidUpdateStore } from "@jeswr/y-solid";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import sanitizeHtml from "sanitize-html";
import { applyUpdate, Doc, encodeStateAsUpdate, XmlElement, XmlFragment, XmlText } from "yjs";
import { DriveAccessError } from "../../drive/lib/client/access";
import { type DriveClient, DriveError, type WriteOptions } from "../../drive/lib/client/client";
import { buildDocument, type PodDocument } from "../lib/model/document";
import { docContainerUrls } from "../lib/model/layout";
import { serializeTurtle } from "../lib/model/rdf-io";

const urlAttribute = (key: string) =>
  ["src", "href", "poster", "cite", "action", "formaction", "xlink:href"].includes(key) ||
  key.startsWith("data-");

/** Reuse the import pipeline's HTML parser, keeping text and non-URL attributes. */
function relocateHtml(html: string, relocate: (iri: string) => string): string {
  return sanitizeHtml(html, {
    allowedTags: false,
    allowedAttributes: false,
    allowVulnerableTags: true,
    nonTextTags: [],
    transformTags: {
      "*": (tagName, attribs) => {
        for (const [key, value] of Object.entries(attribs)) {
          if (urlAttribute(key)) attribs[key] = relocate(value);
          else if (key === "srcset")
            attribs[key] = value.replace(
              /(^|[\s,])(https?:\/\/[^\s,]+)/g,
              (_match, space: string, url: string) => `${space}${relocate(url)}`,
            );
        }
        return { tagName, attribs };
      },
    },
  });
}

/** Restore through the existing binary update store, retaining all CRDT identities. */
async function relocateLog(
  client: DriveClient,
  container: string,
  relocate: (iri: string) => string,
) {
  const store = new SolidUpdateStore({
    container,
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === "PUT") {
        await client.write(
          url,
          new Blob([init.body as Uint8Array<ArrayBuffer>]),
          {
            contentType: "application/octet-stream",
            ifNoneMatch: "*",
          },
          { kind: "protect-ancestors" },
        );
        return new Response(null, { status: 201 });
      }
      try {
        return new Response(await client.read(url));
      } catch (error) {
        if (error instanceof DriveError && error.kind === "not-found")
          return new Response(null, { status: 404 });
        throw error;
      }
    },
  });
  const updates = await store.loadUpdates();
  const doc = new Doc();
  try {
    try {
      for (const { update } of updates) applyUpdate(doc, update);
    } catch {
      // Keep unrecognised logs recoverable, as Drive's pre-trash compaction does.
      return;
    }
    let changed = false;
    const visit = (node: XmlFragment | XmlElement | XmlText) => {
      if (node instanceof XmlText) {
        let offset = 0;
        for (const part of node.toDelta()) {
          const length = typeof part.insert === "string" ? part.insert.length : 1;
          for (const [mark, attrs] of Object.entries(part.attributes ?? {})) {
            if (!attrs || typeof attrs !== "object") continue;
            const next: Record<string, unknown> = { ...attrs };
            for (const [key, value] of Object.entries(next)) {
              if (urlAttribute(key) && typeof value === "string") next[key] = relocate(value);
            }
            if (JSON.stringify(next) !== JSON.stringify(attrs)) {
              node.format(offset, length, { [mark]: next });
              changed = true;
            }
          }
          offset += length;
        }
        return;
      }
      if (node instanceof XmlElement) {
        for (const [key, value] of Object.entries(node.getAttributes())) {
          if (!urlAttribute(key) || typeof value !== "string") continue;
          const next = relocate(value);
          if (next !== value) {
            node.setAttribute(key, next);
            changed = true;
          }
        }
      }
      for (const child of node.toArray())
        if (child instanceof XmlFragment || child instanceof XmlText) visit(child);
    };
    doc.transact(() => visit(doc.getXmlFragment("prosemirror")));
    // Appending full state preserves pending structs in the untouched original updates.
    // Replaying on retry sees the rewrite already applied, including after a lost ack.
    if (changed) await store.appendUpdate(encodeStateAsUpdate(doc));
  } finally {
    doc.destroy();
  }
}

/** Move annotation identities and links through RDF term accessors, including blank nodes. */
async function relocateComments(
  client: DriveClient,
  container: string,
  relocate: (iri: string) => string,
) {
  let children: Awaited<ReturnType<DriveClient["list"]>>;
  try {
    children = await client.list(container);
  } catch (error) {
    if (error instanceof DriveError && error.kind === "not-found") return;
    throw error;
  }
  for (const child of children) {
    if (child.kind !== "file" || child.contentType !== "text/turtle") continue;
    const resource = await client.readRdf(child.url);
    if (!resource) throw new DriveError("not-found", 404, child.url);
    const relocated = new Store();
    for (const quad of resource.dataset) {
      const subject =
        quad.subject.termType === "NamedNode"
          ? DataFactory.namedNode(relocate(quad.subject.value))
          : quad.subject;
      const object =
        quad.object.termType === "NamedNode"
          ? DataFactory.namedNode(relocate(quad.object.value))
          : quad.object;
      const wrapper = new TermWrapper(subject, relocated, DataFactory);
      SetFrom.subjectPredicate(wrapper, quad.predicate.value, TermAs.term, TermFrom.itself).add(
        object,
      );
    }
    const body = await serializeTurtle(relocated);
    if (body === (await serializeTurtle(resource.dataset))) continue;
    if (!resource.etag || resource.etag.startsWith("W/"))
      throw new DriveError("missing-validator", 409, child.url);
    await writeRestoreSnapshot(client, child.url, body, { ifMatch: resource.etag });
  }
}

/** Idempotent create/replace: a lost response is success only for identical durable bytes. */
export async function writeRestoreSnapshot(
  client: DriveClient,
  url: string,
  body: string,
  condition: ({ ifMatch: string } | { ifNoneMatch: "*" }) & Pick<WriteOptions, "restoreFrom">,
): Promise<{ etag?: string }> {
  try {
    return await client.write(
      url,
      body,
      { contentType: "text/turtle", ...condition },
      { kind: "protect-ancestors" },
    );
  } catch (error) {
    if (error instanceof DriveAccessError) throw error;
    let current: Awaited<ReturnType<DriveClient["readVersion"]>>;
    try {
      current = await client.readVersion(url);
    } catch {
      throw error;
    }
    if ((await current.body.text()) !== body) throw error;
    return current.etag ? { etag: current.etag } : {};
  }
}

export async function relocateDocument(
  client: DriveClient,
  original: string,
  target: string,
  data: PodDocument,
  fallbackModified: Date,
): Promise<string> {
  const before = docContainerUrls(original);
  const after = docContainerUrls(target);
  const relocate = (iri: string) => {
    if (iri.startsWith(before.container))
      return `${after.container}${iri.slice(before.container.length)}`;
    if (iri === original || iri.startsWith(`${original}#`))
      return `${target}${iri.slice(original.length)}`;
    return iri;
  };
  const optional = (iri: string | undefined) => (iri === undefined ? undefined : relocate(iri));
  const body = (html: string) => relocateHtml(html, relocate);
  const log = optional(data.updateLog);
  // Never fetch a log selected outside the relocated companion by snapshot metadata.
  if (log?.startsWith(after.container)) await relocateLog(client, log, relocate);
  await relocateComments(client, after.comments, relocate);
  return serializeTurtle(
    buildDocument(target, {
      ...data,
      body: body(data.body),
      updateLog: log,
      assets: optional(data.assets),
      comments: optional(data.comments),
      now: new Date(data.modified ?? fallbackModified),
      priorRevisions: data.revisions.map((rev) => ({
        ...rev,
        body: body(rev.body),
        id: relocate(rev.id),
        wasRevisionOf: optional(rev.wasRevisionOf),
      })),
    }),
  );
}
