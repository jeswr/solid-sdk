// AUTHORED-BY Codex GPT-6.1-Sol
/** Display-fidelity policy from 04-drive §4.1.3; extension logic ported from Pod Manager. */
export const MAX_NAME_LENGTH = 180;

/** First dot after leading dots starts the full chain, including .tar.gz. */
export function extensionChain(name: string): string {
  const stripped = name.replace(/^\.+/, "");
  const dot = stripped.indexOf(".");
  return dot < 0 ? "" : name.slice(name.length - stripped.length + dot);
}

function cleanName(name: string): string {
  const cleaned = Array.from(name, (char) => {
    const code = char.codePointAt(0) as number;
    return /[/\\:#?%*]/u.test(char) || code < 32 || (code >= 127 && code <= 159) ? "-" : char;
  })
    .join("")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new TypeError("That file name can't be used.");
  }
  return cleaned;
}

function fitName(name: string, suffix: string): string {
  const extension = extensionChain(name);
  const base = extension ? name.slice(0, -extension.length) : name;
  const room = MAX_NAME_LENGTH - Array.from(extension + suffix).length;
  if (room < 1) throw new TypeError("The extension leaves no room for a file name.");
  return Array.from(base).slice(0, room).join("") + suffix + extension;
}

export function uploadFileName(name: string): string {
  return fitName(cleanName(name), "");
}

/** Encode exactly one sanitized path segment; never slug or lowercase it. */
export function toSegment(name: string): string {
  return encodeURIComponent(uploadFileName(name));
}

/** Keep-both naming; the caller finds the first free positive integer. */
export function withSuffix(name: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new TypeError("Suffix must be a positive integer.");
  return fitName(cleanName(name), ` (${n})`);
}

/** Decoded last path segment, including slash-terminated folders. */
export function displayName(url: string): string {
  const parsed = new URL(url);
  const segment = parsed.pathname.replace(/\/+$/, "").split("/").pop() || parsed.hostname;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** LWS requested names are carried by metadata title, surfaced as Entry.displayName. */
export function displayNameOf(entry: { url: string; displayName?: string | null }): string {
  return entry.displayName ?? displayName(entry.url);
}

// Ported from apps/pod-manager/src/lib/files.ts, including RDF formats.
const MIME = new Map<string, string>([
  ["ttl", "text/turtle"],
  ["jsonld", "application/ld+json"],
  ["nt", "application/n-triples"],
  ["nq", "application/n-quads"],
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["csv", "text/csv"],
  ["json", "application/json"],
  ["html", "text/html"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["svg", "image/svg+xml"],
  ["webp", "image/webp"],
  ["pdf", "application/pdf"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
]);

export function guessContentType(name: string): string | undefined {
  const extension = extensionChain(name).split(".").pop() as string;
  return MIME.get(extension.toLowerCase());
}
