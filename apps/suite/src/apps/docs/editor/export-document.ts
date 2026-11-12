// AUTHORED-BY Codex
// AUTHORED-BY Claude Opus 5.5
import { generateHTML, type JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import type { PodSession } from "@/lib/session/pod-session";
import { type ExportImage, toDocx } from "../lib/convert/docx-export";
import { exportMarkdown } from "../lib/convert/markdown";
import { htmlDocument } from "../lib/convert/schema";
import { normaliseImageDestination } from "../lib/editor/destination";
import { documentScopedFetch } from "./document-fetch";
import { baseExtensions } from "./extensions";
import { imagePng } from "./image-blob";
import { loadDocumentContent } from "./persistence";

export type DownloadFormat = "docx" | "md" | "html";
/** `resource` is the exported document: images in its own container are read with credentials. */
export async function readExportImage(
  session: PodSession,
  src: string,
  resource?: string,
): Promise<ExportImage> {
  const url = normaliseImageDestination(src);
  if (!url) throw new Error("Invalid image URL");
  const response = await documentScopedFetch(session, () => resource)(url, {
    redirect: "error",
  });
  if (!response.ok) throw new Error("Image unavailable");
  const png = await imagePng(await response.blob());
  return {
    data: new Uint8Array(await png.blob.arrayBuffer()),
    type: "png",
    width: png.width,
    height: png.height,
  };
}
export async function downloadDocument(
  json: JSONContent,
  title: string,
  format: DownloadFormat,
  session: PodSession,
  resource?: string,
) {
  const name = `${title || "Untitled document"}.${format}`;
  const blob =
    format === "md"
      ? new Blob([exportMarkdown(json)], { type: "text/markdown;charset=utf-8" })
      : format === "html"
        ? new Blob([htmlDocument(generateHTML(json, baseExtensions(globalThis.fetch)), title)], {
            type: "text/html;charset=utf-8",
          })
        : await Packer.toBlob(await toDocx(json, (src) => readExportImage(session, src, resource)));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/** Use the editor's incarnation validation before reading cached or pending content. */
export async function rowExportJson(resource: string, session: PodSession): Promise<JSONContent> {
  return loadDocumentContent(resource, session);
}
