// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  copyTemplateImages,
  type SaveTemplateInput,
  type TemplateApp,
  type TemplateBody,
  templatePreview,
} from "@jeswr/suite-templates";
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { baseExtensions } from "../../apps/docs/editor/extensions";
import { buildDocument, parseDocument } from "../../apps/docs/lib/model/document";
import { serializeTurtle } from "../../apps/docs/lib/model/rdf-io";
import { notesExtensions } from "../../apps/notes/editor/extensions";
import { buildNote, parseNote } from "../../apps/notes/lib/model/note";
import type { PodSession } from "../session/pod-session";
import { templatesForSession } from "./store";

/** App-format adapter; image copying and URL relocation are shared SDK operations. */
export async function prepareTemplateContent(
  session: PodSession,
  app: TemplateApp,
  resource: string,
  content: TemplateBody,
  assets: Parameters<SaveTemplateInput["content"]>[1],
): Promise<TemplateBody> {
  if (app === "sheets") {
    const { deserializeSnapshot } = await import("../../apps/sheets/lib/model/snapshot");
    const cells: string[] = [];
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (typeof object.v === "string" || typeof object.v === "number")
        cells.push(String(object.v));
      else Object.values(object).forEach(visit);
    }
    visit(deserializeSnapshot(content.body).sheets);
    return { ...content, previewText: templatePreview(cells.join(" ")) };
  }
  if (app !== "docs" && app !== "notes") return content;
  const dataset = await parseRdf(content.body, content.contentType, { baseIRI: resource });
  const document =
    app === "docs" ? parseDocument(resource, dataset) : parseNote(resource, dataset, "active");
  if (!document) throw new Error("Invalid template content");
  const extensions =
    app === "docs" ? baseExtensions(session.fetch) : notesExtensions(session.fetch);
  const json = await assets.copyImages(generateJSON(document.body, baseExtensions(session.fetch)));
  const node = getSchema(extensions).nodeFromJSON(json);
  const body = generateHTML(json, extensions);
  return {
    body: await serializeTurtle(
      app === "docs"
        ? buildDocument(resource, { ...document, body })
        : buildNote(resource, { ...document, body }),
    ),
    contentType: "text/turtle",
    previewText: templatePreview(node.textBetween(0, node.content.size, " ")),
  };
}
export async function importTemplateImages(
  session: PodSession,
  json: JSONContent,
  upload: (data: ArrayBuffer, contentType: string) => Promise<string>,
): Promise<JSONContent> {
  const store = await templatesForSession(session);
  return copyTemplateImages(json, {
    root: session.storageUrl,
    upload,
    read: async (url) => {
      await store.assertContains(url);
      const response = await session.fetch(url, { redirect: "error" });
      if (!response.ok) throw new Error("Couldn't read a template image");
      return {
        data: await response.arrayBuffer(),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    },
  });
}
