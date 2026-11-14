// AUTHORED-BY Codex GPT-6.1-Sol
import type { EndpointCandidate, RecordedRequest } from "@jeswr/site-profiler";

export const credentialRejection = "Unresolved session material in learning candidate.";

/** Scan every string, including object keys and strings containing encoded JSON/URLs/forms.
 * The shared executor redactor owns normalization, credential forms and short-token boundaries.
 */
export function containsCredential(value: unknown, redact: (text: string) => string): boolean {
  if (typeof value === "string")
    return /\[redacted\]|%5bredacted%5d/i.test(value) || redact(value) !== value;
  if (Array.isArray(value)) return value.some((item) => containsCredential(item, redact));
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(
      ([key, item]) => containsCredential(key, redact) || containsCredential(item, redact),
    );
  return false;
}

type SlotCheck = (
  kind: "path" | "query" | "header" | "form",
  name: string,
  value: string,
) => boolean;

/** Preserve raw JSON keys, duplicate members and all non-slot bytes. Only top-level scalar
 * values can be form-target CSRF slots; parsing validates syntax without rewriting evidence.
 */
function jsonSlots(body: string, isSlot: SlotCheck): string {
  try {
    JSON.parse(body);
  } catch {
    return body;
  }
  let depth = 0;
  let key: string | undefined;
  let value = false;
  return body.replace(/"(?:\\.|[^"\\])*"|[{}[\]:,]|[^\s{}[\]:,]+/g, (token) => {
    if (token === "{" || token === "[") depth++;
    else if (token === "}" || token === "]") depth--;
    else if (depth === 1) {
      if (token === ",") {
        key = undefined;
        value = false;
      } else if (token === ":") value = true;
      else if (value) {
        value = false;
        if (key !== undefined && isSlot("form", key, String(JSON.parse(token)))) return '""';
      } else if (key === undefined && token.startsWith('"')) key = JSON.parse(token);
    }
    return token;
  });
}

/** Scan witnessed bytes, masking only verified CSRF values. Keep every name and fragment,
 * including query parameters and URL segments that template normalization would discard.
 * Decoding locates slots only; the scan receives the original spelling everywhere else.
 */
export function witnessedRequestContainsCredential(
  request: RecordedRequest,
  redact: (text: string) => string,
  isSlot: SlotCheck,
): boolean {
  const pairs = (text: string, kind: "query" | "form") =>
    text
      .split("&")
      .map((pair) => {
        const entry = new URLSearchParams(pair).entries().next().value;
        const equals = pair.indexOf("=");
        return entry && equals >= 0 && isSlot(kind, entry[0], entry[1])
          ? pair.slice(0, equals + 1)
          : pair;
      })
      .join("&");
  const url = request.url.replace(
    /^([a-z][a-z\d+.-]*:\/\/[^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i,
    (
      _match,
      authority: string,
      path: string,
      query: string | undefined,
      fragment: string | undefined,
    ) =>
      authority +
      path
        .split("/")
        .map((part, index) => {
          let value = part;
          try {
            value = decodeURIComponent(part);
          } catch {
            // Malformed spellings remain in the scan.
          }
          return isSlot("path", String(index), value) ? "" : part;
        })
        .join("/") +
      (query ? `?${pairs(query.slice(1), "query")}` : "") +
      (fragment ?? ""),
  );
  const contentType = request.requestHeaders["content-type"] ?? "";
  let body = request.postData;
  if (body) {
    if (/json/i.test(contentType) || (!contentType && /^\s*[{[]/.test(body)))
      body = jsonSlots(body, isSlot);
    else if (!contentType || /x-www-form-urlencoded/i.test(contentType)) body = pairs(body, "form");
  }
  return containsCredential(
    [
      request.method,
      url,
      Object.entries(request.requestHeaders).map(([name, value]) => [
        name,
        isSlot("header", name, value) ? undefined : value,
      ]),
      body,
    ],
    redact,
  );
}

/** Rescan the prospective template and witnessed requests for both learning paths, including
 * custom drivers. Source pages are not request constants. Only CSRF slot values are exempt.
 */
export function candidateContainsCredential(
  candidate: EndpointCandidate,
  redact: (text: string) => string,
): boolean {
  const { samples, form: _form, script: _script, ...template } = candidate;
  const path = new URL(candidate.urlTemplate.replace(/\{[?&][^}]*\}/g, "")).pathname
    .split("/")
    .map(decodeURIComponent);
  return (
    samples.some((sample) =>
      witnessedRequestContainsCredential(sample, redact, (kind, name) =>
        candidate.csrf.some((rule) =>
          kind === "path"
            ? rule.target.kind === "query" && path[Number(name)] === `{${rule.target.name}}`
            : rule.target.kind === kind &&
              (kind === "header"
                ? rule.target.name.toLowerCase() === name.toLowerCase()
                : rule.target.name === name),
        ),
      ),
    ) ||
    containsCredential(
      {
        ...template,
        params: candidate.params.map((param) =>
          candidate.csrf.some((rule) => rule.target.name === param.name)
            ? { ...param, examples: [] }
            : param,
        ),
      },
      redact,
    )
  );
}
