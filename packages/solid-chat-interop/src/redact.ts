// AUTHORED-BY Codex GPT-6.1-Sol
import { sanitizeText } from "./iri.js";

const VALUE_MARKER = "[REDACTED]";
const MARKERS = [
  VALUE_MARKER,
  "[REDACTED PRIVATE KEY]",
  "[REDACTED TOKEN]",
  "[REDACTED AWS KEY]",
  "[REDACTED JWT]",
  "[REDACTED AUTHORIZATION]",
  "[REDACTED ENV]", // Recognize archives written by the previous redactor too.
];

function markerLength(text: string, offset: number): number {
  return text[offset] === "["
    ? (MARKERS.find((marker) => text.startsWith(marker, offset))?.length ?? 0)
    : 0;
}

function secretName(name: string): boolean {
  // Most credential words deliberately match substrings (e.g. authentication). "auth" skips
  // author/authority (package metadata, prose) but still matches authorization/authorisation.
  // "key"/"pw" need a word part, so monkey/keyboard/pwned survive but apiKey do not.
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_.-]+/);
  return (
    /token|secret|password|passwd|pwd|passphrase|pass|credential|creds|auth(?!or(?!i[sz]))|cookie|session|bearer|signature|salt|dsn/i.test(
      name,
    ) ||
    /connectionstring|connstr/i.test(parts.join("")) ||
    parts.includes("key") ||
    parts.includes("pw")
  );
}

type ValueSyntax = "code" | "shell" | "query";

/** Find one value without backtracking; retain its surrounding quotes, if any. */
function valueSpan(text: string, offset: number, syntax: ValueSyntax) {
  const quote = text[offset];
  const quoted = quote === '"' || quote === "'";
  const start = quoted ? offset + 1 : offset;
  let innerQuote = quoted ? quote : undefined;
  let end = start;
  while (end < text.length) {
    const char = text[end];
    if (quoted && char === quote) return { start, end, next: end + 1 };
    if (!innerQuote) {
      // Token rules run first; their markers contain spaces and must stay atomic.
      const length = markerLength(text, end);
      if (length) {
        end += length;
        continue;
      }
      if (/\s/.test(char ?? "")) break;
      if (syntax === "code" && /[;,)}\]]/.test(char ?? "")) break;
      // Shell operators end words even without spaces; escaped/quoted operators do not.
      if (
        syntax === "shell" &&
        (char === ";" || char === "|" || (char === "&" && text[end + 1] === "&"))
      )
        break;
      if (syntax === "shell" && (char === '"' || char === "'")) innerQuote = char;
    } else if (!quoted && char === innerQuote) {
      innerQuote = undefined;
    }
    if (syntax === "query" && /[\s&#"'`<>]/.test(char ?? "")) break;
    // Backslash is literal only inside shell single quotes; code string literals
    // (JS, Python, JSON) stay escape-aware so `'abc\'def'` is scanned to its real end.
    if (char === "\\" && !(innerQuote === "'" && syntax === "shell") && syntax !== "query") {
      // Include escaped whitespace and LF/CRLF continuations, even at EOF.
      end += text[end + 1] === "\r" && text[end + 2] === "\n" ? 3 : 2;
    } else {
      end += 1;
    }
  }
  end = Math.min(end, text.length);
  return { start, end, next: end };
}

// Bounded recognition preserves annotations while still finding credential initializers.
// Generic heads are admitted too (Record<string, string>, Array<string | null>, etc.).
const TYPE_ANNOTATION_START =
  /^\s*(?:(?:string|number|boolean|bigint|symbol|object|unknown|any|never|void|null|undefined)(?![A-Za-z0-9_$])|[A-Za-z_$][A-Za-z0-9_$.]*\s*<)/;
const TYPE_ANNOTATION_LIMIT = 256;

