// AUTHORED-BY Codex GPT-6
/** A fictional platform records signed proposals and exact-exchange principal approvals. */
import { z } from "zod";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { type PublicKeyRecord, type SigningKey, verifyCompact } from "../mechanisms/jws.js";
import { signStatement } from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { SuiteValuesNode } from "../model/suite-values.js";
import type { TraceSink } from "../trace/recorder.js";

export const negotiatedMeaningSchema = z.strictObject({
  platform: z.string(),
  operation: z.string().url(),
  term: z.string().url(),
  definition: z.string().min(1),
  version: z.string(),
  proposer: z.string(),
  peer: z.string(),
});
export type NegotiatedMeaningSettings = z.infer<typeof negotiatedMeaningSchema>;
export const termProposalSchema = z.strictObject({
  type: z.literal("TermProposal"),
  issuer: z.string(),
  term: z.string(),
  definition: z.string(),
  version: z.string(),
  exchange: z.string(),
  principals: z.array(z.string()).length(2),
});
export const termApprovalSchema = z.strictObject({
  type: z.literal("TermApproval"),
  issuer: z.string(),
  proposalDigest: z.string(),
  exchange: z.string(),
  term: z.string(),
  decision: z.literal("approve"),
  validUntil: z.iso.datetime(),
});

export class FictionalDeliberationPlatform {
  private readonly records = new Map<
    string,
    { proposal: SuiteValuesNode; approvals: SuiteValuesNode[]; receipt: string }
  >();
  constructor(
    readonly identity: string,
    private readonly key: SigningKey,
    private readonly author: { identity: string; key: PublicKeyRecord },
    private readonly people: Readonly<Record<string, PublicKeyRecord>>,
    private readonly agent: { identity: string; key: PublicKeyRecord },
    readonly settings: NegotiatedMeaningSettings,
    private readonly sink?: TraceSink,
  ) {}

  private async read<T>(
    jws: string,
    typ: string,
    key: PublicKeyRecord,
    schema: z.ZodType<T>,
  ): Promise<SuiteValuesNode> {
    const checked = await verifyCompact(jws, {
      typ,
      resolve: (kid) => (kid === key.kid ? key : undefined),
      allowedAlgs: ["EdDSA"],
      limits: DEFAULT_LIMITS,
    });
    if (checked.outcome !== "valid") throw new Error("The deliberation signature is invalid.");
    return SuiteValuesNode.fromSignedPayload(schema.parse(checked.payload));
  }

  async record(proposalJws: string, acceptanceJws: string, approvalJws: readonly string[]) {
    const proposal = await this.read(
      proposalJws,
      "awp-term-proposal+jws",
      this.author.key,
      termProposalSchema,
    );
    if (
      proposal.string("issuer")! !== this.author.identity ||
      proposal.string("term")! !== this.settings.term ||
      proposal.string("definition")! !== this.settings.definition ||
      proposal.string("version")! !== this.settings.version ||
      new Set(proposal.strings("principals")).size !== 2 ||
      proposal.strings("principals").some((person) => !Object.hasOwn(this.people, person))
    )
      throw new Error("The term proposal does not match this platform’s exchange scope.");
    const accepted = await this.read(
      acceptanceJws,
      "awp-term-agent-acceptance+jws",
      this.agent.key,
      z.strictObject({
        type: z.literal("TermAgentAcceptance"),
        issuer: z.string(),
        proposalDigest: z.string(),
        exchange: z.string(),
      }),
    );
    if (
      accepted.string("issuer")! !== this.agent.identity ||
      accepted.string("proposalDigest")! !== proposal.contentDigest ||
      accepted.string("exchange")! !== proposal.string("exchange")!
    )
      throw new Error("The agent accepted a different term proposal.");
    const approvals: SuiteValuesNode[] = [];
    for (const signed of approvalJws) {
      let approval: SuiteValuesNode | undefined;
      for (const [person, key] of Object.entries(this.people)) {
        try {
          const checked = await this.read(signed, "awp-term-approval+jws", key, termApprovalSchema);
          if (checked.string("issuer")! === person) approval = checked;
        } catch {}
      }
      if (
        !approval ||
        !proposal.strings("principals").includes(approval.string("issuer")!) ||
        approval.string("proposalDigest")! !== proposal.contentDigest ||
        approval.string("exchange")! !== proposal.string("exchange")! ||
        approval.string("term")! !== proposal.string("term")!
      )
        throw new Error("A principal approval does not cover this exact term and exchange.");
      approvals.push(approval);
    }
    const receipt = await signStatement(this.key, "awp-term-deliberation+jws", {
      type: "TermDeliberationRecord",
      issuer: this.identity,
      proposal: proposalJws,
      agentAcceptance: acceptanceJws,
      principalApprovals: [...approvalJws],
    });
    const prior = this.records.get(proposal.string("exchange")!);
    if (prior && prior.proposal.contentDigest !== proposal.contentDigest)
      throw new Error("An exchange cannot silently change its term definition.");
    // Cache only the evidence this independently keyed platform has actually verified.
    this.records.set(proposal.string("exchange")!, { proposal, approvals, receipt });
    this.sink?.emit({
      part: "record",
      kind: "store",
      caption: approvals.length
        ? "The fictional deliberation platform records the proposal and the principals’ signed approval of its exact definition for this exchange."
        : "The fictional deliberation platform records the agents’ agreement; no person has approved the definition.",
      fact: {
        id: proposal.string("term")!,
        label: "Proposed definition of irregular income",
        claimType: "term.deliberation",
        subject: proposal.string("term")!,
        source: this.identity,
        method: "recorded-by-authority",
        value: {
          signedRecord: receipt,
          definition: proposal.string("definition")!,
          exchange: proposal.string("exchange")!,
          principalApprovals: approvals.length,
        },
        provenance:
          "The fictional platform verified the proposal and every attached signature before recording it.",
      },
    });
    return receipt;
  }

  approved(
    exchange: string,
    principal: string | undefined,
    peer: string | undefined,
    at: string,
    trust: TrustStore,
    verifier: string,
  ): boolean {
    const record = this.records.get(exchange);
    if (
      !record ||
      !principal ||
      !peer ||
      !record.proposal.strings("principals").includes(principal) ||
      !record.proposal.strings("principals").includes(peer)
    )
      return false;
    const authority = trust.assessSource({
      evaluator: verifier,
      source: this.identity,
      claimType: "term.deliberation",
      subject: this.settings.term,
      at,
    });
    if (authority.outcome !== "accepted") return false;
    return record.proposal
      .strings("principals")
      .every((person) =>
        record.approvals.some(
          (approval) =>
            approval.string("issuer")! === person &&
            Date.parse(approval.string("validUntil")!) > Date.parse(at),
        ),
      );
  }
}
