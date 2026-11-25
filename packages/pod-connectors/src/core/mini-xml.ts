// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * A minimal, dependency-free reader for the *flat, attribute-only* XML that
 * Apple Health's `export.xml` is built from. It is **not** a general XML
 * parser: it extracts elements with a given tag name and returns their
 * attributes as a string map. That is all the Health export needs (`<Workout
 * .../>`, `<Record .../>` are attribute-only, self-closing or with simple
 * children we ignore), and it avoids bundling a parser for an untrusted,
 * potentially huge file.
 *
 * Security: input is untrusted text. We never resolve entities beyond the five
 * predefined XML ones, never follow DOCTYPE/external entities (a classic XXE
 * vector — we simply ignore DOCTYPE), and only ever return inert strings.
 */

/** One extracted element: its attributes as a (decoded) string map. */
export type XmlAttrs = Readonly<Record<string, string>>;

const DECODE: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode the five predefined XML entities plus numeric character refs. */
export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) &&
        code > 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    }
    return Object.hasOwn(DECODE, body) ? (DECODE[body] as string) : whole;
  });
}

/**
 * Yield the attribute maps of every `<tag …>` (self-closing or open) element.
 * Open/close nesting is ignored — only the start tag's attributes are read,
 * which is exactly the Apple Health shape. Bounded by `limit`.
 */
export function* extractElements(
  xml: string,
  tag: string,
  limit = Number.POSITIVE_INFINITY,
): Generator<XmlAttrs> {
  // Match `<Tag ...>` or `<Tag .../>`; capture the attribute chunk.
  const re = new RegExp(`<${escapeTag(tag)}((?:\\s[^>]*)?)/?>`, "g");
  let m: RegExpExecArray | null;
  let count = 0;
  // Bounded regex exec loop; assignments deliberately advance the parser.
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec iteration
  while (count < limit && (m = re.exec(xml)) !== null) {
    yield parseAttrs(m[1] ?? "");
    count++;
  }
}

/** One extracted element with its raw inner markup (`""` when self-closing). */
export interface XmlBlock {
  readonly attrs: XmlAttrs;
  /** Everything between `<tag …>` and `</tag>`, verbatim (still encoded). */
  readonly inner: string;
}

/**
 * Yield every `<tag …>…</tag>` (or self-closing `<tag …/>`) element as
 * attributes + raw inner markup. The close tag is found by linear scan, so a
 * tag must not nest inside itself — true of the GPX/TCX shapes we read
 * (`trk`, `trkpt`, `Activity`, `Lap`, `Trackpoint`). Same security posture as
 * {@link extractElements}: untrusted text in, inert strings out, DOCTYPE and
 * external entities ignored. Bounded by `limit`.
 */
export function* extractBlocks(
  xml: string,
  tag: string,
  limit = Number.POSITIVE_INFINITY,
): Generator<XmlBlock> {
  const open = new RegExp(`<${escapeTag(tag)}((?:\\s[^>]*)?)/?>`, "g");
  const close = `</${tag}>`;
  let count = 0;
  let m: RegExpExecArray | null;
  // Bounded regex exec loop; assignments deliberately advance the parser.
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec iteration
  while (count < limit && (m = open.exec(xml)) !== null) {
    const attrs = parseAttrs(m[1] ?? "");
    if (m[0].endsWith("/>")) {
      yield { attrs, inner: "" };
      count++;
      continue;
    }
    const end = xml.indexOf(close, open.lastIndex);
    if (end === -1) {
      // Truncated/hostile input: take the rest rather than scanning forever.
      yield { attrs, inner: xml.slice(open.lastIndex) };
      return;
    }
    yield { attrs, inner: xml.slice(open.lastIndex, end) };
    open.lastIndex = end + close.length;
    count++;
  }
}

/**
 * The decoded text content of the **first** `<tag>…</tag>` in `xml`, trimmed —
 * for simple leaf elements (`<name>`, `<time>`, `<DistanceMeters>`).
 * `undefined` when the tag is absent or holds markup rather than text.
 */
