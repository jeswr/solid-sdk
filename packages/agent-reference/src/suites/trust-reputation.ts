// AUTHORED-BY Codex GPT-6
/** Reputation tightens ordinary register/own-list acceptance. It can never create it. */
import { z } from "zod";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { EvidenceItem } from "../core/types.js";
import { verifyStatement } from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { SuiteValuesNode } from "../model/suite-values.js";
import { type Resolution, TrustResolver, type TrustResolverOptions } from "../trust/resolver.js";
export const ratingSchema = z.strictObject({
  type: z.literal("AgentReputation"),
  issuer: z.string(),
  subject: z.string(),
  actor: z.string(),
  subjectKey: z.string(),
  score: z.number().min(0).max(1),
  method: z.string(),
  evidence: z.array(z.string()).min(1).max(64),
  issuedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export interface ReputationPolicy {
  readonly service: string;
  readonly minimum: number;
  readonly targets: readonly { party: string; actor: string; kid: string }[];
}
export class ReputationResolver extends TrustResolver {
  private readonly scores = new Map<string, { score: number; validUntil: string }>();
  constructor(
    options: TrustResolverOptions,
    readonly policy: ReputationPolicy,
    private readonly trust: TrustStore,
    private readonly verifier: string,
  ) {
    super(options);
  }
  async present(
    evidence: readonly EvidenceItem[],
    at: string,
    record: <T extends { type: string }>(entry: T) => void,
  ) {
    for (const item of evidence.filter(
      (e) => e.role === "membership" && e.format === "agent-reputation+jws",
    )) {
      const options = {
        trust: this.trust,
        typ: "awp-agent-reputation+jws",
        schema: ratingSchema,
        limits: DEFAULT_LIMITS,
        at,
        verifier: this.verifier,
        algs: ["EdDSA"] as const,
      };
      let checked = await verifyStatement(item.value, { ...options, role: "issuer" });
      if (checked.verification.outcome === "unknown-key")
        checked = await verifyStatement(item.value, { ...options, role: "party" });
      record(checked.verification);
      if (
        !checked.payload ||
        checked.verification.outcome !== "valid" ||
        checked.signer?.subject !== this.policy.service
      )
        continue;
      const score = SuiteValuesNode.fromSignedPayload(checked.payload),
        subject = score.string("subject")!;
      const target = this.policy.targets.find((t) => t.party === subject);
      const authority = this.trust.assessSource({
        evaluator: this.verifier,
        source: this.policy.service,
        claimType: "agent.reputation",
        subject: score.string("actor"),
        at,
      });
      if (
        !target ||
        score.string("issuer") !== this.policy.service ||
        score.string("actor") !== target.actor ||
        score.string("subjectKey") !== target.kid ||
        authority.outcome !== "accepted" ||
        Date.parse(score.string("issuedAt")!) > Date.parse(at) ||
        Date.parse(score.string("validUntil")!) <= Date.parse(at) ||
        score.string("method") !== "evidence-reviewed-agent-behaviour"
      )
        continue;
      this.scores.set(subject, {
        score: score.number("score")!,
        validUntil: score.string("validUntil")!,
      });
      record({
        type: "reputation-checked",
        service: this.policy.service,
        subject,
        score: score.number("score"),
        minimum: this.policy.minimum,
        registerStillRequired: true,
      });
    }
  }
  private tighten(result: Resolution, party: string, at: string): Resolution {
    if (!this.policy.targets.some((t) => t.party === party)) return result;
    if (result.outcome !== "accepted")
      return {
        ...result,
        path: [
          ...result.path,
          {
            at: "The principal’s rating service",
            kind: "own-list",
            says: "A score cannot replace missing register or own-list acceptance.",
          },
        ],
      };
    const score = this.scores.get(party),
      ok =
        !!score &&
        score.score >= this.policy.minimum &&
        Date.parse(score.validUntil) > Date.parse(at);
    return {
      ...result,
      path: [
        ...result.path,
        {
          at: "The principal’s rating service",
          kind: "own-list",
          says: ok
            ? "The independently signed score meets the principal’s minimum."
            : "No current accepted score meets the principal’s minimum.",
        },
      ],
      outcome: ok ? "accepted" : "not-accepted",
      answer: ok ? result.answer : "The principal’s minimum reputation score is not met.",
    };
  }
  override resolveSource(input: Parameters<TrustResolver["resolveSource"]>[0]): Resolution {
    return this.tighten(super.resolveSource(input), input.source, input.at);
  }
  override resolveRecipient(input: Parameters<TrustResolver["resolveRecipient"]>[0]): Resolution {
    return this.tighten(super.resolveRecipient(input), input.party, input.at);
  }
}
