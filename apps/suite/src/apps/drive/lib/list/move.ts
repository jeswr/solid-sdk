// AUTHORED-BY Codex GPT-6.1-Sol
import { isRecord, isText, ListError, requireValid } from "./validation";

export interface MoveEntry {
  readonly url: string;
  readonly kind: "container" | "resource";
}
export type MoveValidity =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: "not-folder" | "self" | "descendant" };

interface Address {
  origin: string;
  segments: string[];
}

/** Only unambiguous hierarchical HTTP(S) resource identifiers are supported. */
function address(entry: MoveEntry): Address {
  requireValid(isRecord(entry), "invalid-move");
  requireValid(entry.kind === "container" || entry.kind === "resource", "invalid-move");
  requireValid(isText(entry.url), "unsupported-url");
  const raw = entry.url;
  requireValid(/^https?:\/\/[^/]+\//i.test(raw) && !/[\s\\?#]/u.test(raw), "unsupported-url");
  let url: URL;
  let segments: string[];
  try {
    url = new URL(raw);
    // Decode the raw path first so URL's dot-segment normalization cannot hide input.
    const path = raw.slice(raw.indexOf("/", raw.indexOf("://") + 3));
    requireValid(raw.indexOf("/", raw.indexOf("://") + 3) !== -1, "unsupported-url");
    requireValid(!/%(?:2f|5c|25)/i.test(path), "unsupported-url");
    const decoded = decodeURIComponent(path);
    segments = decoded.slice(1).split("/");
    if (segments.at(-1) === "") segments.pop();
    requireValid(
      segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."),
      "unsupported-url",
    );
    requireValid(
      [...decoded].every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
      "unsupported-url",
    );
  } catch {
    throw new ListError("unsupported-url");
  }
  requireValid(url.username === "" && url.password === "", "unsupported-url");
  requireValid((entry.kind === "container") === raw.endsWith("/"), "unsupported-url");
  return { origin: url.origin, segments };
}

/** A topology check only: permissions, conflicts and actual writes belong to the caller. */
export function getMoveValidity(sources: readonly MoveEntry[], target: MoveEntry): MoveValidity {
  requireValid(Array.isArray(sources) && sources.length > 0, "invalid-move");
  const destination = address(target);
  const addresses = Array.from(sources, (source) => address(source));
  const seen = new Set<string>();
  for (const source of addresses) {
    const key = JSON.stringify(source);
    requireValid(!seen.has(key), "invalid-move");
    seen.add(key);
  }
  if (target.kind !== "container") return { valid: false, reason: "not-folder" };
  for (const [index, source] of addresses.entries()) {
    if (source.origin !== destination.origin) continue;
    if (!source.segments.every((segment, i) => segment === destination.segments[i])) continue;
    if (
      (sources[index] as MoveEntry).kind === "container" &&
      source.segments.length === destination.segments.length
    ) {
      return { valid: false, reason: "self" };
    }
    if ((sources[index] as MoveEntry).kind === "container") {
      return { valid: false, reason: "descendant" };
    }
  }
  return { valid: true };
}
