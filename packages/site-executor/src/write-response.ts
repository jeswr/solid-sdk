// AUTHORED-BY Codex GPT-6.1-Sol
// Executor-local declarations until created-location/success evidence joins the shared contract.
import { attribute, elementText, jsonPointer, parseHtml, selectElement } from "./dom.js";
import { guardUrl } from "./origin.js";
import { BindingError } from "./values.js";

export interface WriteResponsePolicy {
  /** On-origin URL/path with whole-segment {variables}, e.g. /products/id/{id}. */
  createdLocationPattern: string;
  errorLocationPatterns?: string[];
  success?:
    | { format: "json"; path: string; value: string }
    | { format: "html"; selector: string; attribute?: string; value?: string };
}

function patternPath(pattern: string, origin: string): RegExp {
  const marked = pattern.replace(/\{[A-Za-z][\w]*\}/g, "sab_pattern_slot");
  const url = guardUrl(marked, origin);
  if (url.search || url.hash || /[{}]/.test(marked))
    throw new BindingError("invalid created-location pattern");
  const parts = url.pathname.split("/").map((part) => {
    if (part === "sab_pattern_slot") return "[^/]+";
    if (part.includes("sab_pattern_slot"))
      throw new BindingError("created-location slots must occupy whole segments");
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp(`^${parts.join("/")}$`);
}

export function validateWriteResponsePolicy(policy: WriteResponsePolicy, origin: string): void {
  patternPath(policy.createdLocationPattern, origin);
  for (const error of policy.errorLocationPatterns ?? []) patternPath(error, origin);
}

export function verifiedCreatedLocation(
  policy: WriteResponsePolicy | undefined,
  hops: string[],
  finalUrl: URL,
  body: string,
  origin: string,
): string | undefined {
  if (!policy || !hops.length) return undefined;
  const pattern = patternPath(policy.createdLocationPattern, origin);
  const first = guardUrl(hops[0] as string, origin);
  const destinations = [...hops.map((hop) => guardUrl(hop, origin)), finalUrl];
  if (
    destinations.some(
      (url) =>
        !pattern.test(url.pathname) ||
        url.pathname !== first.pathname ||
        (policy.errorLocationPatterns ?? []).some((p) => patternPath(p, origin).test(url.pathname)),
    )
  )
    return undefined;
  const success = policy.success;
  if (success?.format === "json") {
    try {
      const value = jsonPointer(JSON.parse(body), success.path);
      if (
        !["string", "number", "boolean"].includes(typeof value) ||
        String(value) !== success.value
      )
        return undefined;
    } catch {
      return undefined;
    }
  } else if (success?.format === "html") {
    const el = selectElement(success.selector, parseHtml(body));
    if (!el) return undefined;
    const value = success.attribute ? attribute(el, success.attribute) : elementText(el);
    if (success.value !== undefined && value !== success.value) return undefined;
  }
  return first.href;
}
