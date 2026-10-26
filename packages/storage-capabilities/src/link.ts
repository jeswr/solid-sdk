// AUTHORED-BY Codex GPT-6.1-Sol

/** A Link field value with its target and anchor context resolved against the response URL. */
export interface ParsedLink {
  readonly target: string;
  readonly context: string;
  /** Case-normalised relation types; extension URIs are compared case-insensitively too. */
  readonly rel: readonly string[];
  /** Unquoted parameters, with lower-case names; repeated hreflang/extension parameters survive. */
  readonly parameters: readonly (readonly [string, string])[];
}

/** Bounds for Link parsing; defaults preserve the original silent truncation behaviour. */
export interface ParseLinkHeadersOptions {
  /** Maximum UTF-8 bytes per field value (default 8192); a non-negative safe integer. */
  maxBytes?: number;
  /** Maximum nonempty members across all fields (default 64); includes malformed members. */
  maxMembers?: number;
  /** Cumulative resolved target + context UTF-16 code units (default unlimited); a non-negative safe integer. */
  maxResolvedBytes?: number;
  /** Ignore oversized fields and stop at member/resolved limits, or reject incomplete inspection. */
  onOverflow?: "truncate" | "throw";
}

/** The authoritative Link fields could not be fully inspected within the configured bounds. */
export class LinkHeaderOverflowError extends Error {
  constructor(readonly limit: "maxBytes" | "maxMembers" | "maxResolvedBytes") {
    super(`Link header exceeds ${limit}`);
    this.name = "LinkHeaderOverflowError";
  }
}

type LinkToken = { kind: "target" | "quoted" | "token" | ";" | "=" | "invalid"; value: string };

const tokenCharacter = /^[!#$%&'*+\-.^_`|~\da-z]$/i;

/** Tokenise once, treating commas inside targets and quoted strings as data. */
function* tokenizeLinkValues(value: string): Generator<LinkToken[]> {
  let member: LinkToken[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const character = value.charAt(cursor++);
    if (character === " " || character === "\t") continue;
    if (character === ",") {
      if (member.length) yield member;
      member = [];
    } else if (character === "<") {
      const start = cursor;
      while (cursor < value.length && value.charAt(cursor) !== ">") cursor++;
      const target = value.slice(start, cursor);
      const closed = cursor < value.length;
      if (closed) cursor++;
      member.push({
        kind: closed && !/[<\r\n]/.test(target) ? "target" : "invalid",
        value: target,
      });
    } else if (character === '"') {
      let quoted = "";
      let closed = false;
      while (cursor < value.length) {
        const next = value.charAt(cursor++);
        if (next === '"') {
          closed = true;
          break;
        }
        if (next === "\\") {
          if (cursor === value.length) break;
          quoted += value.charAt(cursor++);
        } else {
          quoted += next;
        }
      }
      member.push({
        // biome-ignore lint/suspicious/noControlCharactersInRegex: HTTP quoted strings exclude control octets.
        kind: closed && !/[\x00-\x08\x0a-\x1f\x7f]/.test(quoted) ? "quoted" : "invalid",
        value: quoted,
      });
    } else if (tokenCharacter.test(character)) {
      const start = cursor - 1;
      while (tokenCharacter.test(value.charAt(cursor))) cursor++;
      member.push({ kind: "token", value: value.slice(start, cursor) });
    } else {
      member.push({
        kind: character === ";" || character === "=" ? character : "invalid",
        value: character,
      });
    }
  }
  if (member.length) yield member;
}

/** Interpret tokens without retrying earlier input when a member is malformed. */
function parseLinkValue(tokens: LinkToken[], base: string): ParsedLink | undefined {
  const target = tokens[0] as LinkToken;
  if (target.kind !== "target") return undefined;
  const parameters: [string, string][] = [];
  const singletons = new Set<string>();
  for (let cursor = 1; cursor < tokens.length; cursor++) {
    if (tokens[cursor]?.kind !== ";") return undefined;
    const parameter = tokens[++cursor];
    if (parameter?.kind !== "token") return undefined;
    const name = parameter.value.toLowerCase();
    let value = "";
    if (tokens[cursor + 1]?.kind === "=") {
      cursor += 2;
      const token = tokens[cursor];
      if (token?.kind !== "token" && token?.kind !== "quoted") return undefined;
      value = token.value;
    }
    if (["rel", "anchor", "media", "title", "title*", "type"].includes(name)) {
      if (singletons.has(name)) continue;
      singletons.add(name);
    }
    parameters.push([name, value]);
  }
  const rel = (parameters.find(([name]) => name === "rel")?.[1] ?? "")
    .toLowerCase()
    .split(/[ \t]+/)
    .filter(Boolean);
  if (rel.length === 0) return undefined;
  try {
    return {
      target: new URL(target.value, base).href,
      context: new URL(parameters.find(([name]) => name === "anchor")?.[1] ?? base, base).href,
      rel,
      parameters,
    };
  } catch {
    // A malformed target or anchor cannot establish a usable link.
    return undefined;
  }
}

/**
 * Parse combined or separate Link field values (RFC 8288 §§3.1–3.5).
 * Targets and anchors resolve independently against the response URL. Singleton parameters
 * use their first occurrence. Extended attributes such as title* are retained in wire encoding.
 * By default, fields over 8 KiB (UTF-8) are ignored; at most 64 nonempty members are read,
 * including malformed members. Malformed members are skipped at the next unquoted comma outside
 * a target; an unterminated quote/target consumes the rest of its field. Invalid URLs and links
 * without relations are ignored. maxResolvedBytes optionally bounds cumulative resolved target +
 * context lengths in UTF-16 code units, counting both URLs for every retained member, including
 * duplicates and implicit response-URL contexts. Its default is unlimited; truncation stops before
 * retaining an overflowing member. With onOverflow: 'throw', exceeding any bound throws
 * LinkHeaderOverflowError instead of returning partial links; exactly reaching a bound is valid.
 * An invalid response URL throws TypeError; invalid limits throw RangeError.
 */
export function parseLinkHeaders(
  values: string | readonly string[] | null,
  responseUrl: string,
  options: ParseLinkHeadersOptions = {},
): readonly ParsedLink[] {
  const base = new URL(responseUrl).href;
  const { maxBytes = 8192, maxMembers = 64, maxResolvedBytes, onOverflow = "truncate" } = options;
  for (const limit of [maxBytes, maxMembers, maxResolvedBytes]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
      throw new RangeError("Link header limits must be non-negative safe integers");
  }
  const links: ParsedLink[] = [];
  let members = 0;
  let resolvedBytes = 0;
  for (const value of typeof values === "string" ? [values] : (values ?? [])) {
    // The cheap length check also avoids encoding an arbitrarily large string.
    if (value.length > maxBytes || new TextEncoder().encode(value).byteLength > maxBytes) {
      if (onOverflow === "throw") throw new LinkHeaderOverflowError("maxBytes");
      continue;
    }
    for (const tokens of tokenizeLinkValues(value)) {
      if (members === maxMembers) {
        if (onOverflow === "throw") throw new LinkHeaderOverflowError("maxMembers");
        return links;
      }
      const link = parseLinkValue(tokens, base);
      if (link) {
        resolvedBytes += link.target.length + link.context.length;
        if (maxResolvedBytes !== undefined && resolvedBytes > maxResolvedBytes) {
          if (onOverflow === "throw") throw new LinkHeaderOverflowError("maxResolvedBytes");
          return links;
        }
        links.push(link);
      }
      if (++members === maxMembers && onOverflow === "truncate") return links;
    }
  }
  return links;
}
