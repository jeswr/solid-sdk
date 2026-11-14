// AUTHORED-BY Codex GPT-6.1-Sol
// Learn nonstandard row permalinks from a witnessed creation, never from an ID alone.
import {
  createdObjectType,
  jsonPointer,
  responsePageError,
  sentInputValue,
} from "@jeswr/site-executor";
import { type Operation, responseIdentity, SCHEMA } from "@jeswr/site-model";
import { applyExtraction } from "./extraction.js";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";

function identityUrl(value: string, origin: string): URL | undefined {
  try {
    const url = new URL(value, origin);
    if (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/\[redacted\]|[{}]/i.test(decodeURIComponent(url.href)) &&
      responseIdentity(url.href)
    )
      return url;
  } catch {
    // Invalid or secret-bearing URLs cannot become identities.
  }
  return;
}

/** The whole resource prefix must agree; only trailing editor context may be omitted. */
function sameResource(link: URL, landing: URL, identity: string): boolean {
  if (link.href === landing.href) return true;
  const parts = landing.pathname.split("/");
  const label = parts.findIndex((part) => /^(id|identifier)$/i.test(part));
  if (label < 0 || decodeURIComponent(parts[label + 1] ?? "") !== identity) return false;
  return link.pathname.replace(/\/$/, "") === parts.slice(0, label + 2).join("/");
}

/** Add only a link field witnessed on a subsequent singleton identity read. */
export function learnIdentityLinks(
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): void {
  const bySequence = new Map(trace.map((entry) => [entry.seq, entry]));
  const creations = operations.filter(
    (op) => op.provenance.method === "demonstration" && op.actionType === `${SCHEMA}CreateAction`,
  );
  for (const read of operations) {
    const ex = read.extraction;
    if (
      read.effect !== "read" ||
      read.request.method !== "GET" ||
      ex?.format !== "json" ||
      ex.fields.some((field) => field.property === `${SCHEMA}url`)
    )
      continue;
    const paths = new Set<string>();
    for (const landing of trace) {
      if (landing.redirectedFrom === undefined) continue;
      const write = bySequence.get(landing.redirectedFrom);
      const operation = write && creations.find((op) => matchRequest(op.request, write));
      const destination = identityUrl(landing.url, origin);
      const identity = destination && responseIdentity(destination.href)?.identifier;
      if (
        !write ||
        write.blocked ||
        write.phase !== "demonstration" ||
        operation?.provenance.method !== "demonstration" ||
        operation.actionType !== `${SCHEMA}CreateAction` ||
        createdObjectType(operation) !== ex.itemType ||
        ![301, 302, 303].includes(write.status ?? 0) ||
        write.redirectedTo !== landing.url ||
        landing.phase !== "demonstration" ||
        landing.demonstration !== write.demonstration ||
        landing.method !== "GET" ||
        landing.blocked ||
        landing.status === undefined ||
        landing.status < 200 ||
        landing.status >= 300 ||
        !landing.bodySample ||
        landing.responsePageError === true ||
        (landing.bodyTruncated && landing.responsePageError !== false) ||
        responsePageError(landing.bodySample ?? "", landing.contentType) ||
        landing.responseFlash?.length ||
        !destination ||
        !identity
      )
        continue;
      for (const follow of trace) {
        if (
          follow.seq <= landing.seq ||
          follow.blocked ||
          follow.bodyTruncated ||
          follow.status === undefined ||
          follow.status < 200 ||
          follow.status >= 300 ||
          !follow.bodySample ||
          !(
            follow.phase === "crawl" ||
            (follow.phase === "demonstration" && follow.demonstration === write.demonstration)
          ) ||
          follow.responsePageError === true ||
          responsePageError(follow.bodySample, follow.contentType)
        )
          continue;
        const values = matchRequest(read.request, follow);
        if (
          !values ||
          new URL(follow.url).origin !== origin ||
          !read.inputs.some((p) => sentInputValue(read, values, p.name, origin) === identity)
        )
          continue;
        if (ex.totalPath !== undefined) {
          try {
            if (jsonPointer(JSON.parse(follow.bodySample), ex.totalPath) !== 1) continue;
          } catch {
            continue;
          }
        }
        const items = applyExtraction(ex, follow.bodySample, follow.url);
        const trusted = applyExtraction(
          { ...ex, fields: ex.fields.filter((f) => !f.untrusted) },
          follow.bodySample,
          follow.url,
        );
        const ids = trusted[0]?.[`${SCHEMA}identifier`] ?? [];
        if (items.length !== 1 || !ids.length || !ids.every((id) => id === identity)) continue;
        const submitted = matchRequest(operation.request, write) ?? {};
        if (
          !operation.inputs.some((p) => {
            const value = sentInputValue(operation, submitted, p.name, origin);
            return (
              p.path.length &&
              value &&
              !value.includes("[redacted]") &&
              Object.values(items[0] ?? {}).some(
                (claims) => claims.length === 1 && claims[0] === value,
              )
            );
          })
        )
          continue;
        for (const field of ex.fields) {
          // A link-shaped field name and a witnessed route supply independent evidence.
          if (
            !field.untrusted ||
            !/(?:^|[_-])(?:link|url|href)$/i.test(field.path.split("/").at(-1) ?? "")
          )
            continue;
          const claims = items[0]?.[field.property];
          const link = claims?.length === 1 && identityUrl(claims[0] ?? "", origin);
          if (link && sameResource(link, destination, identity)) paths.add(field.path);
        }
      }
    }
    if (paths.size !== 1) continue;
    read.extraction = {
      ...ex,
      idField: `${SCHEMA}url`,
      fields: [
        ...ex.fields,
        { property: `${SCHEMA}url`, path: [...paths][0] as string, datatype: "iri" },
      ],
    };
  }
}
