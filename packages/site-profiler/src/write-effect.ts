// AUTHORED-BY Codex GPT-6.1-Sol
// Flash equality cannot establish that its initial demonstration succeeded.
import {
  createdObjectType,
  jsonPointer,
  responsePageError,
  sentInputValue,
} from "@jeswr/site-executor";
import { type Operation, responseIdentity, SCHEMA } from "@jeswr/site-model";
import { applyExtraction } from "./extraction.js";
import { parseForms } from "./forms.js";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";

/** A detail that was present before this exact form submission is now gone. */
function witnessedDetailDeleted(
  read: Operation,
  write: RecordedRequest,
  landing: RecordedRequest,
  trace: readonly RecordedRequest[],
  targets: readonly string[],
  nextWrite: number,
  origin: string,
): boolean {
  const ex = read.extraction;
  if (!ex || ex.itemPath !== undefined) return false;
  const previousWrite = Math.max(
    ...trace
      .filter(
        (r) => r.seq < write.seq && !r.blocked && !["GET", "HEAD", "OPTIONS"].includes(r.method),
      )
      .map((r) => r.seq),
  );
  for (const before of trace) {
    if (
      before.seq <= previousWrite ||
      before.seq >= write.seq ||
      before.phase !== "demonstration" ||
      before.demonstration !== write.demonstration ||
      before.method !== "GET" ||
      before.blocked ||
      before.bodyTruncated ||
      before.status === undefined ||
      before.status < 200 ||
      before.status >= 300 ||
      !before.bodySample ||
      before.responsePageError === true ||
      responsePageError(before.bodySample, before.contentType, false)
    )
      continue;
    const url = new URL(before.url);
    const values = matchRequest(read.request, before);
    if (
      !values ||
      url.origin !== origin ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      !targets.every((value) =>
        read.inputs.some((p) => sentInputValue(read, values, p.name, origin) === value),
      ) ||
      !parseForms(before.bodySample, before.url).some(
        (form) => form.method === write.method && form.action === write.url,
      )
    )
      continue;
    const items = applyExtraction(
      { ...ex, fields: ex.fields.filter((f) => !f.untrusted) },
      before.bodySample,
      before.url,
    );
    const urls = items[0]?.[`${SCHEMA}url`] ?? [];
    if (items.length !== 1 || !urls.length || !urls.every((claim) => claim === url.href)) continue;
    if (
      trace.some(
        (after) =>
          after.seq >= landing.seq &&
          after.seq < nextWrite &&
          (after.phase === "crawl" ||
            (after.phase === "demonstration" && after.demonstration === write.demonstration)) &&
          after.method === "GET" &&
          !after.blocked &&
          !after.bodyTruncated &&
          !after.redirectedTo &&
          after.url === url.href &&
          [404, 410].includes(after.status ?? 0),
      )
    )
      return true;
  }
  return false;
}

