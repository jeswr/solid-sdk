// AUTHORED-BY Codex GPT-6
/** The registry suite interprets one qualified field; the signed payroll claim stays intact. */
import { z } from "zod";
import type { JsonObject } from "../core/types.js";
import { mapCodeClaim, mappingPolicySchema } from "../mechanisms/code-mapping.js";
import type { DocumentResolver } from "../mechanisms/organizations.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { SuiteValuesNode } from "../model/suite-values.js";
import type { HandlerReply, OperationHandler } from "../runtime/operations.js";

export const registryMeaningSchema = z.strictObject({
  policy: mappingPolicySchema,
  requestedList: z.string().url(),
  acceptedCodes: z.array(z.string()).min(1),
});
export type RegistryMeaning = z.infer<typeof registryMeaningSchema>;

async function checkEmployment(
  claimInput: unknown,
  options: {
    settings: RegistryMeaning;
    seenVersions: Map<string, string>;
    resolver: DocumentResolver;
    trust: TrustStore;
    at: string;
    verifier: string;
    record: <T extends { type: string }>(record: T) => void;
  },
) {
  const claim = SuiteValuesNode.fromSignedPayload(claimInput);
  const status = claim.node("employmentStatus");
  const parent = claim.string("id"),
    issuer = claim.string("issuer"),
    subject = claim.string("subject");
  if (
    !status ||
    !status.fieldsOnly(["codeList", "code"]) ||
    !status.string("codeList") ||
    !status.string("code") ||
    !parent ||
    !issuer ||
    !subject
  )
    return {
      ok: false as const,
      reason: "unsupported-term" as const,
      outcome: "ask-more" as const,
    };
  const input: JsonObject = {
    id: parent,
    issuer,
    subject,
    claimType: "employment.status",
    method: claim.string("method") ?? "",
    asOf: claim.string("asOf") ?? claim.string("issuedAt") ?? "",
    codeList: status.string("codeList")!,
    code: status.string("code")!,
    field: "employmentStatus",
    ...(claim.node("period") ? { period: claim.node("period")!.toObject() } : {}),
    ...(claim.node("terms") ? { terms: claim.node("terms")!.toObject() } : {}),
  };
  const mapped = await mapCodeClaim(input, { ...options, policy: options.settings.policy });
  if (!mapped.ok) {
    // An authentic but unaccepted publisher cannot establish what the term means (SM-3).
    return mapped.reason === "source-not-authoritative"
      ? { ok: false as const, reason: "unsupported-term" as const, outcome: "ask-more" as const }
      : mapped;
  }
  const mappedValue = SuiteValuesNode.fromSignedPayload(mapped.statement);
  const derivation = mappedValue.node("derivation");
  const mappingDigest = derivation?.string("mappingDigest");
  const versionKey = `${derivation?.string("rule")}\0${derivation?.string("version")}`;
  const pinned = options.seenVersions.get(versionKey);
  if (!mappingDigest || (pinned !== undefined && pinned !== mappingDigest))
    return {
      ok: false as const,
      reason: "unsupported-term" as const,
      outcome: "ask-more" as const,
    };
  if (
    mappedValue.string("codeList") !== options.settings.requestedList ||
    !options.settings.acceptedCodes.includes(mappedValue.string("code") ?? "")
  )
    return {
      ok: false as const,
      reason: "unsupported-term" as const,
      outcome: "ask-more" as const,
    };
  options.seenVersions.set(versionKey, mappingDigest);
  const value: JsonObject = {
    ...mapped.statement,
    signedParent: parent,
    signedParentDigest: claim.contentDigest,
    field: "employmentStatus",
  };
  options.record({ type: "employment-status-interpretation", value });
  return { ok: true as const, value };
}

export async function interpretEmployment(
  input: unknown,
  options: Parameters<typeof checkEmployment>[1],
) {
  try {
    return await checkEmployment(input, options);
  } catch {
    return {
      ok: false as const,
      reason: "unsupported-term" as const,
      outcome: "ask-more" as const,
    };
  }
}

/** Versioned list IRIs advertise implemented mapping behaviour, not source authority. */
export function withMappingVocabulary(
  handler: OperationHandler,
  settings?: RegistryMeaning,
): OperationHandler {
  if (!settings) return handler;
  return new Proxy(handler, {
    get(target, property) {
      if (property === "description")
        return {
          ...target.description,
          vocabularies: [
            ...(target.description.vocabularies ?? []),
            { iri: settings.requestedList, relation: "implements-versioned-code-list" },
            ...settings.policy.routes.map((route) => ({
              iri: route.fromList,
              relation: "maps-from-versioned-code-list",
            })),
          ],
        };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The lender's ordinary counteroffer carries its versioned code-list requirement. */
export function withEmploymentRequirement(
  handler: OperationHandler,
  settings?: RegistryMeaning,
): OperationHandler {
  if (!settings || !handler.onProposal) return handler;
  return new Proxy(handler, {
    get(target, property) {
      if (property === "contentProfile")
        return {
          ...target.contentProfile,
          vocabulary: {
            ...target.contentProfile?.vocabulary,
            "terms.evidenceRequest.*.employmentStatus.codeList": { type: "identifier" },
            "terms.evidenceRequest.*.employmentStatus.codes.*": {
              type: "code",
              values: settings.acceptedCodes,
            },
          },
          identifiers: [...(target.contentProfile?.identifiers ?? []), settings.requestedList],
        };
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      if (property !== "onProposal") return value.bind(target);
      return (...args: unknown[]) => {
        const reply = value.apply(target, args) as HandlerReply;
        if (reply.type !== "counter" || !Array.isArray(reply.terms.evidenceRequest)) return reply;
        return {
          ...reply,
          terms: {
            ...reply.terms,
            evidenceRequest: reply.terms.evidenceRequest.map((request) => {
              const item = request as JsonObject;
              return String(item.claimType).startsWith("income.")
                ? {
                    ...item,
                    employmentStatus: {
                      codeList: settings.requestedList,
                      codes: settings.acceptedCodes,
                    },
                  }
                : item;
            }),
          },
        };
      };
    },
  });
}
