// AUTHORED-BY Codex GPT-6.1-Sol
// Learn a read recipe from a witnessed target, never success from a demonstration flash.
import {
  createdObjectType,
  type EffectVerification,
  jsonPointer,
  learnEffectValueFormat,
  readBackIdentityMatches,
  responsePageError,
  sentInputValue,
} from "@jeswr/site-executor";
import { type Operation, SCHEMA, selectionWitnesses } from "@jeswr/site-model";
import { applyExtraction } from "./extraction.js";
import { parseForms } from "./forms.js";
import { readBackResource, safeUrl } from "./read-resource.js";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";

const identityProperties = ["object", "identifier", "sku", "productID", "orderNumber"].map(
  (key) => `${SCHEMA}${key}`,
);

/** Keep the whole resource namespace, allowing only a witnessed form to bridge distinct routes. */
function addressesResource(
  operation: Operation,
  identityInput: string,
  identity: string,
  before: RecordedRequest,
  write: RecordedRequest,
  urls: string[],
): boolean {
  const prefix = (value: string, identityAt?: number) => {
    const parts = new URL(value).pathname.split("/");
    let at = identityAt;
    if (at === undefined) {
      const labelled = parts.findIndex((part) => /^(id|identifier)$/i.test(part));
      at = labelled >= 0 ? labelled + 1 : parts.lastIndexOf(encodeURIComponent(identity));
    }
    const scope = (at >= 0 ? parts.slice(0, at) : parts).filter(Boolean);
    if (/^(?:id|identifier)$/i.test(scope.at(-1) ?? "")) scope.pop();
    if (/^(?:save|update|edit|delete|remove|massdelete)$/i.test(scope.at(-1) ?? "")) scope.pop();
    return scope;
  };
  const path =
    operation.request.urlTemplate
      .replace(/^https?:\/\/[^/]+/, "")
      .split(/[?]/)[0]
      ?.split("/") ?? [];
  const identityAt = path.indexOf(`{${identityInput}}`);
  const target = prefix(write.url, identityAt);
  const scopes = urls.map((url) => prefix(url));
  if (scopes.some((item) => JSON.stringify(item) === JSON.stringify(target))) return true;
  // A form can witness aliases such as /vote/42 and /discussions/42, but cannot
  // turn /stores/other into /stores/main within the same route namespace.
  return (
    scopes.every((item) => item[0] !== target[0]) &&
    parseForms(before.bodySample ?? "", before.url).some(
      (form) => form.method === write.method && form.action === write.url,
    )
  );
}

function good(r: RecordedRequest): boolean {
  return (
    !r.blocked &&
    !r.bodyTruncated &&
    !!r.bodySample &&
    r.status !== undefined &&
    r.status >= 200 &&
    r.status < 300 &&
    r.method === "GET" &&
    r.responsePageFailure !== true &&
    responsePageError(r.bodySample, r.contentType, false) === false
  );
}

