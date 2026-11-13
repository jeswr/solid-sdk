// AUTHORED-BY Codex GPT-6
/** Research-grade, unaudited verifiable aggregation. No cross-party private state. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createRequire } from "module";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { resolve } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { z } from "zod";
import { digestOf } from "../../core/canonical.js";
import { jointLimits, parseBoundedJson } from "../../core/limits.js";
import type { JsonObject } from "../../core/types.js";
import { decodeAdapterJson } from "../../wire/inspect.js";
import type { JointOutcome, JointProtocol, SessionParams } from "../verifiers.js";

export const SPARQ_AGGREGATE = {
  method: "sparq-aggregate/1",
  package: "sparq-verifiable-aggregate",
  commit: "61989f5",
  sha256: "9832ef937efbcc8970db3f70ec4e72e3384a867f3ecb40a1be81ea002a6a6830",
  notice: "Research-grade and unaudited.",
} as const;
const bytes = z.string().regex(/^[A-Za-z0-9_-]+$/);
const uint = z.number().int().nonnegative();
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const publicKeys = z.strictObject({ ed25519_public_key: bytes, x25519_public_key: bytes });
const secrets = z.strictObject({ signing_secret: bytes, encryption_secret: bytes });
const shares = z.strictObject({
  count: bytes,
  rho: bytes,
  sum: bytes.optional(),
  sigma: bytes.optional(),
});
const binding = { session_id: bytes, rule_digest: bytes, index: uint };
const local = z.strictObject({ ...binding, shares });
const partial = local.extend({ contributions_digest: bytes, signature: bytes });
const commitments = z.strictObject({ count: bytes, sum: bytes.optional() });
const ciphertext = z.strictObject({ ephemeral_key: bytes, nonce: bytes, ciphertext: bytes });
const contribution = z.strictObject({
  ...binding,
  commitment: commitments,
  range_proof: bytes,
  share_commitments: z.array(commitments),
  ciphertexts: z.array(ciphertext.nullable()),
  signature: bytes,
});
const partialMessage = z.strictObject({
  ...binding,
  contributions_digest: bytes,
  recipient: uint,
  packet: ciphertext,
});
const parameters = z.strictObject({
  session_id: bytes,
  statistic: z.enum(["count-and-sum", "count-only"]),
  min_group: uint,
  min_contributors: uint.optional(),
  max_value_bits: uint.optional(),
  threshold: z
    .strictObject({ statistic: z.enum(["count", "sum"]), op: z.enum([">=", "<"]), value: decimal })
    .optional(),
  roster: z.array(
    publicKeys.extend({ party_iri: z.string(), computeOnly: z.boolean().optional() }),
  ),
});
const sessionSchema = z.strictObject({ parameters, rule_digest: bytes });
const signedOutcome = z.strictObject({
  session_id: bytes,
  rule_digest: bytes,
  contributions_digest: bytes,
  finisher: uint,
  signature: bytes,
  outcome: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("release"),
      count: uint,
      rho: bytes,
      sum: decimal.optional(),
      sigma: bytes.optional(),
    }),
    z.strictObject({
      kind: z.literal("threshold-verdict"),
      verdict: z.boolean(),
      limb_commitments: z.array(bytes),
      range_proof: bytes,
    }),
    z.strictObject({ kind: z.literal("below-minimum-group"), range_proof: bytes }),
    z.strictObject({ kind: z.literal("too-few-contributors") }),
  ]),
});
const protocolError = z.strictObject({
  code: z.string(),
  index: uint.nullable(),
  check: z.string(),
});
type Package = Record<
  "generateKeys" | "newSession" | "contribute" | "receiveAndPartial" | "finish" | "verifyOutcome",
  (json?: string) => string
>;
export class AggregateFailure extends Error {
  constructor(
    readonly reason: string,
    readonly check: string,
    readonly index: number | null,
  ) {
    super(`${reason}; check: ${check}; roster index: ${index ?? "unknown"}`);
  }
}
export function loadSparqAggregate(): SparqAggregate | undefined {
  const directory =
    process.env.ANSWERABLE_SPARQ_AGGREGATE ??
    fileURLToPath(new URL("../../../.sparq/sparq-verifiable-aggregate/", import.meta.url));
  if (!existsSync(directory)) return undefined;
  const require = createRequire(resolve(directory, "loader.cjs"));
  return new SparqAggregate(require("./aggregate.js") as Package);
}
export class SparqAggregate implements JointProtocol {
  readonly method = SPARQ_AGGREGATE.method;
  readonly kind = "real" as const;
  readonly assumption =
    "Research-grade and unaudited. An input stays hidden from a coalition missing at least one other party, beyond what totals and its own inputs reveal; contributors can reconstruct both totals, including on refusal or a threshold verdict.";
  constructor(private readonly api: Package) {}
  private call<T>(name: keyof Package, input: unknown, schema: z.ZodType<T>, n = 1): T {
    let result: string;
    try {
      result = this.api[name](input === undefined ? undefined : JSON.stringify(input));
    } catch (error) {
      let parsed: unknown;
      try {
        parsed = typeof error === "string" ? decodeAdapterJson(error) : error;
      } catch {
        throw new AggregateFailure("derivation-not-verified", "invalid-package-error", null);
      }
      const failure = protocolError.safeParse(parsed);
      if (!failure.success)
        throw new AggregateFailure("derivation-not-verified", "invalid-package-error", null);
      throw new AggregateFailure(failure.data.code, failure.data.check, failure.data.index);
    }
    return schema.parse(parseBoundedJson(result, jointLimits("outcome", n)));
  }
  async generateKeys(seed: Uint8Array) {
    const k = this.call("generateKeys", undefined, publicKeys.extend({ secret: secrets }));
    void seed; // OS-generated identities; never replace protocol randomness with fixture entropy.
    return {
      publicKeys: {
        ed25519_public_key: k.ed25519_public_key,
        x25519_public_key: k.x25519_public_key,
      },
      secretKeys: k.secret,
    };
  }
  async newSession(params: SessionParams) {
    if (params.threshold?.operator === "<=")
      throw new AggregateFailure("rule-not-accepted", "unsupported-threshold-operator", null);
    const wire = this.call(
      "newSession",
      {
        session_id: params.sessionId,
        statistic: params.statistic === "count" ? "count-only" : "count-and-sum",
        min_group: params.minimumGroup,
        min_contributors: params.minimumContributors,
        ...(params.threshold
          ? {
              threshold: {
                statistic: params.threshold.statistic,
                op: params.threshold.operator,
                value: String(params.threshold.value),
              },
            }
          : {}),
        roster: params.roster.map((p) => ({
          party_iri: p.party,
          ...publicKeys.parse(p.publicKeys),
          ...(p.computeOnly === undefined ? {} : { computeOnly: p.computeOnly }),
        })),
      },
      sessionSchema,
      params.roster.length,
    );
    return {
      session: { ...params, ruleDigest: wire.rule_digest, wire } as unknown as JsonObject,
      ruleDigest: wire.rule_digest,
    };
  }
  private session(value: JsonObject) {
    const parsed = z
      .strictObject({
        sessionId: bytes,
        statistic: z.enum(["count", "sum", "count-and-sum"]),
        minimumGroup: uint,
        minimumContributors: uint,
        threshold: z
          .strictObject({
            statistic: z.enum(["count", "sum"]),
            operator: z.literal(">="),
            value: uint,
          })
          .optional(),
        roster: z.array(
          z.strictObject({
            party: z.string(),
            publicKeys,
            computeOnly: z.boolean().optional(),
            keyBinding: z.string().optional(),
          }),
        ),
        ruleDigest: bytes,
        wire: sessionSchema,
      })
      .parse(value);
    const expected = this.call(
      "newSession",
      {
        session_id: parsed.sessionId,
        statistic: parsed.statistic === "count" ? "count-only" : "count-and-sum",
        min_group: parsed.minimumGroup,
        min_contributors: parsed.minimumContributors,
        ...(parsed.threshold
          ? {
              threshold: {
                statistic: parsed.threshold.statistic,
                op: parsed.threshold.operator,
                value: String(parsed.threshold.value),
              },
            }
          : {}),
        roster: parsed.roster.map((p) => ({
          party_iri: p.party,
          ...p.publicKeys,
          ...(p.computeOnly === undefined ? {} : { computeOnly: p.computeOnly }),
        })),
      },
      sessionSchema,
      parsed.roster.length,
    );
    if (parsed.ruleDigest !== expected.rule_digest || digestOf(parsed.wire) !== digestOf(expected))
      throw new AggregateFailure("rule-not-accepted", "session-rule-digest", null);
    return parsed.wire;
  }
  private index(session: z.infer<typeof sessionSchema>, party: string) {
    const i = session.parameters.roster.findIndex((p) => p.party_iri === party);
    if (i < 0) throw new AggregateFailure("source-not-accepted", "party-not-in-roster", null);
    return i;
  }
  private contributions(values: readonly JsonObject[], session: z.infer<typeof sessionSchema>) {
    return values
      .map((value) => {
        const { party, ...wire } = contribution.extend({ party: z.string() }).parse(value);
        if (session.parameters.roster[wire.index]?.party_iri !== party)
          throw new AggregateFailure("input-not-attested", "roster-index-binding", wire.index);
        return wire;
      })
      .sort((a, b) => a.index - b.index);
  }
  async contribute(input: Parameters<JointProtocol["contribute"]>[0]) {
    const session = this.session(input.session),
      index = this.index(session, input.party);
    const result = this.call(
      "contribute",
      {
        session,
        index,
        keys: secrets.parse(input.secretKeys),
        input: {
          count: input.count,
          ...(session.parameters.statistic === "count-only" ? {} : { sum: String(input.sum) }),
        },
      },
      z.strictObject({ contribution, local, audit_opening: shares }),
      session.parameters.roster.length,
    );
    return {
      contribution: { ...result.contribution, party: input.party },
      shares: Object.fromEntries(
        session.parameters.roster
          .filter((p) => p.party_iri !== input.party)
          .map((p) => [p.party_iri, {}]),
      ),
      local: result.local,
      auditOpening: result.audit_opening,
    };
  }
  private failure(error: unknown, session: JsonObject) {
    const f =
      error instanceof AggregateFailure
        ? error
        : new AggregateFailure("input-not-attested", "invalid-wire-schema", null);
    const roster = session.roster as JsonObject[];
    return {
      ok: false as const,
      reason: f.reason,
      check: f.check,
      index: f.index,
      ...(f.index === null ? {} : { partyAtFault: String(roster?.[f.index]?.party ?? "unknown") }),
    };
  }
  async receiveAndPartial(
    input: Parameters<JointProtocol["receiveAndPartial"]>[0],
  ): ReturnType<JointProtocol["receiveAndPartial"]> {
    try {
      const session = this.session(input.session),
        index = this.index(session, input.party);
      // The package still requires all input attestations for a too-few roster.
      if (session.parameters.roster.length < (session.parameters.min_contributors ?? 3)) {
        this.call(
          "finish",
          {
            session,
            index,
            keys: secrets.parse(input.secretKeys),
            contributions: this.contributions(input.contributions, session),
            local: null,
            messages: [],
          },
          signedOutcome,
          session.parameters.roster.length,
        );
        return { ok: true, partial: { party: input.party, messages: [] } };
      }
      const result = this.call(
        "receiveAndPartial",
        {
          session,
          index,
          keys: secrets.parse(input.secretKeys),
          contributions: this.contributions(input.contributions, session),
          local: local.parse(input.local),
        },
        z.strictObject({ messages: z.array(partialMessage), local: partial }),
        session.parameters.roster.length,
      );
      return {
        ok: true,
        partial: { party: input.party, messages: result.messages },
        local: result.local,
      };
    } catch (error) {
      return this.failure(error, input.session);
    }
  }
  private normalize(evidence: z.infer<typeof signedOutcome>, statistic: unknown): JointOutcome {
    const o = evidence.outcome;
    if (o.kind !== "release")
      return {
        type: o.kind,
        ...(o.kind === "threshold-verdict" ? { verdict: o.verdict } : {}),
        evidence,
      } as JointOutcome;
    const sum = o.sum === undefined ? undefined : Number(o.sum);
    if (sum !== undefined && !Number.isSafeInteger(sum))
      throw new AggregateFailure("derivation-not-verified", "sum-outside-safe-json-integer", null);
    return {
      type: "release",
      ...(statistic === "sum" ? {} : { count: o.count }),
      ...(statistic === "count" ? {} : { sum }),
      evidence,
    };
  }
  async finish(input: Parameters<JointProtocol["finish"]>[0]) {
    const session = this.session(input.session),
      index = this.index(session, String(input.party));
    const evidence = this.call(
      "finish",
      {
        session,
        index,
        keys: secrets.parse(input.secretKeys),
        contributions: this.contributions(input.contributions, session),
        local: input.local === undefined ? null : partial.parse(input.local),
        messages: input.partials
          .filter((p) => p.party !== input.party)
          .map((p) => partialMessage.parse(p.message)),
      },
      signedOutcome,
      session.parameters.roster.length,
    );
    return this.normalize(evidence, input.session.statistic);
  }
  async verifyOutcome(
    input: Parameters<JointProtocol["verifyOutcome"]>[0],
  ): ReturnType<JointProtocol["verifyOutcome"]> {
    try {
      const session = this.session(input.session),
        evidence = signedOutcome.parse(input.outcome.evidence);
      this.call(
        "verifyOutcome",
        {
          session,
          contributions: this.contributions(input.contributions, session),
          outcome: evidence,
        },
        z.strictObject({ verified: z.literal(true) }),
        session.parameters.roster.length,
      );
      if (digestOf(this.normalize(evidence, input.session.statistic)) !== digestOf(input.outcome))
        throw new AggregateFailure("derivation-not-verified", "released-value-mismatch", null);
      return { ok: true, contributors: session.parameters.roster.map((p) => p.party_iri) };
    } catch (error) {
      return this.failure(error, input.session);
    }
  }
}