export function demonstratedEffectVerified(
  operation: Operation,
  write: RecordedRequest,
  landing: RecordedRequest,
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): boolean {
  const deletion = operation.actionType === `${SCHEMA}DeleteAction`;
  if (!deletion && operation.actionType !== `${SCHEMA}UpdateAction`) return false;
  const submitted = matchRequest(operation.request, write);
  if (!submitted) return false;
  const sent = operation.inputs.flatMap((p) => {
    const value = sentInputValue(operation, submitted, p.name, origin);
    return value && p.path.length && !value.includes("[redacted]") ? [{ p, value }] : [];
  });
  const identities = sent.filter(({ p }) =>
    ["object", "identifier", "sku", "productID", "orderNumber"].some(
      (key) => p.path.at(-1) === `${SCHEMA}${key}`,
    ),
  );
  const targets = identities.length ? identities : deletion ? sent : [];
  if (!targets.length) return false;
  const changes = sent.filter((entry) => !identities.includes(entry));
  if (!deletion && !changes.length) return false;
  const nextWrite = Math.min(
    ...trace
      .filter(
        (r) => r.seq > write.seq && !r.blocked && !["GET", "HEAD", "OPTIONS"].includes(r.method),
      )
      .map((r) => r.seq),
  );
  for (const read of operations) {
    const ex = read.extraction;
    if (read.effect !== "read" || read.request.method !== "GET" || !ex) continue;
    // Endpoint words need not name the resource type (for example a forum's /f/ route).
    // The witnessed main item, its own permalink and the actual form establish it.
    if (
      deletion &&
      witnessedDetailDeleted(
        read,
        write,
        landing,
        trace,
        [
          ...new Set([
            ...targets.map(({ value }) => value),
            ...sent.filter(({ p }) => p.location === "path").map(({ value }) => value),
          ]),
        ],
        nextWrite,
        origin,
      )
    )
      return true;
    if (ex.itemType !== createdObjectType(operation)) continue;
    for (const follow of trace) {
      if (
        follow.seq < landing.seq ||
        follow.seq >= nextWrite ||
        follow.blocked ||
        follow.bodyTruncated ||
        follow.method !== "GET" ||
        follow.status === undefined ||
        follow.status < 200 ||
        follow.status >= 300 ||
        !follow.bodySample ||
        (follow.phase !== "crawl" &&
          !(follow.phase === "demonstration" && follow.demonstration === write.demonstration)) ||
        new URL(follow.url).origin !== origin ||
        follow.responsePageError === true ||
        responsePageError(follow.bodySample, follow.contentType, false)
      )
        continue;
      const values = matchRequest(read.request, follow);
      // The read must address the demonstrated identity/filter, not an unrelated list.
      if (
        !values ||
        !targets.every(({ value }) =>
          read.inputs.some((p) => sentInputValue(read, values, p.name, origin) === value),
        )
      )
        continue;
      if (deletion) {
        // Only an explicit, successful empty JSON collection proves absence here.
        // Zero HTML selector matches and missing roots cannot establish deletion.
        if (ex.format !== "json" || ex.itemPath === undefined) continue;
        try {
          const doc: unknown = JSON.parse(follow.bodySample);
          const items = jsonPointer(doc, ex.itemPath);
          if (
            Array.isArray(items) &&
            items.length === 0 &&
            (ex.totalPath === undefined || jsonPointer(doc, ex.totalPath) === 0)
          )
            return true;
        } catch {
          /* Invalid reads provide no success evidence. */
        }
      } else {
        const items = applyExtraction(ex, follow.bodySample, follow.url);
        const item = items[0];
        if (
          items.length !== 1 ||
          !item ||
          Object.values(item).some((vs) => vs.length > 100 || vs.some((v) => v.length > 4000))
        )
          continue;
        if (ex.format === "json" && ex.totalPath !== undefined) {
          try {
            if (jsonPointer(JSON.parse(follow.bodySample), ex.totalPath) !== 1) continue;
          } catch {
            continue;
          }
        }
        const trusted = applyExtraction(
          { ...ex, fields: ex.fields.filter((f) => !f.untrusted) },
          follow.bodySample,
          follow.url,
        )[0];
        if (
          !identities.every(({ p, value }) => {
            const key =
              p.path.at(-1) === `${SCHEMA}object` ? `${SCHEMA}identifier` : (p.path.at(-1) ?? "");
            const claims = trusted?.[key] ?? [];
            const urls = trusted?.[`${SCHEMA}url`] ?? [];
            return (
              (claims.length > 0 || urls.length > 0) &&
              claims.every((claim) => claim === value) &&
              urls.every((url) => responseIdentity(url)?.identifier === value)
            );
          })
        )
          continue;
        if (
          changes.every(({ p, value }) => {
            const observed = item[p.path.at(-1) ?? ""];
            return observed?.length === 1 && observed[0] === value;
          })
        )
          return true;
      }
    }
  }
  return false;
}
