// AUTHORED-BY Codex GPT-6.1-Sol
import { FileError, validString } from "./errors";

export interface BreadcrumbSegment {
  label: string;
  /** Absolute container URL, retaining its encoded path and trailing slash. */
  url: string;
}

function decodeSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new FileError("invalid-iri");
  }
  if (!decoded || decoded === "." || decoded === ".." || /[/\\\p{Cc}]/u.test(decoded)) {
    throw new FileError("invalid-iri");
  }
  return decoded;
}

function containerIri(input: string): URL {
  validString(input, "invalid-iri");
  // Validate the raw path BEFORE URL can erase traversal or reinterpret backslashes.
  const match = /^https?:\/\/[^/?#@%]+(\/[^?#]*)$/u.exec(input);
  if (!match || /[\s\\\p{Cc}]/u.test(input) || !input.endsWith("/")) {
    throw new FileError("invalid-iri");
  }
  const path = match[1] as string;
  for (const segment of path.slice(1, -1).split("/")) {
    if (path !== "/") decodeSegment(segment);
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FileError("invalid-iri");
  }
  return url;
}

/** Relative segments only. Root itself returns []; ancestors and siblings throw. */
export function breadcrumbs(current: string, root: string): BreadcrumbSegment[] {
  const storage = containerIri(root);
  const container = containerIri(current);
  if (storage.origin !== container.origin || !container.pathname.startsWith(storage.pathname)) {
    throw new FileError("outside-root");
  }
  const relative = container.pathname.slice(storage.pathname.length);
  if (!relative) return [];
  let url = storage.href;
  return relative
    .slice(0, -1)
    .split("/")
    .map((segment) => {
      url += `${segment}/`;
      return { label: decodeSegment(segment), url };
    });
}
