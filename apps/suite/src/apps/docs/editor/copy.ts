// AUTHORED-BY Codex

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { SolidPersistence } from "@jeswr/y-solid";
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import type { PodSession } from "@/lib/session/pod-session";
import { trashIndexFrom } from "../../drive/lib/operations/trash-index";
import { wordCount } from "../lib/editor/logic";
import {
  type CopyState,
  type DocsStore,
  docContainerUrls,
  isDirectChild,
  parseDocument,
  readRdf,
  type StoredDocument,
} from "../lib/model";
import { DocumentReplacedError, sameIncarnation } from "../lib/model/incarnation";
import { baseExtensions } from "./extensions";
import { DocumentUpdateStore } from "./update-store";

/** Resolve only a reciprocal trash pair belonging to the retired incarnation. */
async function trashedAssets(
  stored: StoredDocument,
  session: PodSession,
): Promise<string | undefined> {
  const http = createPodScopedFetch(session.storageUrl, { fetch: session.fetch });
  const trash = new URL("drive/.trash/", session.storageUrl).href;
  const inSlot = (url: string) => {
    const folder = new URL(".", url).href;
    const slot = url.endsWith("/") ? new URL("..", url).href : folder;
    return (
      isDirectChild(slot.slice(0, -1), trash) &&
      isDirectChild(url.endsWith("/") ? url.slice(0, -1) : url, slot)
    );
  };
  try {
    const { dataset } = await readRdf(`${trash}index.ttl`, http);
    const index = trashIndexFrom(dataset);
    for (const record of index.records) {
      if (record.originalLocation !== stored.url || !inSlot(record.value)) continue;
      const pair = record.pairedWith;
      if (!pair || !inSlot(pair)) continue;
      const companion = index.record(pair);
      if (
        companion.originalLocation !== docContainerUrls(stored.url).container ||
        companion.pairedWith !== record.value ||
        !pair.endsWith("/")
      )
        continue;
      const snapshot = parseDocument(stored.url, (await readRdf(record.value, http)).dataset);
      if (snapshot?.instanceId && snapshot.instanceId === stored.data.instanceId)
        return `${pair}assets/`;
    }
  } catch (error) {
    if (!(error instanceof RdfFetchError && [403, 404, 410].includes(error.status ?? 0)))
      throw error;
  }
  return undefined;
}

export async function copyDocument(
  store: DocsStore,
  stored: StoredDocument,
  session: PodSession,
  live?: JSONContent,
  options: Pick<CopyState, "reservation" | "onReserved"> & { recovery?: boolean } = {},
) {
  const extensions = baseExtensions(session.fetch);
  const captured = structuredClone(live ?? generateJSON(stored.data.body, extensions));
  const assets: string[] = [];
  function visit(node: JSONContent, mapping?: ReadonlyMap<string, string>) {
    if (node.type === "image" && node.attrs?.src) {
      const source = String(node.attrs.src);
      if (mapping?.get(source) === "") {
        const alt = String(node.attrs.alt ?? "");
        node.type = "paragraph";
        delete node.attrs;
        node.content = [{ type: "text", text: `[Image unavailable${alt ? `: ${alt}` : ""}]` }];
      } else if (mapping) node.attrs.src = mapping.get(source) ?? source;
      else if (isDirectChild(source, docContainerUrls(stored.url).assets)) assets.push(source);
    }
    node.content?.forEach((child) => {
      visit(child, mapping);
    });
  }
  visit(captured);
  const remap = (mapping: ReadonlyMap<string, string>) => {
    const json = structuredClone(captured);
    visit(json, mapping);
    return json;
  };
  let trash: Promise<string | undefined> | undefined;
  const recoveryFetch = createPodScopedFetch(session.storageUrl, { fetch: session.fetch });
  return store.makeCopy(stored, {
    ...options,
    assets,
    ...(options.recovery
      ? {
          allowMissingAssets: true,
          readAsset: async (asset: string) => {
            // Prefer this incarnation's recorded assets even if its old URLs now
            // return a replacement document's images with the same filenames.
            trash ??= trashedAssets(stored, session);
            const folder = await trash;
            if (folder)
              return recoveryFetch(`${folder}${new URL(asset).pathname.split("/").at(-1)}`);
            // Once trash is gone, a new occupant's identically named asset is
            // not a substitute for the retired document's uploaded image.
            try {
              const active = await store.read(stored.url);
              if (!active || !sameIncarnation(stored, active))
                return new Response(null, { status: 404 });
            } catch (error) {
              if (error instanceof RdfFetchError && [404, 410].includes(error.status ?? 0))
                return new Response(null, { status: 404 });
              throw error;
            }
            return recoveryFetch(asset);
          },
        }
      : {}),
    snapshot: (mapping) => {
      const json = remap(mapping);
      return {
        body: generateHTML(json, extensions),
        format: "text/html",
        wordCount: wordCount(json).words,
      };
    },
    persistFullState: async (container, fetchImpl, mapping, instanceId) => {
      const doc = new Doc();
      const url = `${container.slice(0, -"/updates/".length)}.ttl`;
      const provider = new SolidPersistence({
        doc,
        store: new DocumentUpdateStore(
          container,
          fetchImpl,
          async () => {
            const remote = await store.read(url);
            if (
              !remote ||
              !sameIncarnation({ url, data: { instanceId } }, remote) ||
              remote.data.updateLog !== container
            )
              throw new DocumentReplacedError();
          },
          true,
          instanceId,
        ),
      });
      try {
        await provider.whenSynced;
        if (instanceId) doc.getMap("document").set("instanceId", instanceId);
        // Retrying a reservation must reuse its identities, including after an
        // append succeeded but its acknowledgement or final snapshot failed.
        const content = remap(mapping);
        const fragment = doc.getXmlFragment("prosemirror");
        if (
          !fragment.length ||
          (options.recovery &&
            JSON.stringify(yDocToProsemirrorJSON(doc)) !== JSON.stringify(content))
        ) {
          fragment.delete(0, fragment.length);
          const seed = prosemirrorJSONToYDoc(getSchema(extensions), content, "prosemirror");
          applyUpdate(doc, encodeStateAsUpdate(seed));
          seed.destroy();
        }
        await provider.persistFullState();
      } finally {
        provider.destroy();
        doc.destroy();
      }
    },
  });
}