export function firstTagText(xml: string, tag: string): string | undefined {
  for (const block of extractBlocks(xml, tag, 1)) {
    const inner = block.inner.trim();
    if (inner.includes("<")) return undefined; // not a leaf element
    const text = decodeXmlEntities(inner).trim();
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

const ATTR_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"|([A-Za-z_:][\w:.-]*)\s*=\s*'([^']*)'/g;

export function parseAttrs(chunk: string): XmlAttrs {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  // Bounded regex exec loop; assignments deliberately advance the parser.
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec iteration
  while ((m = ATTR_RE.exec(chunk)) !== null) {
    const name = m[1] ?? m[3];
    const value = m[2] ?? m[4] ?? "";
    if (name) out[name] = decodeXmlEntities(value);
  }
  return out;
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bounded nested XML for activity exports. No DTDs, entities, external I/O or DOM.
 * Tokens retain at most 64 Ki characters, nesting at most 64 elements. Callers
 * bound event counts separately. QNames are balanced before exposing local names.
 */
export type XmlEvent =
  | { kind: "start"; name: string; attrs: XmlAttrs }
  | { kind: "end"; name: string }
  | { kind: "text"; text: string };

/** `onScan` runs once per {@link XML_SCAN_CHARGE_CHARS} characters scanned, including
 * comment and attribute text, so callers can charge work that yields few events.
 */
export const XML_SCAN_CHARGE_CHARS = 512;
export interface XmlEventOptions {
  readonly onScan?: () => void;
}
export async function* xmlEvents(
  chunks: AsyncIterable<string>,
  options: XmlEventOptions = {},
): AsyncGenerator<XmlEvent> {
  const { onScan } = options;
  let scanned = 0;
  const stack: string[] = [];
  let token: string[] = [];
  let markup = false;
  let quote = "";
  let prefix = "";
  let ending = "";
  let special = "";
  let root = false;
  const textEvent = (): XmlEvent => {
    const text = decodeXmlEntities(token.join(""));
    token = [];
    if (!stack.length && text.trim()) throw new Error("Text outside XML root.");
    return { kind: "text", text };
  };
  for await (const chunk of chunks) {
    for (const char of chunk) {
      if (onScan && ++scanned === XML_SCAN_CHARGE_CHARS) {
        scanned = 0;
        onScan();
      }
      if (!markup) {
        if (char !== "<") {
          token.push(char);
          if (token.length > 65536) throw new Error("XML text limit exceeded.");
          continue;
        }
        if (token.length) yield textEvent();
        markup = true;
        prefix = "<";
        token = ["<"];
        continue;
      }
      if (prefix.length < 9) prefix += char;
      ending = (ending + char).slice(-3);
      if (special) {
        if (ending === special) {
          special = "";
          markup = false;
          token = [];
          prefix = "";
          ending = "";
        }
        continue;
      }
      token.push(char);
      if (token.length > 65536) throw new Error("XML tag limit exceeded.");
      if (prefix === "<!--") {
        special = "-->";
        token = [];
        continue;
      }
      // Activity values never require CDATA; reject declarations fail closed.
      if (prefix.length >= 4 && prefix.startsWith("<!"))
        throw new Error("XML declarations are unsupported.");
      if (quote) {
        if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char !== ">") continue;
      const raw = token.join("");
      token = [];
      markup = false;
      prefix = "";
      ending = "";
      if (raw.startsWith("<?")) {
        if (root || !/^<\?xml\s[^<>]*\?>$/.test(raw)) throw new Error("Invalid XML instruction.");
        continue;
      }
      const match = /^<(\/)?([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)>$/.exec(raw);
      if (!match) throw new Error("Invalid XML element.");
      const [, close, qname, attributes = "", self] = match;
      const name = (qname as string).split(":").at(-1) as string;
      if (close) {
        if (attributes.trim() || self || stack.pop() !== qname)
          throw new Error("Mismatched XML element.");
        yield { kind: "end", name };
      } else {
        if (!stack.length) {
          if (root) throw new Error("Multiple XML roots.");
          root = true;
        }
        if (stack.length >= 64) throw new Error("XML depth limit exceeded.");
        const attrs = strictAttrs(attributes);
        stack.push(qname as string);
        yield { kind: "start", name, attrs };
        if (self) {
          stack.pop();
          yield { kind: "end", name };
        }
      }
    }
  }
  if (markup || stack.length || !root) throw new Error("Incomplete XML document.");
  if (token.length) yield textEvent();
}

/** Linear, strict attribute scanning for nested XML. The older flat reader's
 * permissive regex is deliberately not used on activity-file markup.
 */
function strictAttrs(raw: string): XmlAttrs {
  const attrs: Record<string, string> = Object.create(null);
  let i = 0;
  while (i < raw.length) {
    if (!/\s/.test(raw[i] as string)) throw new Error("Invalid XML attribute boundary.");
    while (i < raw.length && /\s/.test(raw[i] as string)) i++;
    if (i === raw.length) break;
    const start = i;
    if (!/[A-Za-z_:]/.test(raw[i] as string)) throw new Error("Invalid XML attribute name.");
    while (i < raw.length && /[\w:.-]/.test(raw[i] as string)) i++;
    const name = raw.slice(start, i);
    while (i < raw.length && /\s/.test(raw[i] as string)) i++;
    if (raw[i++] !== "=") throw new Error("Invalid XML attribute assignment.");
    while (i < raw.length && /\s/.test(raw[i] as string)) i++;
    const quote = raw[i++];
    if (quote !== '"' && quote !== "'") throw new Error("Invalid XML attribute quote.");
    const valueStart = i;
    while (i < raw.length && raw[i] !== quote) {
      if (raw[i] === "<") throw new Error("Invalid XML attribute content.");
      i++;
    }
    if (i === raw.length || Object.hasOwn(attrs, name))
      throw new Error("Invalid or duplicate XML attribute.");
    attrs[name] = decodeXmlEntities(raw.slice(valueStart, i++));
  }
  return attrs;
}
