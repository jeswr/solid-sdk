// AUTHORED-BY Codex GPT-6.1
/**
 * Drive's "Open with Docs" rules (Google Drive parity): a Docs document opens in
 * the editor; a file Docs can import is converted into a NEW document and the
 * original stays untouched. Pure decisions plus the Docs-folder access probe.
 */

import { encodeRef } from "../../../../lib/refs";
import { isImportableName, MAX_IMPORT_BYTES } from "../../../docs/lib/convert/import-file";
import { DOCX_FORMATTING_WARNING, type SkippedItem } from "../../../docs/lib/convert/skipped";
import { DOCS_SLUG, isDirectChild, LEGACY_DOCS_SLUG } from "../../../docs/lib/model/layout";

export const FOREIGN_FILE_REASON = "Only files in your pod can be opened with Docs";
export const TOO_LARGE_REASON = "Docs can open files of 50 MB or less";
export const DOCS_READ_ONLY_REASON = "You can't create documents in your Docs folder";

interface Target {
  readonly url: string;
  readonly kind: "file" | "folder";
}

/**
 * A document the Docs editor can open: a direct `.ttl` child of the account's
 * Docs container (or the legacy Pod Docs one), mirroring the Docs store's scope.
 */
export function isDocsDocument(item: Target, storageUrl: string): boolean {
  if (item.kind !== "file" || !item.url.endsWith(".ttl")) return false;
  return [DOCS_SLUG, LEGACY_DOCS_SLUG].some((slug) =>
    isDirectChild(item.url, new URL(slug, storageUrl).href),
  );
}

export function docsHref(url: string): string {
  return `/docs/d/${encodeRef(url)}`;
}

export type OpenWithDocsState =
  | { readonly kind: "open"; readonly href: string }
  | { readonly kind: "convert"; readonly disabledReason?: string };

export interface OpenWithDocsContext {
  readonly storageUrl: string;
  /** Set while the app has no connection; conversions read and write the pod. */
  readonly offlineReason?: string | undefined;
  /** `undefined` while unknown: only a confirmed lack of access disables. */
  readonly docsWritable?: boolean | undefined;
}

/** What "Open with Docs" does for an item, or `undefined` when Docs can't open it. */
export function openWithDocsState(
  item: Target & { readonly name: string; readonly size?: number | undefined },
  context: OpenWithDocsContext,
): OpenWithDocsState | undefined {
  if (isDocsDocument(item, context.storageUrl)) return { kind: "open", href: docsHref(item.url) };
  if (item.kind !== "file" || !isImportableName(item.name)) return undefined;
  // Docs' importer reads only from the account's own storage origin.
  if (new URL(item.url).origin !== new URL(context.storageUrl).origin)
    return { kind: "convert", disabledReason: FOREIGN_FILE_REASON };
  if ((item.size ?? 0) > MAX_IMPORT_BYTES)
    return { kind: "convert", disabledReason: TOO_LARGE_REASON };
  if (context.offlineReason) return { kind: "convert", disabledReason: context.offlineReason };
  if (context.docsWritable === false)
    return { kind: "convert", disabledReason: DOCS_READ_ONLY_REASON };
  return { kind: "convert" };
}

/** The user's write mode from a `WAC-Allow` header; `undefined` when it doesn't say. */
export function canWriteFromWacAllow(header: string | null): boolean | undefined {
  const user = /(?:^|,)\s*user\s*=\s*"([^"]*)"/i.exec(header ?? "");
  return user ? /\bwrite\b/i.test(user[1] as string) : undefined;
}

/**
 * Whether new documents can be created in the Docs container (the storage root
 * before Docs first creates it). Refusals mean no; anything unclear is unknown.
 */
export async function probeDocsWritable(session: {
  readonly storageUrl: string;
  readonly fetch: typeof globalThis.fetch;
}): Promise<boolean | undefined> {
  const head = (url: string) =>
    session.fetch(url, {
      method: "HEAD",
      redirect: "error",
      headers: { "cache-control": "no-cache" },
    });
  try {
    let response = await head(new URL(DOCS_SLUG, session.storageUrl).href);
    if (response.status === 404) response = await head(session.storageUrl);
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) return undefined;
    return canWriteFromWacAllow(response.headers.get("wac-allow"));
  } catch {
    return undefined;
  }
}

/** A one-line account of what an import left out, as Docs' Upload dialog lists it. */
export function skippedSummary(skipped: readonly SkippedItem[]): string {
  const counted = skipped
    .filter((item) => item.label !== DOCX_FORMATTING_WARNING)
    .map((item) => `${item.label} (${item.count})`);
  const parts = counted.length ? [`${counted.join(", ")}.`] : [];
  if (skipped.some((item) => item.label === DOCX_FORMATTING_WARNING))
    parts.push(DOCX_FORMATTING_WARNING);
  return parts.join(" ");
}
