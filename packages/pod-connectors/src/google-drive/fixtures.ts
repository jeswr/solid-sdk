// AUTHORED-BY Codex GPT-6.1-Sol
/** Drive API v3 shapes and synthetic fixtures; no real account data. */
import type { FixtureRoute } from "../core/types.js";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const GOOGLE_APPS = "application/vnd.google-apps.";
export interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  createdTime?: string;
  ownedByMe?: boolean;
  webViewLink?: string;
  trashed?: boolean;
}
export interface DriveFileList {
  files?: DriveFile[];
  nextPageToken?: string;
}
export interface DriveStartPageToken {
  startPageToken: string;
}
export interface DriveChange {
  fileId: string;
  removed?: boolean;
  file?: DriveFile;
}
export interface DriveChangeList {
  changes?: DriveChange[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

export const FILES: DriveFile[] = [
  { id: "folder-1", name: "Example folder", mimeType: `${GOOGLE_APPS}folder` },
  {
    id: "binary-1",
    name: "Example photo",
    mimeType: "image/png",
    parents: ["folder-1"],
    size: "4",
    md5Checksum: "08d6c05a21512a79a1dfeb9d2a8f262f",
    ownedByMe: true,
    createdTime: "2026-06-11T09:00:00Z",
    modifiedTime: "2026-06-12T09:00:00Z",
    webViewLink: "https://drive.google.com/file/d/binary-1/view",
  },
  {
    id: "doc-1",
    name: "Example document",
    mimeType: `${GOOGLE_APPS}document`,
    ownedByMe: true,
    modifiedTime: "2026-06-12T10:00:00Z",
  },
];

/** JSON-only demos show metadata. Binary fixture transports are supplied by tests. */
export const DRIVE_FIXTURES: readonly FixtureRoute[] = [
  { url: `${DRIVE_API}/changes/startPageToken`, json: { startPageToken: "1000" } },
  {
    url: `${DRIVE_API}/files`,
    json: { files: FILES.map((file) => ({ ...file, ownedByMe: false })) },
  },
  { url: `${DRIVE_API}/changes`, json: { newStartPageToken: "1001" } },
];
