// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// Response policies come only from complete, causally linked demonstration traffic.
import {
  createdObjectType,
  type ExecutorOptions,
  jsonPointer,
  landingItemValues,
  matchesCreatedIdentity,
  readBackIdentityMatches,
  requiresEffectVerification,
  sentInputValue,
  type WriteResponsePolicy,
} from "@jeswr/site-executor";
import { type Operation, responseIdentity, SCHEMA } from "@jeswr/site-model";
import { applyExtraction } from "./extraction.js";
import { locationPattern, readBackResource, safeUrl } from "./read-resource.js";
import { responsePageError } from "./response-evidence.js";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";
import { learnEffectVerification } from "./write-effect.js";
import { learnLivenessRead } from "./write-liveness.js";

function failedPage(r: RecordedRequest): boolean {
  return !!(
    r.blocked ||
    (r.bodyTruncated && r.responsePageError === undefined) ||
    r.status === undefined ||
    r.status < 200 ||
    r.status >= 400 ||
    r.responsePageError === true ||
    r.responseFlash?.length ||
    responsePageError(r.bodySample ?? "", r.contentType)
  );
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
    if (requiresEffectVerification(op)) {
      const verification = learnEffectVerification(op, learnedOperations, trace, origin);
      // A deletion (not-found or collection absence) also needs a session liveness read;
      // without one it stays Uncertain.
      const liveness =
        verification &&
        op.actionType === `${SCHEMA}DeleteAction` &&
        learnLivenessRead(op, verification, operations, learnedOperations, trace, origin);
      if (verification && liveness) verification.liveness = liveness;
      if (verification)
        policies[op.id] = {
          createdLocationPattern: "/",
          completionOnly: true,
          verification,
        };
      continue;
    }
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
        chain.some((r) => failedPage(r)) ||
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
      if (!read && !reads.length && identity) {
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
            const urls = trusted[0]?.[`${SCHEMA}url`] ?? [];
            const resource = readBackResource(urls, identity.identifier, origin, follow, trace);
            if (
              items.length !== 1 ||
              !item ||
              !resource ||
              !readBackIdentityMatches(ids, urls, identity.identifier, origin, [
                resource.identityPattern,
                ...(resource.identityAliases ?? []),
              ]) ||
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
                readBack = { operation: candidate.id, bind, ...resource };
                break outer;
              }
            }
          }
        }
      }
      if ((!read && !readBack) || !inputEvidence) {
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
        inputEvidence,
      };
      if (read?.extraction) policy.extraction = structuredClone(read.extraction);
      if (readBack) policy.readBack = readBack;
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
