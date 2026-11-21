// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Strict, bounded MIME structure reader for the email binding's ONE supported layout.
 *
 * `@jeswr/agentic-legacy-bridge`'s hardened `parseEmail` remains the parser for envelope
 * observations and structured-copy extraction; it deliberately returns only a best text
 * body, so it cannot show whether the HTML alternative (or a second text part) says
 * something different. This reader exposes every leaf of messages in the supported layout
 * so the binding can check human-visible parity exactly — and it refuses anything outside
 * tight bounds or with an unexpected shape rather than guessing.
 *
 * Supported: CRLF or LF line endings; `multipart/*` with a declared boundary and a closing
 * delimiter; leaves in base64, quoted-printable, 7bit or 8bit; text and JSON leaves in
 * UTF-8 or US-ASCII for parity. Carrier discovery decodes HTML with the legacy
 * parser's more permissive charset and transfer-encoding rules.
 */

export interface MimeNode {
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly type: string;
  readonly params: Readonly<Record<string, string>>;
  readonly children?: readonly MimeNode[];
  /** Decoded text of a leaf, when requested by the scan. */
  readonly text?: string;
}

export interface MimeLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxParts: number;
  readonly maxHeaders: number;
}

export const DEFAULT_MIME_LIMITS: MimeLimits = {
  maxBytes: 512 * 1024,
  maxDepth: 4,
  maxParts: 12,
  maxHeaders: 80,
};

export type MimeResult =
  | { readonly ok: true; readonly root: MimeNode }
  | { readonly ok: false; readonly detail: string };

class MimeError extends Error {}

function splitHeaderBody(s: string): { head: string; body: string } {
  const crlf = s.indexOf("\r\n\r\n");
  const lf = s.indexOf("\n\n");
  if (crlf >= 0 && (lf < 0 || crlf <= lf))
    return { head: s.slice(0, crlf), body: s.slice(crlf + 4) };
  if (lf >= 0) return { head: s.slice(0, lf), body: s.slice(lf + 2) };
  return { head: s, body: "" };
}

