// AUTHORED-BY Codex
import type { JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import type { PodSession } from "@/lib/session/pod-session";
import { type ExportImage, toDocx } from "../lib/convert/docx-export";
import { exportMarkdown } from "../lib/convert/markdown";
import { normaliseImageDestination } from "../lib/editor/destination";
import { imagePng } from "./image-blob";
import { loadDocumentContent } from "./persistence";
import { podScopedFetch } from "./private-image";

export type DownloadFormat = "docx" | "md";
export async function readExportImage(session: PodSession, src: string): Promise<ExportImage> {
  const url = normaliseImageDestination(src);
  if (!url) throw new Error("Invalid image URL");
  const response = await podScopedFetch(session.fetch, session.storageUrl)(url, {
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
) {
  const name = `${title || "Untitled document"}.${format}`;
  const blob =
    format === "md"
      ? new Blob([exportMarkdown(json)], { type: "text/markdown;charset=utf-8" })
      : await Packer.toBlob(await toDocx(json, (src) => readExportImage(session, src)));
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