function typeAnnotationSpan(text: string, offset: number) {
  const limit = Math.min(text.length, offset + TYPE_ANNOTATION_LIMIT);
  const window = text.slice(offset, limit);
  if (!TYPE_ANNOTATION_START.test(window)) {
    // A window cut off while it could still become a type is inconclusive, not "not a
    // type". Blank to the limit: the value may be on a later line, so take the conservative
    // overflow fallback. One identifier run to the limit: finish it with a single forward
    // scan; only a following `<` (a generic type) is uncertain enough for the fallback,
    // otherwise the identifier is the value and the caller redacts it as usual.
    if (limit >= text.length || !/^\s*(?:[A-Za-z_$][A-Za-z0-9_$.]*)?\s*$/.test(window)) {
      return undefined;
    }
    let end = offset;
    while (/\s/.test(text[end] ?? "")) end += 1;
    const identifier = end;
    while (/[A-Za-z0-9_$.]/.test(text[end] ?? "")) end += 1;
    const blank = end === identifier;
    while (/\s/.test(text[end] ?? "")) end += 1;
    return blank || text[end] === "<" ? { end, complete: false, overflow: true } : undefined;
  }
  let depth = 0;
  let needsType = true;
  let end = offset;
  while (end < limit) {
    const char = text[end] ?? "";
    if (/\s/.test(char)) {
      end += 1;
      continue;
    }
    if (needsType) {
      if (!/[A-Za-z_$]/.test(char)) break;
      do {
        end += 1;
      } while (end < limit && /[A-Za-z0-9_$.]/.test(text[end] ?? ""));
      needsType = false;
      continue;
    }
    if (char === "<") {
      depth += 1;
      needsType = true;
    } else if (char === ">" && depth > 0) depth -= 1;
    else if (char === "|" || char === "&" || (char === "," && depth > 0)) needsType = true;
    else if (char === "[" && text[end + 1] === "]") end += 1;
    else break;
    end += 1;
  }
  return {
    end,
    complete: !needsType && depth === 0,
    overflow: end >= limit && limit < text.length,
  };
}

