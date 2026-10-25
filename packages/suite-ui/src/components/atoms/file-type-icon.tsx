/** biome-ignore-all lint/performance/noImgElement: Package supports local and blob assets without a Next image loader. */
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Archive,
  Database,
  File,
  FileText,
  FileType as FileTypeGlyph,
  Film,
  Folder,
  Image,
  Music2,
  Table2,
} from "lucide-react";
import { type CSSProperties, useState } from "react";
import { cn } from "../../lib/utils.js";

export const FILE_TYPES = {
  folder: { label: "Folder", glyph: "folder", icon: Folder, app: null, badge: null },
  image: { label: "Image", glyph: "image", icon: Image, app: "photos", badge: null },
  pdf: { label: "PDF", glyph: "file-text", icon: FileText, app: "mail", badge: "PDF" },
  document: { label: "Document", glyph: "file-text", icon: FileText, app: "docs", badge: null },
  spreadsheet: {
    label: "Spreadsheet",
    glyph: "table-2",
    icon: Table2,
    app: "sheets",
    badge: "XLS",
  },
  csv: { label: "CSV", glyph: "table-2", icon: Table2, app: "sheets", badge: "CSV" },
  audio: { label: "Audio", glyph: "music-2", icon: Music2, app: "music", badge: null },
  video: { label: "Video", glyph: "film", icon: Film, app: "photos", badge: null },
  archive: { label: "Archive", glyph: "archive", icon: Archive, app: null, badge: null },
  text: { label: "Text", glyph: "file-type", icon: FileTypeGlyph, app: null, badge: null },
  data: { label: "Data", glyph: "database", icon: Database, app: "home", badge: "DATA" },
  unknown: { label: "File", glyph: "file", icon: File, app: null, badge: null },
} as const;
export type FileType = keyof typeof FILE_TYPES;
const MIME_TYPES: Record<string, FileType> = {
  folder: "folder",
  "inode/directory": "folder",
  "application/x-directory": "folder",
  "application/pdf": "pdf",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.oasis.opendocument.text": "document",
  "pd:document": "document",
  "https://jeswr.org/ns/pod-docs#document": "document",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "application/vnd.oasis.opendocument.spreadsheet": "spreadsheet",
  "text/csv": "csv",
  "application/csv": "csv",
  "application/zip": "archive",
  "application/x-zip-compressed": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
  "application/x-7z-compressed": "archive",
  "application/vnd.rar": "archive",
  "application/x-rar-compressed": "archive",
  "text/turtle": "data",
  "application/x-turtle": "data",
  "application/ld+json": "data",
  "application/rdf+xml": "data",
  "application/n-triples": "data",
  "application/n-quads": "data",
  "application/trig": "data",
  "application/trix": "data",
};
const EXTENSIONS: Record<string, FileType> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  svg: "image",
  webp: "image",
  avif: "image",
  heic: "image",
  pdf: "pdf",
  doc: "document",
  docx: "document",
  odt: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  csv: "csv",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  m4a: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  "7z": "archive",
  rar: "archive",
  txt: "text",
  md: "text",
  markdown: "text",
  ttl: "data",
  jsonld: "data",
  rdf: "data",
  nt: "data",
  nq: "data",
  trig: "data",
};
/** Explicit content type wins; filename is a fallback for absent/generic metadata. */
export function getFileType(contentType?: string, name?: string): FileType {
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime && mime !== "application/octet-stream") {
    if (MIME_TYPES[mime]) return MIME_TYPES[mime];
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("text/")) return "text";
    return "unknown";
  }
  return EXTENSIONS[name?.split(".").pop()?.toLowerCase() ?? ""] ?? "unknown";
}
export type FileTypeIconProps = {
  contentType?: string;
  name?: string;
  size?: 16 | 20 | 24 | 32 | 40 | 48;
  thumbnailSrc?: string;
  decorative?: boolean;
  className?: string;
};
export function FileTypeIcon({
  contentType,
  name,
  size = 20,
  thumbnailSrc,
  decorative = false,
  className,
}: FileTypeIconProps) {
  const type = getFileType(contentType, name);
  const { icon: Glyph, app, badge, label, glyph } = FILE_TYPES[type];
  const [failedSrc, setFailedSrc] = useState<string>();
  return (
    <span
      className={cn("suite-file-icon", className)}
      data-type={type}
      data-glyph={glyph}
      role="img"
      aria-label={decorative ? undefined : name ? `${name} (${label})` : label}
      aria-hidden={decorative || undefined}
      style={
        {
          width: size,
          height: size,
          "--file-accent": app ? `var(--app-${app})` : "var(--foreground-muted)",
          "--file-soft": app ? `var(--app-${app}-soft)` : "var(--surface-2)",
        } as CSSProperties
      }
    >
      {type === "image" && thumbnailSrc && failedSrc !== thumbnailSrc ? (
        <img
          src={thumbnailSrc}
          alt=""
          width={size}
          height={size}
          onError={() => setFailedSrc(thumbnailSrc)}
        />
      ) : (
        <>
          <Glyph size={size} strokeWidth={size >= 24 ? 1.5 : 1.75} aria-hidden="true" />
          {badge && (
            <span className="suite-file-badge" aria-hidden="true">
              {badge}
            </span>
          )}
        </>
      )}
    </span>
  );
}
