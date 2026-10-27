// AUTHORED-BY Codex
import type { JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { Packer } from "docx";
import type { PodSession } from "@/lib/session/pod-session";
import { type ExportImage, toDocx } from "../lib/convert/docx-export";
import { exportMarkdown } from "../lib/convert/markdown";
import { validLink } from "../lib/editor/logic";
import { DocumentPersistence } from "./persistence";
import { podScopedFetch } from "./private-image";

export type DownloadFormat = "docx" | "md";
export async function readExportImage(session: PodSession, src: string): Promise<ExportImage> {
  if (!validLink(src) || !/^https?:/.test(src)) throw new Error("Invalid image URL");
  const response = await podScopedFetch(session.fetch, session.storageUrl)(src, {
    redirect: "error",
  });
  if (!response.ok) throw new Error("Image unavailable");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Image unavailable");
  const bitmap = await createImageBitmap(blob);
  try {
    // Decode in the browser and normalize formats (including WebP/SVG) to DOCX-safe PNG.
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image unavailable");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Image unavailable"))),
        "image/png",
      ),
    );
    return {
      data: new Uint8Array(await png.arrayBuffer()),
      type: "png",
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
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
  const runtime = new DocumentPersistence(session);
  try {
    await runtime.open(resource);
    return yDocToProsemirrorJSON(runtime.doc, "prosemirror") as JSONContent;
  } finally {
    // No editor captured a render here. Retain pending edits for its writer;
    // teardown must not save the old snapshot or acknowledge those edits.
    runtime.online = false;
    await runtime.destroy();
  }
}
