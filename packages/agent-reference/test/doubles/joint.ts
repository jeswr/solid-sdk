// AUTHORED-BY Codex GPT-6
/** TEST DOUBLE. Plain additive shares prove nothing and provide no privacy. Public test keys. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash, createPrivateKey } from "crypto";
import type { JWK } from "jose";
import { digestOf } from "../../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../../src/core/limits.js";
import type { JsonObject } from "../../src/core/types.js";
import type { JointOutcome, JointProtocol, SessionParams } from "../../src/derive/verifiers.js";
import { loadSigningKey, signCompact, verifyCompact } from "../../src/mechanisms/jws.js";

const typ = "awp-toy-contribution+jws";
export class ToyJointProtocol implements JointProtocol {
  readonly kind = "test-double" as const;
  readonly method = "sparq-aggregate/1";
  readonly assumption =
    "This test double uses public keys and plain shares and provides no privacy or proof of correct private inputs.";
  async generateKeys(seed: Uint8Array) {
    const bytes = createHash("sha256").update(seed).digest();
    const jwk = createPrivateKey({
      key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), bytes]),
      format: "der",
      type: "pkcs8",
    }).export({ format: "jwk" }) as JWK;
    const key = await loadSigningKey(jwk, "EdDSA");
    return {
      publicKeys: { kid: key.kid, signing: key.publicJwk as JsonObject },
      secretKeys: { signing: jwk as JsonObject },
    };
  }
  async newSession(params: SessionParams) {
    if (new Set(params.roster.map((r) => r.party)).size !== params.roster.length)
      throw new Error("duplicate roster party");
    const ruleDigest = digestOf(params);
    return {
      session: { ...params, roster: [...params.roster], ruleDigest } as unknown as JsonObject,
      ruleDigest,
    };
  }
  async contribute(
    input: Parameters<JointProtocol["contribute"]>[0],
  ): ReturnType<JointProtocol["contribute"]> {
    const roster = input.session.roster as JsonObject[];
    const others = roster.filter((p) => p.party !== input.party);
    const shares = Object.fromEntries(
      others.map((p, i) => [
        String(p.party),
        {
          party: input.party,
          recipient: String(p.party),
          count: i === 0 ? input.count : 0,
          sum: i === 0 ? input.sum : 0,
        },
      ]),
    );
    const payload: JsonObject = {
      party: input.party,
      session: input.session.ruleDigest as string,
      count: input.count,
      sum: input.sum,
      shareDigests: Object.fromEntries(Object.entries(shares).map(([p, s]) => [p, digestOf(s)])),
    };
    const key = await loadSigningKey(input.secretKeys.signing as JWK, "EdDSA");
    return {
      contribution: { ...payload, signature: await signCompact(key, typ, payload) },
      shares,
    };
  }
  private async check(session: JsonObject, contributions: readonly JsonObject[]) {
    const roster = session.roster as JsonObject[],
      seen = new Set<string>();
    for (const c of contributions) {
      const party = String(c.party),
        member = roster.find((p) => p.party === party);
      if (!member || seen.has(party))
        return { ok: false as const, reason: "input-not-attested", partyAtFault: party };
      seen.add(party);
      const keys = member.publicKeys as JsonObject;
      const record = {
        kid: String(keys.kid),
        alg: "EdDSA" as const,
        publicJwk: keys.signing as JWK,
      };
      const checked = await verifyCompact(String(c.signature ?? ""), {
        typ,
        limits: DEFAULT_LIMITS,
        allowedAlgs: ["EdDSA"],
        resolve: (kid) => (kid === record.kid ? record : undefined),
      });
      const { signature, ...payload } = c;
      if (
        checked.outcome !== "valid" ||
        digestOf(checked.payload) !== digestOf(payload) ||
        c.session !== session.ruleDigest ||
        !Number.isSafeInteger(c.count) ||
        !Number.isSafeInteger(c.sum)
      )
        return { ok: false as const, reason: "input-not-attested", partyAtFault: party };
    }
    const expected = roster;
    if (seen.size !== expected.length)
      return {
        ok: false as const,
        reason: "missing contribution",
        partyAtFault: String(expected.find((p) => !seen.has(String(p.party)))?.party),
      };
    return { ok: true as const, contributors: [...seen] };
  }
  async receiveAndPartial(
    input: Parameters<JointProtocol["receiveAndPartial"]>[0],
  ): ReturnType<JointProtocol["receiveAndPartial"]> {
    const checked = await this.check(input.session, input.contributions);
    if (!checked.ok) return checked;
    for (const c of input.contributions.filter((c) => c.party !== input.party)) {
      const share = input.shares.find((s) => s.party === c.party && s.recipient === input.party);
      if (!share || digestOf(share) !== (c.shareDigests as JsonObject)[input.party])
        return { ok: false, reason: "bad share", partyAtFault: String(c.party) };
    }
    const payload = {
      party: input.party,
      session: input.session.ruleDigest as string,
      contributions: input.contributions.map(digestOf).sort(),
      count: input.shares.reduce((n, s) => n + Number(s.count), 0),
      sum: input.shares.reduce((n, s) => n + Number(s.sum), 0),
    };
    const key = await loadSigningKey(input.secretKeys.signing as JWK, "EdDSA");
    return {
      ok: true,
      partial: { ...payload, signature: await signCompact(key, "awp-toy-partial+jws", payload) },
    };
  }
  async finish(input: Parameters<JointProtocol["finish"]>[0]): Promise<JointOutcome> {
    const evidence = {
      contributions: input.contributions.map(digestOf).sort(),
      partials: [...input.partials],
      session: input.session.ruleDigest as string,
    };
    if (input.contributions.length < Number(input.session.minimumContributors))
      return { type: "too-few-contributors", evidence };
    const count = input.partials.reduce((n, c) => n + Number(c.count), 0),
      sum = input.partials.reduce((n, c) => n + Number(c.sum), 0);
    if (count < Number(input.session.minimumGroup))
      return { type: "below-minimum-group", evidence };
    const t = input.session.threshold as JsonObject | undefined;
    if (t)
      return {
        type: "threshold-verdict",
        verdict:
          t.operator === ">="
            ? (t.statistic === "count" ? count : sum) >= Number(t.value)
            : (t.statistic === "count" ? count : sum) <= Number(t.value),
        evidence,
      };
    return {
      type: "release",
      ...(input.session.statistic !== "sum" ? { count } : {}),
      ...(input.session.statistic !== "count" ? { sum } : {}),
      evidence,
    };
  }
  async verifyOutcome(
    input: Parameters<JointProtocol["verifyOutcome"]>[0],
  ): ReturnType<JointProtocol["verifyOutcome"]> {
    const checked = await this.check(input.session, input.contributions);
    if (!checked.ok) return checked;
    const expected = await this.finish({
      session: input.session,
      contributions: input.contributions,
      partials: input.outcome.evidence.partials as JsonObject[],
    });
    if (!["too-few-contributors"].includes(expected.type)) {
      const partials = input.outcome.evidence.partials as JsonObject[];
      const roster = input.session.roster as JsonObject[];
      if (
        partials.length !== roster.length ||
        new Set(partials.map((p) => p.party)).size !== roster.length
      )
        return { ok: false, reason: "missing partial" };
      for (const p of partials) {
        const member = roster.find((r) => r.party === p.party),
          keys = member?.publicKeys as JsonObject | undefined;
        if (!keys) return { ok: false, reason: "unknown partial", partyAtFault: String(p.party) };
        const key = {
          kid: String(keys.kid),
          alg: "EdDSA" as const,
          publicJwk: keys.signing as JWK,
        };
        const checked = await verifyCompact(String(p.signature ?? ""), {
          typ: "awp-toy-partial+jws",
          limits: DEFAULT_LIMITS,
          allowedAlgs: ["EdDSA"],
          resolve: (kid) => (kid === key.kid ? key : undefined),
        });
        const { signature, ...payload } = p;
        if (
          checked.outcome !== "valid" ||
          digestOf(checked.payload) !== digestOf(payload) ||
          p.session !== input.session.ruleDigest ||
          digestOf(p.contributions) !== digestOf(input.contributions.map(digestOf).sort())
        )
          return { ok: false, reason: "bad partial", partyAtFault: String(p.party) };
        const supplied = input.contributions.filter(
          (c) =>
            (input.session.roster as JsonObject[]).find((r) => r.party !== c.party)?.party ===
            p.party,
        );
        if (
          p.count !== supplied.reduce((n, c) => n + Number(c.count), 0) ||
          p.sum !== supplied.reduce((n, c) => n + Number(c.sum), 0)
        )
          return { ok: false, reason: "bad partial sum", partyAtFault: String(p.party) };
      }
    }
    return digestOf(expected) === digestOf(input.outcome)
      ? checked
      : { ok: false, reason: "outcome mismatch" };
  }
}
