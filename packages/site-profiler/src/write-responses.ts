// AUTHORED-BY Codex GPT-6.1-Sol
// Response policies come only from complete, causally linked demonstration traffic.
import {
  createdObjectType,
  type ExecutorOptions,
  jsonPointer,
  landingItemValues,
  matchesCreatedIdentity,
  readBackIdentityMatches,
  responseFlash,
  sentInputValue,
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

function failedPage(r: RecordedRequest, completionOnly = false): boolean {
  if (
    r.blocked ||
    (r.bodyTruncated &&
      (completionOnly
        ? r.responsePageFailure === undefined || r.responseFlash === undefined
        : r.responsePageError === undefined)) ||
    r.status === undefined ||
    r.status < 200 ||
    r.status >= 400
  )
    return true;
  if (completionOnly)
    return r.responsePageFailure ?? responsePageError(r.bodySample ?? "", r.contentType, false);
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
  learnedOperations: readonly Operation[] = operations,
): NonNullable<ExecutorOptions["writeResponses"]> {
  const policies: NonNullable<ExecutorOptions["writeResponses"]> = {};
  for (const op of operations) {
    if (op.effect === "read" || op.provenance.method !== "demonstration") continue;
    const completionOnly = ["UpdateAction", "DeleteAction", "VoteAction"].some(
      (type) => op.actionType === `${SCHEMA}${type}`,
    );
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
        chain.some((r) => failedPage(r, completionOnly)) ||
        chain.slice(1).some((r) => safeUrl(r.url, origin)?.pathname !== first.pathname)
      ) {
        rejected = true;
        continue;
      }
      const identity = responseIdentity(first.href);
      const reads = operations.filter(
        (read) => read.effect === "read" && read.extraction && matchRequest(read.request, current),
      );
      const submitted = matchRequest(op.request, write) ?? {};
      let inputEvidence: WriteResponsePolicy["inputEvidence"];
      const read = reads.find((read) => {
        const ex = read.extraction;
        if (!ex) return false;
        if (completionOnly) return true;
        if (!identity || ex.itemType !== createdObjectType(op)) return false;
        const main = landingItemValues(ex, current.bodySample ?? "");
        if (!main) return false;
        const items = applyExtraction(
          { ...ex, fields: ex.fields.filter((f) => !f.untrusted) },
          current.bodySample ?? "",
          current.url,
        );
        const item = items[0];
        const pattern = locationPattern(first, read, current);
        if (items.length !== 1 || !item || !pattern) return false;
        const ids = item[`${SCHEMA}identifier`] ?? [];
        const urls = item[`${SCHEMA}url`] ?? [];
        if (
          !(ids.length || urls.length) ||
          !ids.every((id) => id === identity.identifier) ||
          !urls.every((url) => matchesCreatedIdentity(pattern, first.href, url, origin))
        )
          return false;
        // Only a declared, submitted input that is actually sent can prove success.
        for (const p of op.inputs) {
          const value = sentInputValue(op, submitted, p.name, origin);
          if (!value || value.includes("[redacted]") || !p.path.length) continue;
          const property = [...main].find(
            ([, values]) => values.length === 1 && values[0] === value,
          )?.[0];
          if (property) {
            inputEvidence = { input: p.name, property };
            return true;
          }
        }
        return false;
      });
      // A script-only landing can use a learned, witnessed identity read instead.
      let readBack: WriteResponsePolicy["readBack"];
      if (!completionOnly && !read && !reads.length && identity) {
        outer: for (const candidate of learnedOperations) {
          const ex = candidate.extraction;
          if (
            candidate.effect !== "read" ||
            candidate.request.method !== "GET" ||
            !ex ||
            ex.itemType !== createdObjectType(op)
          )
            continue;
          for (const follow of trace) {
            if (
              follow.seq <= current.seq ||
              follow.blocked ||
              follow.bodyTruncated ||
              follow.status === undefined ||
              follow.status < 200 ||
              follow.status >= 300 ||
              !follow.bodySample ||
              failedPage(follow) ||
              !(
                follow.phase === "crawl" ||
                (follow.phase === "demonstration" && follow.demonstration === write.demonstration)
              )
            )
              continue;
            const values = matchRequest(candidate.request, follow);
            if (!values || new URL(follow.url).origin !== origin) continue;
            if (ex.format === "json" && ex.totalPath !== undefined) {
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
            const item = items[0];
            const ids = trusted[0]?.[`${SCHEMA}identifier`] ?? [];
            if (
              items.length !== 1 ||
              !item ||
              !readBackIdentityMatches(
                ids,
                trusted[0]?.[`${SCHEMA}url`] ?? [],
                identity.identifier,
                origin,
              ) ||
              Object.values(item).some((vs) => vs.length > 100 || vs.some((v) => v.length > 4000))
            )
              continue;
            const bind: NonNullable<WriteResponsePolicy["readBack"]>["bind"] = {};
            let hasIdentity = false;
            for (const p of candidate.inputs) {
              const value = values[p.name] ?? p.default;
              if (value === undefined) continue;
              if (
                value === identity.identifier &&
                sentInputValue(candidate, values, p.name, origin) === value
              ) {
                bind[p.name] = { identity: true };
                hasIdentity = true;
              } else {
                const input = op.inputs.find(
                  (input) => sentInputValue(op, submitted, input.name, origin) === value,
                );
                bind[p.name] = input ? { input: input.name } : { value };
              }
            }
            if (!hasIdentity || candidate.inputs.some((p) => p.required && !bind[p.name])) continue;
            for (const p of op.inputs) {
              const value = sentInputValue(op, submitted, p.name, origin);
              if (!p.path.length || !value || value.includes("[redacted]")) continue;
              const property = Object.keys(item).find(
                (property) => item[property]?.length === 1 && item[property]?.[0] === value,
              );
              if (property) {
                inputEvidence = { input: p.name, property };
                readBack = { operation: candidate.id, bind };
                break outer;
              }
            }
          }
        }
      }
      if (!completionOnly && ((!read && !readBack) || !inputEvidence)) {
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
        ...(completionOnly ? { completionOnly: true } : { inputEvidence }),
      };
      if (read?.extraction) policy.extraction = structuredClone(read.extraction);
      if (readBack) policy.readBack = readBack;
      const flashes =
        current.responseFlash ?? responseFlash(current.bodySample, current.contentType);
      if (completionOnly && flashes.length) policy.successFlash = flashes;
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
