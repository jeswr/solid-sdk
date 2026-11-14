// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// Learn a read recipe from a witnessed target, never success from a demonstration flash.
import {
  compileOperation,
  createdObjectType,
  type EffectVerification,
  effectValueEquals,
  exactIdentityFilter,
  isScopeField,
  jsonPointer,
  notFoundSignature,
  readBackIdentityMatches,
  readOnlyScopeConstants,
  responsePageError,
  sentInputValue,
  submittedStateInputs,
  verificationScopeMatches,
} from "@jeswr/site-executor";
import {
  isExecutorOwnedHeader,
  type Operation,
  SCHEMA,
  selectionWitnesses,
} from "@jeswr/site-model";
import { leafKey, pairSubmittedField, pairSubmittedValue } from "./effect-pairing.js";
import { isCsrfFieldName, parseForms } from "./forms.js";
import { readBackResource, safeUrl } from "./read-resource.js";
import { matchRequest, requestValues } from "./templates.js";
import type { RecordedRequest } from "./types.js";
import { verificationCollection, verificationItems } from "./verification-evidence.js";

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
    ((!r.bodyTruncated && !!r.bodySample) || !!r.verificationEvidence) &&
    r.status !== undefined &&
    r.status >= 200 &&
    r.status < 300 &&
    r.method === "GET" &&
    r.responsePageFailure !== true &&
    (!!r.verificationEvidence ||
      !r.bodySample ||
      responsePageError(r.bodySample, r.contentType, false) === false)
  );
}

function sameHeaders(a: RecordedRequest, b: RecordedRequest, operation: Operation): boolean {
  const normalized = (r: RecordedRequest) =>
    Object.entries(r.requestHeaders)
      .filter(
        ([name]) =>
          !isExecutorOwnedHeader(name) &&
          !operation.csrf?.some(
            (rule) =>
              rule.target.kind === "header" &&
              rule.target.name.toLowerCase() === name.toLowerCase(),
          ),
      )
      .map(([name, value]) => [name.toLowerCase(), value])
      .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""));
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

