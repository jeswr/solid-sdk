// AUTHORED-BY Codex GPT-6

import type { JsonObject } from "../core/types.js";
import { SuiteValuesNode } from "../model/suite-values.js";
import type { HandlerReply, OperationHandler } from "../runtime/operations.js";
import type { NegotiatedMeaningSettings } from "../standins/deliberation.js";

export function negotiatedRequestMatches(input: unknown, term: string): boolean {
  try {
    const request = SuiteValuesNode.fromSignedPayload(input);
    const income = request
      .records("evidenceRequest")
      .filter((r) => r.string("claimType")?.startsWith("income."));
    return (
      income.length > 0 && income.every((r) => r.node("incomeDefinition")?.string("term") === term)
    );
  } catch {
    return false;
  }
}

/** Recognizing the proposed identifier does not authorize relying on its definition. */
export function withNegotiatedRequirement(
  handler: OperationHandler,
  settings?: NegotiatedMeaningSettings,
): OperationHandler {
  if (!settings || !handler.onProposal) return handler;
  return new Proxy(handler, {
    get(target, property) {
      if (property === "contentProfile")
        return {
          ...target.contentProfile,
          vocabulary: {
            ...target.contentProfile?.vocabulary,
            "terms.evidenceRequest.*.incomeDefinition.term": { type: "identifier" },
            "terms.evidenceRequest.*.incomeDefinition.label": {
              type: "term",
              values: ["irregular income"],
            },
          },
          identifiers: [...(target.contentProfile?.identifiers ?? []), settings.term],
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
                ? { ...item, incomeDefinition: { term: settings.term, label: "irregular income" } }
                : item;
            }),
          },
        };
      };
    },
  });
}
