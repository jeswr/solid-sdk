// AUTHORED-BY Codex GPT-6.1-Sol
// Response policies come only from complete, causally linked demonstration traffic.
import {
  type ExecutorOptions,
  matchesCreatedIdentity,
  type WriteResponsePolicy,
} from "@jeswr/site-executor";
import { type Operation, responseIdentity, SCHEMA } from "@jeswr/site-model";
import { applyExtraction } from "./extraction.js";
import { responsePageError } from "./response-evidence.js";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";

function safeUrl(value: string, origin: string): URL | undefined {
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

function failedPage(r: RecordedRequest): boolean {
  if (
    r.blocked ||
    (r.bodyTruncated && r.responsePageError === undefined) ||
    r.status === undefined ||
    r.status < 200 ||
    r.status >= 400
  )
    return true;
  if (r.responsePageError !== undefined) return r.responsePageError;
  return responsePageError(r.bodySample ?? "", r.contentType);
}

/** Only declared whole path inputs and the response identity can become slots. */
function locationPattern(
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

export function learnWriteResponses(
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): NonNullable<ExecutorOptions["writeResponses"]> {
  const policies: NonNullable<ExecutorOptions["writeResponses"]> = {};
  for (const op of operations) {
    if (op.effect === "read" || op.provenance.method !== "demonstration") continue;
    const witnesses: WriteResponsePolicy[] = [];
    let rejected = false;
    for (const write of trace.filter(
      (r) => r.phase === "demonstration" && matchRequest(op.request, r),
    )) {
      if (!write.redirectedTo) continue;
      const chain = [write];
      let current = write;
      const seen = new Set([write.seq]);
      while (current.redirectedTo && [301, 302, 303].includes(current.status ?? 0)) {
        const destination = safeUrl(current.redirectedTo, origin);
        const children = trace.filter((r) => r.redirectedFrom === current.seq);
        const next = children[0];
        if (
          !destination ||
          children.length !== 1 ||
          !next ||
          seen.has(next.seq) ||
          next.method !== "GET" ||
          next.phase !== "demonstration" ||
          next.demonstration !== write.demonstration ||
          next.url !== destination.href
        )
          break;
        seen.add(next.seq);
        chain.push(next);
        current = next;
      }
      const first = safeUrl(write.redirectedTo, origin);
      const final = safeUrl(current.url, origin);
      if (
        new URL(write.url).origin !== origin ||
        !first ||
        !final ||
        chain.length < 2 ||
        current.redirectedTo ||
        current.status === undefined ||
        current.status < 200 ||
        current.status >= 300 ||
        !current.bodySample ||
        chain.some(failedPage) ||
        chain.slice(1).some((r) => safeUrl(r.url, origin)?.pathname !== first.pathname)
      ) {
        rejected = true;
        continue;
      }
      const identity = responseIdentity(first.href);
      const reads = operations.filter(
        (read) => read.effect === "read" && read.extraction && matchRequest(read.request, current),
      );
      const itemReads = identity
        ? reads.filter((read) =>
            read.extraction?.fields.some(
              (f) => !f.untrusted && [`${SCHEMA}identifier`, `${SCHEMA}url`].includes(f.property),
            ),
          )
        : reads;
      const read = itemReads.find((read) => {
        const ex = read.extraction;
        if (!ex) return false;
        const items = applyExtraction(
          { ...ex, fields: ex.fields.filter((f) => !f.untrusted) },
          current.bodySample ?? "",
          current.url,
        );
        return identity
          ? items.some((item) => {
              const ids = item[`${SCHEMA}identifier`] ?? [];
              const urls = item[`${SCHEMA}url`] ?? [];
              const pattern = locationPattern(first, read, current);
              return (
                pattern &&
                (ids.length > 0 || urls.length > 0) &&
                ids.every((id) => id === identity.identifier) &&
                urls.every((url) => matchesCreatedIdentity(pattern, first.href, url, origin))
              );
            })
          : items.some((item) => Object.keys(item).length);
      });
      // A learned item read must actually contain the redirected identity. With no
      // item read (e.g. JS-rendered admin form), status and exact route are the evidence.
      if ((itemReads.length && !read) || (!identity && !read)) {
        rejected = true;
        continue;
      }
      const pattern = locationPattern(first, read ?? reads[0], current);
      if (!pattern) {
        rejected = true;
        continue;
      }
      const policy: WriteResponsePolicy = {
        createdLocationPattern: pattern,
        redirectCount: chain.length - 1,
        finalStatus: current.status,
      };
      if (read?.extraction) policy.extraction = structuredClone(read.extraction);
      witnesses.push(policy);
    }
    // Conflicting or incomplete demonstrations never widen a policy.
    if (
      !rejected &&
      witnesses.length &&
      witnesses.every((p) => JSON.stringify(p) === JSON.stringify(witnesses[0]))
    )
      policies[op.id] = witnesses[0] as WriteResponsePolicy;
  }
  return policies;
}
