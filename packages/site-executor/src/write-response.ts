// AUTHORED-BY Codex GPT-6.1-Sol
// Executor-local declarations until created-location/success evidence joins the shared contract.
import { type Extraction, responseIdentity, SCHEMA } from "@jeswr/site-model";
import { attribute, elementText, jsonPointer, parseHtml, selectElement } from "./dom.js";
import { extract } from "./extract.js";
import { guardUrl } from "./origin.js";
import { BindingError } from "./values.js";

export interface WriteResponsePolicy {
  /** On-origin URL/path with whole-segment {variables}, e.g. /products/id/{id}. */
  createdLocationPattern: string;
  errorLocationPatterns?: string[];
  /** Exact redirect count and final status witnessed by the profiler. */
  redirectCount?: number;
  finalStatus?: number;
  /** Learned read of the landing resource, checked before admitting its identity. */
  extraction?: Extraction;
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
  if (
    policy.redirectCount !== undefined &&
    (!Number.isSafeInteger(policy.redirectCount) || policy.redirectCount < 1)
  )
    throw new BindingError("invalid write-response redirect count");
  if (
    policy.finalStatus !== undefined &&
    (!Number.isSafeInteger(policy.finalStatus) ||
      policy.finalStatus < 200 ||
      policy.finalStatus >= 300)
  )
    throw new BindingError("invalid write-response final status");
  for (const error of policy.errorLocationPatterns ?? []) patternPath(error, origin);
}

/** A permalink alias must retain the learned resource route and its on-origin identity. */
export function matchesCreatedIdentity(
  pattern: string,
  location: string,
  candidate: string,
  origin: string,
): boolean {
  try {
    const created = guardUrl(location, origin);
    const item = guardUrl(candidate, origin);
    const identity = responseIdentity(created.href);
    if (item.search || !identity || responseIdentity(item.href)?.identifier !== identity.identifier)
      return false;
    return (
      patternPath(pattern, origin).test(item.pathname) ||
      created.pathname.slice(0, created.pathname.lastIndexOf("/")) === item.pathname
    );
  } catch {
    return false;
  }
}

export async function verifiedCreatedLocation(
  policy: WriteResponsePolicy | undefined,
  hops: string[],
  finalUrl: URL,
  body: string,
  origin: string,
  finalStatus?: number,
): Promise<string | undefined> {
  if (!policy || !hops.length) return undefined;
  if (
    (policy.redirectCount !== undefined && hops.length !== policy.redirectCount) ||
    (policy.finalStatus !== undefined && finalStatus !== policy.finalStatus)
  )
    return undefined;
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
  if (policy.extraction) {
    try {
      const out = await extract(policy.extraction, body, {
        baseUrl: finalUrl.href,
        redact: (value) => value,
      });
      const identity = responseIdentity(first.href);
      if (
        out.truncation.items ||
        out.truncation.values ||
        !out.items.length ||
        (identity &&
          !out.items.some((item) => {
            const ids = item.values.get(`${SCHEMA}identifier`) ?? [];
            const urls = [
              ...(item.values.get(`${SCHEMA}url`) ?? []),
              ...(item.iri ? [item.iri] : []),
            ];
            return (
              (ids.length > 0 || urls.length > 0) &&
              ids.every((id) => id === identity.identifier) &&
              urls.every((url) =>
                matchesCreatedIdentity(policy.createdLocationPattern, first.href, url, origin),
              )
            );
          }))
      )
        return undefined;
    } catch {
      return undefined;
    }
  }
  return first.href;
}
