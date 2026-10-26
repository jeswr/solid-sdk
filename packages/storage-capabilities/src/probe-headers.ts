// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseLinkHeaders } from "./link.js";
import type { ProbeResult, WacMode } from "./types.js";
import { ACP } from "./vocab.js";

/**
 * Parse a WAC-Allow field (WAC §6.1) into user/public modes, ignoring extensions; undefined when
 * the syntax is malformed. Exported for `@jeswr/storage-client` (ReadResult.allow).
 */
export function parseWacAllow(value: string): ProbeResult["wacAllow"] {
  const permissions: { user: WacMode[]; public: WacMode[] } = { user: [], public: [] };
  const scope = /[ \t]*([A-Za-z]+)[ \t]*=[ \t]*"([^"\r\n]*)"[ \t]*(?:,|$)/y;
  let cursor = 0;
  let parsed = false;
  while (cursor < value.length) {
    const character = value.charAt(cursor);
    if (character === "," || character === " " || character === "\t") {
      cursor++;
      continue;
    }
    scope.lastIndex = cursor;
    const match = scope.exec(value);
    if (!match) return undefined;
    cursor = scope.lastIndex;
    parsed = true;
    const name = match[1] as string;
    const modes = (match[2] as string).split(/[ \t]+/).filter(Boolean);
    // Unknown modes are tokens too; broken quoting, separators and control bytes are syntax errors.
    if (modes.some((mode) => !/^[!#$%&'*+\-.^_`|~\da-z]+$/i.test(mode))) return undefined;
    if (name === "user" || name === "public") {
      const known = modes
        .map((mode) => mode.toLowerCase())
        .filter((mode): mode is WacMode => ["read", "write", "append", "control"].includes(mode));
      permissions[name] = [...new Set([...permissions[name], ...known])];
    }
  }
  return parsed ? permissions : undefined;
}

/** Parse media types while discarding parameters, including commas inside quoted parameters. */
function mediaTypes(value: string): string[] {
  const types: string[] = [];
  let start = 0;
  let typeEnd = value.length;
  let quoted = false;
  for (let cursor = 0; cursor <= value.length; cursor++) {
    const character = value.charAt(cursor);
    if (quoted) {
      if (character === "\\") cursor++;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
    } else if (character === ";") {
      typeEnd = Math.min(typeEnd, cursor);
    } else if (character === "," || cursor === value.length) {
      const type = value.slice(start, Math.min(typeEnd, cursor)).trim().toLowerCase();
      if (type) types.push(type);
      start = cursor + 1;
      typeEnd = value.length;
    }
  }
  return types;
}

/** Bound the combined field before joining or parsing, including inserted comma separators. */
function combinedField(values: string[] | undefined): string | undefined {
  if (!values) return undefined;
  let bytes = values.length - 1;
  for (const value of values) {
    // Reject huge strings before allocating their UTF-8 encoding.
    if (value.length > 8192) return undefined;
    bytes += new TextEncoder().encode(value).byteLength;
    if (bytes > 8192) return undefined;
  }
  return values.join(",");
}

/**
 * Pure parsing of one response's capability headers; no OPTIONS/HEAD request is made here.
 * Pass raw header pairs to preserve response order and repeated fields. A Headers instance
 * supplies its own iteration order (typically sorted, with repeated fields already combined).
 * Recognised raw fields, including malformed WAC-Allow, are retained as evidence. Links whose
 * anchor changes the probed resource's context do not describe its access control.
 * Combined Accept-Patch, Accept-Post and Allow fields over 8 KiB (UTF-8) are treated as absent.
 * An unterminated media parameter quote discards that member and the remainder of its field.
 */
export function parseProbeHeaders(
  url: string,
  headers: Iterable<readonly [string, string]>,
  observedAt: number,
): ProbeResult {
  const normalised = new URL(url);
  normalised.hash = "";
  const result: { -readonly [K in keyof ProbeResult]: ProbeResult[K] } = {
    url: normalised.href,
    observedAt,
    evidence: [],
  };
  const evidence: { header: string; value: string }[] = [];
  const fields = new Map<string, string[]>();
  for (const [header, value] of headers) {
    const name = header.toLowerCase();
    if (!["accept-patch", "accept-post", "allow", "wac-allow", "link"].includes(name)) continue;
    evidence.push({ header, value });
    const values = fields.get(name) ?? [];
    values.push(value);
    fields.set(name, values);
  }
  result.evidence = evidence;
  for (const [header, property] of [
    ["accept-patch", "acceptPatch"],
    ["accept-post", "acceptPost"],
  ] as const) {
    const value = combinedField(fields.get(header));
    if (value !== undefined) result[property] = mediaTypes(value);
  }
  const allow = combinedField(fields.get("allow"));
  if (allow !== undefined)
    result.allow = allow
      .split(",")
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean);
  const wac = fields.get("wac-allow");
  if (wac) {
    const permissions = parseWacAllow(wac.join(","));
    if (permissions) result.wacAllow = permissions;
  }
  for (const link of parseLinkHeaders(fields.get("link") ?? [], result.url)) {
    if (link.context !== result.url) continue;
    if (link.rel.includes("acl")) result.aclLink ??= link.target;
    if (link.rel.includes(ACP.accessControl.toLowerCase())) result.acpLink ??= link.target;
  }
  return result;
}