export function learnEffectVerification(
  operation: Operation,
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
  onWitness?: (write: RecordedRequest, before: RecordedRequest) => void,
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
        (b.extraction?.fields.length ?? 0) - (a.extraction?.fields.length ?? 0) ||
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
          (before.seq >= write.seq && before.resourceType !== "verification-evidence") ||
          (before.phase !== "demonstration" && before.resourceType !== "verification-evidence") ||
          before.demonstration !== write.demonstration
        )
          continue;
        if (
          before.authenticationContext &&
          write.authenticationContext &&
          before.authenticationContext !== write.authenticationContext
        )
          continue;
        const values = matchRequest(read.request, before);
        if (!values || new URL(before.url).origin !== origin) continue;
        // Inventory witnessed selectors too: an undeclared request header cannot disappear
        // merely because template matching only extracts parameter values.
        const concrete = (op: Operation, inputs: Record<string, string>, r: RecordedRequest) => {
          const compiled = compileOperation(op, inputs, origin);
          const headers = new Headers(r.requestHeaders);
          const observed = {
            ...compiled,
            url: new URL(r.url),
            headers: Object.fromEntries(headers),
            modelHeaders: [...headers.keys()],
          };
          if (!verificationScopeMatches(compiled, op, observed, op))
            throw new Error("witnessed scope is absent from the learned request");
          return observed;
        };

        const items = verificationItems(before, ex);
        const trusted = verificationItems(before, ex, true);
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
            if (
              (before.verificationEvidence?.total ??
                jsonPointer(JSON.parse(before.bodySample ?? ""), ex.totalPath)) !== 1
            )
              continue;
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
        const bind: EffectVerification["bind"] = {};
        for (const p of read.inputs) {
          const value = values[p.name] ?? p.default;
          if (value === undefined) continue;
          const matches = operation.inputs.filter((input) => identityValue(input.name) === value);
          const input =
            matches.find((input) => input.name === p.name) ??
            (matches.length === 1 ? matches[0] : undefined);
          bind[p.name] = input ? { input: input.name } : { value };
        }
        if (read.inputs.some((p) => p.required && !bind[p.name])) continue;
        let scopeConstants: EffectVerification["scopeConstants"];
        try {
          const compiledWrite = concrete(operation, submitted, write);
          const compiledRead = concrete(read, values, before);
          scopeConstants = readOnlyScopeConstants(compiledWrite, compiledRead, read);
          if (
            !verificationScopeMatches(
              compiledWrite,
              operation,
              compiledRead,
              read,
              scopeConstants,
              bind,
            )
          )
            continue;
        } catch {
          continue;
        }
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
        const nextWrite = Math.min(
          ...trace
            .filter(
              (r) =>
                r.seq > write.seq && !r.blocked && !["GET", "HEAD", "OPTIONS"].includes(r.method),
            )
            .map((r) => r.seq),
        );
        // A template witness may use another search/filter tuple. Other selectors,
        // headers and whole path context remain bound to this demonstrated read.
        const sameReadContext = (r: RecordedRequest) => {
          const inputs = matchRequest(read.request, r);
          if (
            !inputs ||
            new URL(r.url).pathname !== new URL(before.url).pathname ||
            !sameHeaders(before, r, read)
          )
            return false;
          if (
            r.authenticationContext &&
            write.authenticationContext &&
            r.authenticationContext !== write.authenticationContext
          )
            return false;
          const withoutFilters = (sample: RecordedRequest, inputs: Record<string, string>) => {
            const compiled = concrete(read, inputs, sample);
            const url = new URL(compiled.url);
            for (const name of [...url.searchParams.keys()]) {
              if (
                !isScopeField(name) &&
                /^(?:filters?(?:\[|$)|search$|q$|query$|keyword(?:Updated)?$)/i.test(name)
              )
                url.searchParams.delete(name);
            }
            return { ...compiled, url };
          };
          try {
            return verificationScopeMatches(
              withoutFilters(before, values),
              read,
              withoutFilters(r, inputs),
              read,
            );
          } catch {
            return false;
          }
        };
        const targetItem = (r: RecordedRequest) => {
          if (!good(r) || !sameReadContext(r) || r.demonstration !== write.demonstration) return;
          const observed = verificationItems(r, ex);
          const trusted = verificationItems(r, ex, true);
          if (
            observed.length !== 1 ||
            !readBackIdentityMatches(
              trusted[0]?.[`${SCHEMA}identifier`] ?? [],
              trusted[0]?.[`${SCHEMA}url`] ?? [],
              id,
              origin,
              [witnessedResource.identityPattern, ...(witnessedResource.identityAliases ?? [])],
            )
          )
            return;
          if (ex.format === "json" && ex.totalPath !== undefined) {
            try {
              if (
                (r.verificationEvidence?.total ??
                  jsonPointer(JSON.parse(r.bodySample ?? ""), ex.totalPath)) !== 1
              )
                return;
            } catch {
              return;
            }
          }
          return observed[0];
        };
        if (operation.actionType === `${SCHEMA}DeleteAction`) {
          const baseline = verificationCollection(before, ex);
          // Old or partial evidence cannot silently turn a collection into a detail read.
          if (ex.format === "json" && baseline === undefined) continue;
          if (baseline) {
            if (
              before.seq >= write.seq ||
              baseline.count !== 1 ||
              !before.authenticationContext ||
              before.authenticationContext !== write.authenticationContext ||
              !exactIdentityFilter(
                read,
                compileOperation(read, values, origin),
                bind,
                identity.name,
                id,
              )
            )
              continue;
            const absent = trace.some((r) => {
              if (
                r.seq <= write.seq ||
                r.seq >= nextWrite ||
                r.demonstration !== write.demonstration ||
                (r.phase !== "demonstration" && r.resourceType !== "verification-evidence") ||
                !good(r) ||
                r.url !== before.url ||
                r.authenticationContext !== before.authenticationContext ||
                !sameReadContext(r)
              )
                return false;
              const collection = verificationCollection(r, ex);
              if (
                collection?.count !== 0 ||
                JSON.stringify(collection.envelope) !== JSON.stringify(baseline.envelope)
              )
                return false;
              if (ex.totalPath === undefined) return true;
              try {
                return (
                  (r.verificationEvidence?.total ??
                    jsonPointer(JSON.parse(r.bodySample ?? ""), ex.totalPath)) === 0
                );
              } catch {
                return false;
              }
            });
            if (!absent) continue;
          }
        }
        const afterReads = trace
          .filter((r) => r.seq > write.seq && r.seq < nextWrite)
          .flatMap((r) => {
            const item = targetItem(r);
            return item ? [{ record: r, item }] : [];
          });
        const beforeItems = trace
          .filter((r) => r.seq < write.seq)
          .flatMap((r) => {
            const item = targetItem(r);
            return item ? [item] : [];
          });
        const stateInputs = submittedStateInputs(operation, submitted, origin, identity.name);
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
            const afterItems = verificationItems(after, ex);
            for (const p of operation.inputs.filter((p) => stateInputs.includes(p.name))) {
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
          for (const p of operation.inputs.filter((p) => stateInputs.includes(p.name))) {
            const pairing = pairSubmittedField(
              operation,
              submitted,
              p,
              origin,
              ex,
              beforeItems,
              afterReads.map((r) => r.item),
            );
            if (pairing) changes.push(pairing);
          }
        }
        // Constants are exempt only when carried unchanged from the pre-edit form.
        // A changed literal still needs its own submitted-value equality check.
        const constantChanges: NonNullable<EffectVerification["constantChanges"]> = [];
        const form = [...trace]
          .sort((a, b) => b.seq - a.seq)
          .filter((r) => r.seq < write.seq && r.demonstration === write.demonstration)
          .flatMap(
            (r) =>
              r.formState ??
              (!r.bodyTruncated
                ? parseForms(r.bodySample ?? "", r.url).map((f) => ({
                    action: f.action,
                    method: f.method,
                    fields: f.fields.map((field) => ({
                      name: field.name,
                      value: field.value ?? field.selected ?? "",
                    })),
                  }))
                : []),
          )
          .find((f) => f.action === write.url && f.method === write.method);
        let uncoveredConstant = false;
        for (const [name, value] of requestValues(write).body) {
          const carried = form?.fields.find((f) => f.name === name);
          if (!carried || carried.value === value || isCsrfFieldName(name)) continue;
          const compiled = compileOperation(operation, submitted, origin);
          const literal =
            compiled.body?.kind !== "json" &&
            compiled.body?.fields.some(([n, v]) => n === name && v === value);
          const templateValue =
            operation.request.bodyTemplate &&
            new URLSearchParams(operation.request.bodyTemplate).get(name);
          if (!literal || (templateValue && /\{[^}]+\}/.test(templateValue))) continue;
          const pairing = pairSubmittedValue(
            value,
            undefined,
            new Set([leafKey(name)]),
            ex,
            beforeItems,
            afterReads.map((r) => r.item),
          );
          if (!pairing) {
            uncoveredConstant = true;
            break;
          }
          constantChanges.push({ name, value, property: pairing.property });
        }
        if (uncoveredConstant) continue;
        if (
          operation.actionType !== `${SCHEMA}DeleteAction` &&
          ((!changes.length && !constantChanges.length) ||
            stateInputs.some((name) => !changes.some((change) => change.input === name)))
        )
          continue;
        if (scopeConstants?.length) {
          // Same-template witnesses may differ in search/filter values, but must
          // reflect this written identity and every submitted value in this session.
          const reflected = afterReads.some(({ record: follow, item: observed }) => {
            if (
              !write.authenticationContext ||
              follow.authenticationContext !== write.authenticationContext ||
              before.authenticationContext !== write.authenticationContext
            )
              return false;
            return (
              (changes.length > 0 || constantChanges.length > 0) &&
              changes.every((change) => {
                const sent = sentInputValue(operation, submitted, change.input, origin);
                const actual = observed[change.property];
                if (change.mode === "delta")
                  return (
                    sent !== undefined &&
                    actual?.length === 1 &&
                    /^[+-]?\d+$/.test(sent) &&
                    /^[+-]?\d+$/.test(actual[0] ?? "") &&
                    /^[+-]?\d+$/.test(item[change.property]?.[0] ?? "") &&
                    BigInt(actual[0] ?? "0") - BigInt(item[change.property]?.[0] ?? "0") ===
                      BigInt(sent)
                  );
                return (
                  sent !== undefined &&
                  actual?.length === 1 &&
                  effectValueEquals(
                    sent,
                    actual[0] ?? "",
                    operation.inputs.find((p) => p.name === change.input)?.range,
                    change.format,
                  )
                );
              }) &&
              constantChanges.every(
                (change) =>
                  observed[change.property]?.length === 1 &&
                  observed[change.property]?.[0] === change.value,
              )
            );
          });
          if (!reflected) continue;
        }
        // A missing-resource response must have been fetched for the deleted identity,
        // in this exact request context. Arbitrary nonexistent IDs are never invented.
        const missing =
          operation.actionType === `${SCHEMA}DeleteAction`
            ? trace
                .filter(
                  (r) =>
                    r.seq > write.seq &&
                    !r.blocked &&
                    !r.bodyTruncated &&
                    (r.bodySample !== undefined || !!r.notFoundEvidence) &&
                    r.responsePageFailure !== true &&
                    r.method === "GET" &&
                    r.url === before.url &&
                    !!before.authenticationContext &&
                    before.authenticationContext === write.authenticationContext &&
                    r.authenticationContext === before.authenticationContext &&
                    !r.redirectedTo &&
                    r.resourceType !== "replay-anonymous" &&
                    (r.phase === "verify" || r.demonstration === write.demonstration) &&
                    JSON.stringify(
                      Object.entries(r.requestHeaders)
                        .filter(([k]) => !isExecutorOwnedHeader(k))
                        .map(([k, v]) => [k.toLowerCase(), v])
                        .sort(),
                    ) ===
                      JSON.stringify(
                        Object.entries(before.requestHeaders)
                          .filter(([k]) => !isExecutorOwnedHeader(k))
                          .map(([k, v]) => [k.toLowerCase(), v])
                          .sort(),
                      ),
                )
                .flatMap((r) => {
                  const signature =
                    r.notFoundEvidence ??
                    notFoundSignature(r.status ?? 0, r.contentType, r.bodySample ?? "");
                  return signature ? [signature] : [];
                })
            : [];
        const notFound =
          missing.length && missing.every((s) => JSON.stringify(s) === JSON.stringify(missing[0]))
            ? missing[0]
            : undefined;
        witness = {
          operation: read.id,
          bind,
          identityInput: identity.name,
          ...resource,
          changes,
          ...(scopeConstants?.length ? { scopeConstants } : {}),
          ...(constantChanges.length ? { constantChanges } : {}),
          ...(notFound ? { notFound } : {}),
          ...(displaySlug ? { displaySlug: true } : {}),
        };
        onWitness?.(write, before);
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
