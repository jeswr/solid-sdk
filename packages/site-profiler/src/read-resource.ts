// AUTHORED-BY Codex GPT-6.1-Sol
// Witnessed resource templates shared by creation and existing-item verification.
import type { WriteResponsePolicy } from "@jeswr/site-executor";
import { type Operation, responseIdentity } from "@jeswr/site-model";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";

export function safeUrl(value: string, origin: string): URL | undefined {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return;
    if (/\[redacted\]|[{}]/i.test(decodeURIComponent(url.href))) return;
    // Error routes are evidence against success even when they return HTTP 200.
    if (
      url.pathname
        .split("/")
        .some((p) => /^(?:errors?|validation|invalid|login|sign[-_]?in)$/i.test(p))
    )
      return;
    return url;
  } catch {
    return;
  }
}

/** Slot only the identity, retaining literal resource, tenant and store prefixes. */
export function readBackResource(
  urls: readonly string[],
  identity: string,
  origin: string,
  follow: RecordedRequest,
  trace: readonly RecordedRequest[],
):
  | Pick<NonNullable<WriteResponsePolicy["readBack"]>, "identityPattern" | "identityAliases">
  | undefined {
  if (!urls.length) return;
  const patterns = new Set<string>();
  const add = (value: string): boolean => {
    const url = safeUrl(value, origin);
    if (!url || responseIdentity(url.href)?.identifier !== identity) return false;
    const pattern = locationPattern(url, undefined, follow);
    if (!pattern?.includes("{id}")) return false;
    patterns.add(`${origin}${pattern}`);
    return true;
  };
  if (!urls.every(add)) return;
  // Recorder-linked GET redirects witness aliases; equal numeric suffixes do not.
  let child = follow;
  const seen = new Set<number>();
  while (child.redirectedFrom !== undefined && !seen.has(child.seq)) {
    seen.add(child.seq);
    const parent = trace.find((r) => r.seq === child.redirectedFrom);
    const childUrl = safeUrl(child.url, origin);
    if (
      !parent ||
      parent.blocked ||
      parent.method !== "GET" ||
      ![301, 302, 303].includes(parent.status ?? 0) ||
      parent.redirectedTo !== child.url ||
      !childUrl ||
      !patterns.has(`${origin}${locationPattern(childUrl, undefined, child)}`) ||
      !add(parent.url)
    )
      break;
    child = parent;
  }
  const [identityPattern, ...identityAliases] = [...patterns];
  return identityPattern
    ? { identityPattern, ...(identityAliases.length ? { identityAliases } : {}) }
    : undefined;
}

/** Only declared whole path inputs and the response identity can become slots. */
export function locationPattern(
  url: URL,
  read: Operation | undefined,
  request: RecordedRequest,
): string | undefined {
  const parts = url.pathname.split("/");
  const template = read?.request.urlTemplate.replace(/\{[?&][^}]*\}.*$/, "").split("?")[0];
  const declared = new Set(read?.inputs.filter((p) => p.location === "path").map((p) => p.name));
  if (template && read && matchRequest(read.request, request)) {
    const path = template.replace(/^https?:\/\/[^/]+/, "").split("/");
    if (path.length === parts.length) {
      for (let i = 0; i < parts.length; i++) {
        const name = /^\{([A-Za-z][\w]*)\}$/.exec(path[i] ?? "")?.[1];
        if (name && declared.has(name)) parts[i] = `{${name}}`;
      }
    }
  }
  const identity = responseIdentity(url.href);
  if (identity) {
    const segments = url.pathname.split("/").map((p) => decodeURIComponent(p));
    const labelled = segments.findIndex((p) => /^(id|identifier)$/i.test(p));
    const at = labelled >= 0 ? labelled + 1 : segments.lastIndexOf(identity.identifier);
    if (at < 0) return;
    parts[at] = "{id}";
  }
  return parts.join("/");
}
