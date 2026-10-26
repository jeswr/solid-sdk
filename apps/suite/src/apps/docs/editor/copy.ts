// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import type { PodSession } from "@/lib/session/pod-session";
import { wordCount } from "../lib/editor/logic";
import { type DocsStore, docContainerUrls, isDirectChild, type StoredDocument } from "../lib/model";
import { baseExtensions } from "./extensions";
export async function copyDocument(
  store: DocsStore,
  stored: StoredDocument,
  session: PodSession,
  live?: JSONContent,
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
    assets,
    snapshot: (mapping) => {
      const json = remap(mapping);
      return {
        body: generateHTML(json, extensions),
        format: "text/html",
        wordCount: wordCount(json).words,
      };
    },
    persistFullState: async (container, fetchImpl, mapping) => {
      const doc = prosemirrorJSONToYDoc(getSchema(extensions), remap(mapping), "prosemirror");
      const provider = new SolidPersistence({ doc, container, fetch: fetchImpl });
      try {
        await provider.whenSynced;
        await provider.persistFullState();
      } finally {
        provider.destroy();
        doc.destroy();
      }
    },
  });
}
