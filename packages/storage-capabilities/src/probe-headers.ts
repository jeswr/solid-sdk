// AUTHORED-BY Codex GPT-6.1-Sol
import { parseLinkHeaders } from "./link.js";
import type { ProbeResult, WacMode } from "./types.js";
import { ACP } from "./vocab.js";

/** Parse a WAC-Allow field without mistaking malformed evidence for known permissions. */
function parseWacAllow(value: string): ProbeResult["wacAllow"] {
  const permissions: { user: WacMode[]; public: WacMode[] } = { user: [], public: [] };
  const seen = new Set<string>();
  const scope = /[ \t]*(user|public)[ \t]*=[ \t]*"([^"\r\n]*)"[ \t]*(,|$)/y;
  for (let match = scope.exec(value); match !== null; match = scope.exec(value)) {
    const name = match[1] as "user" | "public";
    const modes = (match[2] as string).split(/[ \t]+/).filter(Boolean);
    if (
      seen.has(name) ||
      modes.some((mode) => !["read", "write", "append", "control"].includes(mode))
    ) {
      return undefined;
    }
    seen.add(name);
    permissions[name] = modes as WacMode[];
    if (match[3] === "") return permissions;
  }
  return undefined;
}

/** Parse media types while discarding parameters, including commas inside quoted parameters. */
function mediaTypes(value: string): string[] {
  return value
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .split(",")
    .map((part) => (part.split(";", 1)[0] as string).trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Pure parsing of one response's capability headers; no OPTIONS/HEAD request is made here.
 * Pass raw header pairs to preserve response order and repeated fields. A Headers instance
 * supplies its own iteration order (typically sorted, with repeated fields already combined).
 * Recognised raw fields, including malformed WAC-Allow, are retained as evidence. Links whose
 * anchor changes the probed resource's context do not describe its access control.
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
    const values = fields.get(header);
    if (values) result[property] = mediaTypes(values.join(","));
  }
  const allow = fields.get("allow");
  if (allow)
    result.allow = allow
      .join(",")
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