function redactValues(text: string): string {
  // Match name runs once, then inspect their operator and value with forward scans.
  // The scheme boundary prevents retrying a long failed scheme at every hyphen.
  const candidates =
    /(?<scheme>(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/)|(?<env>^[ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]*=)|(?<flag>--)?(?<quote>["']?)(?<name>[A-Za-z_$][A-Za-z0-9_$.-]*)\k<quote>/gm;
  const chunks: string[] = [];
  let copied = 0;
  let previousName = "";
  let previousEnd = 0;
  const replace = (start: number, end: number) => {
    chunks.push(text.slice(copied, start), VALUE_MARKER);
    copied = end;
  };
  for (let match = candidates.exec(text); match; match = candidates.exec(text)) {
    const {
      scheme,
      env,
      flag,
      quote,
      name = "",
    } = match.groups as Record<string, string | undefined>;
    let offset = match.index + match[0].length;
    const preceding = text.slice(previousEnd, match.index);
    const declaration = /^(?:const|let|var)$/.test(previousName) && /^\s*$/.test(preceding);
    const codeContext = /[({[,]\s*$/.test(preceding);
    previousName = name;
    previousEnd = offset;
    if (scheme) {
      let colon = -1;
      let at = -1;
      for (; offset < text.length; offset += 1) {
        const length = markerLength(text, offset);
        if (length) {
          offset += length - 1;
          continue;
        }
        const char = text[offset] ?? "";
        if (/[\s/"'`<>?#]/.test(char)) break;
        if (char === ":" && colon < 0) colon = offset;
        if (char === "@") at = offset;
      }
      if (colon >= 0 && colon < at) replace(colon + 1, at);
      candidates.lastIndex = offset;
      previousEnd = offset;
      continue;
    }
    if (!env && !secretName(name)) continue;
    const nameEnd = offset;
    while (text[offset] === " " || text[offset] === "\t") offset += 1;
    const query = /[?&]/.test(text[match.index - 1] ?? "");
    let syntax: ValueSyntax = query ? "query" : env ? "shell" : "code";
    if (!env) {
      if (text.startsWith(":=", offset)) offset += 2;
      else if (
        text[offset] === "=" &&
        (flag || query || (text[offset + 1] !== "=" && text[offset + 1] !== ">"))
      ) {
        if (
          !flag &&
          !query &&
          !quote &&
          !declaration &&
          !codeContext &&
          offset === nameEnd &&
          (match.index === 0 || /[\s;|&]/.test(text[match.index - 1] ?? "")) &&
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        )
          syntax = "shell";
        offset += 1;
      } else if (text[offset] === ":" && text[offset + 1] !== ":") {
        offset += 1;
        while (text[offset] === " " || text[offset] === "\t") offset += 1;
        const annotation = typeAnnotationSpan(text, offset);
        if (annotation) {
          const { end, complete, overflow } = annotation;
          if (overflow) {
            // Past the bounded grammar, an initializer may be on a later line.
            // Treat the remainder as uncertain rather than leave any secret suffix.
            replace(offset, text.length);
            candidates.lastIndex = text.length;
            previousEnd = text.length;
            continue;
          }
          if (text[end] === "=" && text[end + 1] !== "=" && text[end + 1] !== ">") {
            offset = end + 1;
            while (/\s/.test(text[offset] ?? "")) offset += 1;
          } else if (complete) {
            continue;
          }
        }
      } else if (!flag || offset === nameEnd) continue;
      while (text[offset] === " " || text[offset] === "\t") offset += 1;
    }
    const span = valueSpan(text, offset, syntax);
    replace(span.start, span.end);
    candidates.lastIndex = span.next;
    previousEnd = span.next;
  }
  chunks.push(text.slice(copied));
  return chunks.join("");
}

/**
 * Remove common credential forms before persistence or upload. No diagnostics contain input.
 * Token rules run first. Assignments, object keys, CLI flags and query parameters with
 * secret-looking names, plus compact UPPER_SNAKE_CASE env lines and URL passwords,
 * replace only their value with [REDACTED], retaining quotes and surrounding code.
 * Credential words match substrings, except "key"/"pw" which require an underscore,
 * hyphen, dot or camelCase word boundary: key_count/apiKey redact; monkey/keyboard stay.
 * Multiline, continued and unfinished values err toward redaction. Value scanning is linear.
 *
 * {@link ChatWriter} applies this to every title and message it stores, so callers that
 * redact earlier (session capture, export import) and callers that do not (MCP `chat_save`)
 * end up with the same stored text. Redacted output is a fixpoint: redacting it again
 * changes nothing, which keeps derived message IDs stable across those paths.
 */
export function redactSecrets(text: string): string {
  return redactValues(
    // Remove control characters first (tab and line breaks stay): one inside a credential
    // would defeat the patterns below and later be stripped by the serializer.
    sanitizeText(text)
      // Include an unfinished PEM block: a truncated transcript must not leak its body.
      .replace(
        /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g,
        "[REDACTED PRIVATE KEY]",
      )
      // Token boundaries are letters and digits only, so Markdown emphasis such as
      // `__sk-...__` or `_ghp_..._` cannot hide a credential behind a word character.
      .replace(/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]+/g, "[REDACTED TOKEN]")
      .replace(
        /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g,
        "[REDACTED TOKEN]",
      )
      .replace(
        /(?<![A-Za-z0-9])(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}(?![A-Za-z0-9])/g,
        "[REDACTED AWS KEY]",
      )
      .replace(
        /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        "[REDACTED JWT]",
      )
      .replace(
        /(?<![A-Za-z0-9])(?:proxy-)?authorization\s*:[^\r\n]*/gi,
        "[REDACTED AUTHORIZATION]",
      ),
  );
}