function parseHeaders(head: string, limits: MimeLimits): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of head.split(/\r?\n/)) {
    if (line.length === 0) continue;
    if (line.startsWith(" ") || line.startsWith("\t")) {
      const last = out.at(-1);
      if (!last) throw new MimeError("continuation line before any header");
      last[1] = `${last[1]} ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) throw new MimeError("malformed header line");
    const name = line.slice(0, colon);
    if (!/^[!-9;-~]+$/.test(name)) throw new MimeError("invalid header name");
    out.push([name.toLowerCase(), line.slice(colon + 1).trim()]);
    if (out.length > limits.maxHeaders) throw new MimeError("too many headers");
  }
  return out;
}

export function headerValues(node: MimeNode, name: string): string[] {
  return node.headers.filter(([n]) => n === name).map(([, v]) => v);
}

function parseContentType(value: string | undefined): {
  type: string;
  params: Record<string, string>;
} {
  if (!value) return { type: "text/plain", params: {} };
  const [first, ...rest] = value.split(";");
  const type = (first as string).trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type))
    throw new MimeError("invalid content type");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const k = p.slice(0, eq).trim().toLowerCase();
    let v = p.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
    params[k] = v;
  }
  return { type, params };
}

function decodeQp(s: string, tolerant: boolean): Uint8Array {
  const bytes: number[] = [];
  const text = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x3d) {
      const hex = text.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
      if (!tolerant) throw new MimeError("bad quoted-printable escape");
    }
    bytes.push(c & 0xff);
  }
  return Uint8Array.from(bytes);
}

function decodeTransfer(body: string, cte: string | undefined, tolerant = false): Uint8Array {
  const enc = (cte ?? "7bit").trim().toLowerCase();
  if (enc === "base64") {
    if (tolerant) return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
    const compact = body.replace(/[\r\n\t ]/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0)
      throw new MimeError("invalid base64 body");
    return Buffer.from(compact, "base64");
  }
  if (enc === "quoted-printable") return decodeQp(body, tolerant);
  if (tolerant || enc === "7bit" || enc === "8bit" || enc === "binary")
    return Buffer.from(body, "latin1");
  throw new MimeError(`unsupported transfer encoding ${enc}`);
}

function decodeLeaf(body: string, cte: string | undefined, charset: string | undefined): string {
  const bytes = decodeTransfer(body, cte);
  const cs = (charset ?? "us-ascii").toLowerCase();
  if (cs !== "utf-8" && cs !== "us-ascii" && cs !== "utf8")
    throw new MimeError(`unsupported charset ${cs}`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new MimeError("text is not valid UTF-8");
  }
}

function decodeHtmlForScan(body: string, cte: string | undefined, charset: string | undefined) {
  const bytes = decodeTransfer(body, cte, true);
  const encoding = (charset ?? "").trim();
  const utf8 = new TextDecoder().decode(bytes);
  if (/^(?:utf-?8|(?:us-)?ascii)?$/i.test(encoding)) return utf8;
  try {
    const text = new TextDecoder(encoding).decode(bytes);
    // Keep ASCII markup visible even if a misleading charset changes its interpretation.
    return text === utf8 ? text : `${text}\n${utf8}`;
  } catch {
    return utf8;
  }
}

function splitMultipart(body: string, boundary: string): string[] {
  const lines = body.split(/\r?\n/);
  const parts: string[] = [];
  let current: string[] | undefined;
  let closed = false;
  for (const line of lines) {
    let end = line.length;
    while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end--;
    const trimmed = line.slice(0, end);
    if (trimmed === `--${boundary}--`) {
      if (current) parts.push(current.join("\r\n"));
      current = undefined;
      closed = true;
      break;
    }
    if (trimmed === `--${boundary}`) {
      if (current) parts.push(current.join("\r\n"));
      current = [];
      continue;
    }
    if (current) current.push(line);
  }
  if (!closed) throw new MimeError("multipart without closing delimiter");
  return parts;
}

function parseEntity(
  s: string,
  depth: number,
  count: { parts: number },
  limits: MimeLimits,
  carriersOnly: boolean,
): MimeNode {
  if (depth > limits.maxDepth) throw new MimeError("MIME nesting too deep");
  if (!carriersOnly && ++count.parts > limits.maxParts) throw new MimeError("too many MIME parts");
  const { head, body } = splitHeaderBody(s);
  const headers = parseHeaders(head, limits);
  const ctValues = headers.filter(([n]) => n === "content-type");
  if (ctValues.length > 1) throw new MimeError("duplicate Content-Type");
  const { type, params } = parseContentType(ctValues[0]?.[1]);
  if (type.startsWith("multipart/")) {
    const boundary = params.boundary;
    if (!boundary || !/^[0-9A-Za-z'()+_,./:=? -]{1,70}$/.test(boundary))
      throw new MimeError("missing or invalid boundary");
    const children = splitMultipart(body, boundary).map((p) =>
      parseEntity(p, depth + 1, count, limits, carriersOnly),
    );
    return { headers, type, params, children };
  }
  if (carriersOnly && type !== "text/html" && type !== "application/ld+json")
    return { headers, type, params };
  if (carriersOnly && ++count.parts > limits.maxParts) throw new MimeError("too many MIME parts");
  const cte = headers.filter(([n]) => n === "content-transfer-encoding");
  if (cte.length > 1) throw new MimeError("duplicate Content-Transfer-Encoding");
  // Remove the single line break that precedes a boundary delimiter.
  const leafBody = body.replace(/\r?\n$/, "");
  const decode = carriersOnly && type === "text/html" ? decodeHtmlForScan : decodeLeaf;
  return { headers, type, params, text: decode(leafBody, cte[0]?.[1], params.charset) };
}

/** Parse raw RFC 5322 bytes into a MIME tree, or refuse with a reason. Never throws. */
export function parseMime(
  raw: string | Uint8Array,
  limits: MimeLimits = DEFAULT_MIME_LIMITS,
  { carriersOnly = false } = {},
): MimeResult {
  const bytes = typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.from(raw);
  if (bytes.length > limits.maxBytes)
    return { ok: false, detail: `message exceeds ${limits.maxBytes} bytes` };
  try {
    return {
      ok: true,
      root: parseEntity(bytes.toString("latin1"), 0, { parts: 0 }, limits, carriersOnly),
    };
  } catch (error) {
    return { ok: false, detail: error instanceof MimeError ? error.message : "unparseable MIME" };
  }
}

/** A compact description of the tree, e.g. `multipart/mixed(text/plain,application/ld+json)`. */
export function shapeOf(node: MimeNode): string {
  return node.children ? `${node.type}(${node.children.map(shapeOf).join(",")})` : node.type;
}

export function leaves(node: MimeNode): MimeNode[] {
  return node.children ? node.children.flatMap(leaves) : [node];
}
