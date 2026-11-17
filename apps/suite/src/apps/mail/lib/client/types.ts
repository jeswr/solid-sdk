// AUTHORED-BY Codex GPT-6.1-Sol
import type { QuotedText } from "../quotes";
export interface FolderView {
  iri: string;
  key: string;
  title: string;
  system: boolean;
  total: number;
  unread: number;
}
export interface ThreadRow {
  iri: string;
  subject: string;
  participants: string[];
  snippet: string;
  latest: Date;
  count: number;
  unread: boolean;
  starred: boolean;
  hasAttachment: boolean;
}
export interface ThreadPage {
  items: ThreadRow[];
  total: number;
  next: number | null;
}
export interface AttachmentView {
  name: string;
  contentType: string;
  size: number;
  url: string;
}
export interface MessageView {
  iri: string;
  from: string;
  to: string[];
  cc: string[];
  date: Date;
  subject: string;
  text: string;
  html?: string;
  quoted: QuotedText;
  truncated?: boolean;
  originalUrl?: string;
  read: boolean;
  starred: boolean;
  /** Filed under Drafts: editable and discardable, never sent from here. */
  draft: boolean;
  /** An app-created draft filed in Sent by demo Send; imported Sent mail is excluded. */
  demoSent: boolean;
  labels: string[];
  attachments: AttachmentView[];
}
export interface ThreadView {
  iri: string;
  subject: string;
  messages: MessageView[];
}
export interface BatchResult {
  done: string[];
  failed: { iri: string; error: unknown }[];
}
export interface ImportProgress {
  messages: number;
  attachments: number;
  bytes: number;
  failed: number;
}
export interface ImportResult extends ImportProgress {
  failures: { iri: string; error: unknown }[];
  aborted: boolean;
  typeIndex: "registered" | "missing" | "failed";
  typeIndexError?: unknown;
}
export interface ImportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
  mintId?: () => string;
}