export function learnEffectVerification(
  operation: Operation,
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): EffectVerification | undefined {
  const witnesses: EffectVerification[] = [];
  for (const write of trace.filter(
    (r) => r.phase === "demonstration" && !r.blocked && matchRequest(operation.request, r),
  )) {
    const submitted = matchRequest(operation.request, write) ?? {};
    let witness: EffectVerification | undefined;
    const selectedIdentities = selectionWitnesses(operation);
    const identities = [
      ...selectedIdentities,
      ...operation.inputs.filter(
        (p) => identityProperties.includes(p.path.at(-1) ?? "") && p.path[0] === `${SCHEMA}object`,
      ),
    ];
    for (const read of [...operations].sort(
      (a, b) =>
        a.request.urlTemplate.length - b.request.urlTemplate.length ||
        Number(a.extraction?.itemPath !== undefined) - Number(b.extraction?.itemPath !== undefined),
    )) {
      const ex = read.extraction;
      if (
        read.effect !== "read" ||
        read.request.method !== "GET" ||
        !ex ||
        (createdObjectType(operation) && ex.itemType !== createdObjectType(operation))
      )
        continue;
      for (const before of [...trace].sort((a, b) => b.seq - a.seq)) {
        if (
          !good(before) ||
          before.seq >= write.seq ||
          before.phase !== "demonstration" ||
          before.demonstration !== write.demonstration
        )
          continue;
        const values = matchRequest(read.request, before);
        if (!values || new URL(before.url).origin !== origin) continue;
        const items = applyExtraction(ex, before.bodySample ?? "", before.url);
        const trusted = applyExtraction(
          { ...ex, fields: ex.fields.filter((f) => !f.untrusted) },
          before.bodySample ?? "",
          before.url,
        );
        const item = items[0];
        const ids = trusted[0]?.[`${SCHEMA}identifier`] ?? [];
        const urls = trusted[0]?.[`${SCHEMA}url`] ?? [];
        if (
          items.length !== 1 ||
          !item ||
          !urls.length ||
          !urls.every((url) => safeUrl(url, origin))
        )
          continue;
        if (ex.format === "json" && ex.totalPath !== undefined) {
          try {
            if (jsonPointer(JSON.parse(before.bodySample ?? ""), ex.totalPath) !== 1) continue;
          } catch {
            continue;
          }
        }
        if (ids.length === 1 && ids[0]) {
          for (const p of selectedIdentities) submitted[p.name] = ids[0];
        }
        const identityValue = (name: string) =>
          selectedIdentities.some((p) => p.name === name)
            ? submitted[name]
            : sentInputValue(operation, submitted, name, origin);
        const identity = identities.find((p) => {
          const value = identityValue(p.name);
          return (
            value &&
            read.inputs.some((r) => sentInputValue(read, values, r.name, origin) === value) &&
            readBackIdentityMatches(ids, urls, value, origin, [
              readBackResource(urls, value, origin, before, trace)?.identityPattern ?? "",
            ])
          );
        });
        if (!identity) continue;
        const id = identityValue(identity.name);
        if (!id) continue;
        const resource = readBackResource(urls, id, origin, before, trace);
        if (
          !resource ||
          !addressesResource(operation, identity.name, id, before, write, [
            ...urls,
            ...[resource.identityPattern, ...(resource.identityAliases ?? [])].map((pattern) =>
              pattern.replace("{id}", encodeURIComponent(id)),
            ),
          ])
        )
          continue;
        const writePath =
          operation.request.urlTemplate
            .replace(/^https?:\/\/[^/]+/, "")
            .split("?")[0]
            ?.split("/") ?? [];
        const witnessedResource = structuredClone(resource);
        const parameterize = (pattern: string) =>
          `${origin}${pattern
            .slice(origin.length)
            .split("/")
            .map((part, at) => {
              if (part === "{id}") return part;
              const name = /^\{([A-Za-z][\w]*)\}$/.exec(writePath[at] ?? "")?.[1];
              const input = operation.inputs.find(
                (p) =>
                  p.name === name &&
                  p.location === "path" &&
                  p.name !== identity.name &&
                  sentInputValue(operation, submitted, p.name, origin) === decodeURIComponent(part),
              );
              return input ? `{context_${input.name}}` : part;
            })
            .join("/")}`;
        let displaySlug = false;
        // A numeric main-item route can expose its canonical display slug. It is
        // presentation only when the witnessed request addresses that exact prefix.
        const own = safeUrl(before.url, origin);
        const canonical = safeUrl(urls[0] ?? "", origin);
        if (
          own &&
          canonical &&
          /^\d+$/.test(id) &&
          canonical.pathname.startsWith(`${own.pathname.replace(/\/$/, "")}/`) &&
          canonical.pathname.split("/").filter(Boolean).length ===
            own.pathname.split("/").filter(Boolean).length + 1 &&
          own.pathname.replace(/\/$/, "").endsWith(`/${id}`) &&
          /^(?:-|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)$/i.test(canonical.pathname.split("/").at(-1) ?? "")
        ) {
          resource.identityPattern = `${origin}${own.pathname.replace(/\/$/, "").slice(0, -id.length)}{id}`;
          displaySlug = true;
        }
        resource.identityPattern = parameterize(resource.identityPattern);
        if (resource.identityAliases)
          resource.identityAliases = resource.identityAliases.map(parameterize);
        const bind: EffectVerification["bind"] = {};
        for (const p of read.inputs) {
          const value = values[p.name] ?? p.default;
          if (value === undefined) continue;
          const input = operation.inputs.find((input) => identityValue(input.name) === value);
          bind[p.name] = input ? { input: input.name } : { value };
        }
        if (read.inputs.some((p) => p.required && !bind[p.name])) continue;
        const changes: EffectVerification["changes"] = [];
        if (operation.actionType === `${SCHEMA}VoteAction`) {
          const nextWrite = Math.min(
            ...trace
              .filter(
                (r) =>
                  r.seq > write.seq && !r.blocked && !["GET", "HEAD", "OPTIONS"].includes(r.method),
              )
              .map((r) => r.seq),
          );
          const after = trace.find(
            (r) =>
              r.seq > write.seq &&
              r.seq < nextWrite &&
              good(r) &&
              r.url === before.url &&
              r.demonstration === write.demonstration &&
              JSON.stringify(r.requestHeaders) === JSON.stringify(before.requestHeaders),
          );
          if (after) {
            const afterItems = applyExtraction(ex, after.bodySample ?? "", after.url);
            for (const p of operation.inputs.filter(
              (p) => !identities.includes(p) && p.location !== "path",
            )) {
              const sent = sentInputValue(operation, submitted, p.name, origin);
              if (!sent || !/^[+-]?\d+$/.test(sent) || BigInt(sent) === 0n) continue;
              const property = ex.fields.find(
                (f) =>
                  !f.untrusted &&
                  item[f.property]?.length === 1 &&
                  afterItems.length === 1 &&
                  afterItems[0]?.[f.property]?.length === 1 &&
                  /^[+-]?\d+$/.test(item[f.property]?.[0] ?? "") &&
                  /^[+-]?\d+$/.test(afterItems[0]?.[f.property]?.[0] ?? "") &&
                  BigInt(afterItems[0]?.[f.property]?.[0] ?? "0") -
                    BigInt(item[f.property]?.[0] ?? "0") ===
                    BigInt(sent),
              )?.property;
              if (property) changes.push({ input: p.name, property, mode: "delta" });
            }
          }
        } else {
          for (const p of operation.inputs.filter(
            (p) => !identities.includes(p) && p.location !== "path",
          )) {
            const property = p.path.at(-1);
            if (
              property &&
              item[property]?.length === 1 &&
              sentInputValue(operation, submitted, p.name, origin) !== undefined
            ) {
              const submittedValue = sentInputValue(operation, submitted, p.name, origin);
              let format: EffectVerification["changes"][number]["format"];
              if (submittedValue && /#(?:decimal|integer)$/.test(p.range)) {
                for (const follow of trace) {
                  if (
                    follow.seq <= write.seq ||
                    !good(follow) ||
                    follow.demonstration !== write.demonstration ||
                    !matchRequest(read.request, follow)
                  )
                    continue;
                  const observed = applyExtraction(ex, follow.bodySample ?? "", follow.url);
                  const trustedFollow = applyExtraction(
                    { ...ex, fields: ex.fields.filter((f) => !f.untrusted) },
                    follow.bodySample ?? "",
                    follow.url,
                  );
                  if (
                    observed.length !== 1 ||
                    observed[0]?.[property]?.length !== 1 ||
                    !readBackIdentityMatches(
                      trustedFollow[0]?.[`${SCHEMA}identifier`] ?? [],
                      trustedFollow[0]?.[`${SCHEMA}url`] ?? [],
                      id,
                      origin,
                      [
                        witnessedResource.identityPattern,
                        ...(witnessedResource.identityAliases ?? []),
                      ],
                    )
                  )
                    continue;
                  format = learnEffectValueFormat(
                    submittedValue,
                    observed[0]?.[property]?.[0] ?? "",
                  );
                  if (format) break;
                }
              }
              changes.push({ input: p.name, property, ...(format ? { format } : {}) });
            }
          }
        }
        if (operation.actionType !== `${SCHEMA}DeleteAction` && !changes.length) continue;
        witness = {
          operation: read.id,
          bind,
          identityInput: identity.name,
          ...resource,
          changes,
          ...(displaySlug ? { displaySlug: true } : {}),
        };
        break;
      }
      if (witness) break;
    }
    if (!witness) return;
    witnesses.push(witness);
  }
  return witnesses.length &&
    witnesses.every((p) => JSON.stringify(p) === JSON.stringify(witnesses[0]))
    ? witnesses[0]
    : undefined;
}
