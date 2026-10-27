// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import type { PodSession } from "@/lib/session/pod-session";
import { wordCount } from "../lib/editor/logic";
import {
  type CopyState,
  type DocsStore,
  docContainerUrls,
  isDirectChild,
  type StoredDocument,
} from "../lib/model";
import { DocumentReplacedError, sameIncarnation } from "../lib/model/incarnation";
import { baseExtensions } from "./extensions";
import { DocumentUpdateStore } from "./update-store";
export async function copyDocument(
  store: DocsStore,
  stored: StoredDocument,
  session: PodSession,
  live?: JSONContent,
  options: Pick<CopyState, "reservation" | "onReserved"> = {},
) {
  const extensions = baseExtensions(session.fetch);
  const captured = structuredClone(live ?? generateJSON(stored.data.body, extensions));
  const assets: string[] = [];
  function visit(node: JSONContent, mapping?: ReadonlyMap<string, string>) {
    if (node.type === "image" && node.attrs?.src) {
      const source = String(node.attrs.src);
      if (mapping) node.attrs.src = mapping.get(source) ?? source;
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
  return store.makeCopy(stored, {
    ...options,
    assets,
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
        if (!doc.getXmlFragment("prosemirror").length) {
          const seed = prosemirrorJSONToYDoc(getSchema(extensions), remap(mapping), "prosemirror");
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
