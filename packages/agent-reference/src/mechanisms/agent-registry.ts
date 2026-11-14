// AUTHORED-BY Codex GPT-6
/** A separately keyed authority registry. Signature, source acceptance and scope remain separate. */

import { Store } from "n3";
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { EmbeddedCredentialNode } from "../model/evidence-item.js";
import type { SigningKey } from "./jws.js";
import { signStatement, verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";

const entrySchema = z.strictObject({
  type: z.literal("AgentRegistration"),
  id: z.string(),
  issuer: z.string(),
  actor: z.string(),
  principal: z.string(),
  actorKid: z.string(),
  operations: z.array(z.string()),
  status: z.enum(["active", "suspended", "revoked"]),
  request: z.string(),
  issuedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export type AgentRegistration = z.infer<typeof entrySchema>;
export class FictionalAgentRegistry {
  private entries = new Map<
    string,
    Pick<AgentRegistration, "actor" | "principal" | "actorKid" | "operations" | "status">
  >();
  private nonce = 0;
  available = true;
  constructor(
    readonly identity: string,
    readonly key: SigningKey,
    readonly now: () => string,
  ) {}
  register(
    entry: Pick<AgentRegistration, "actor" | "principal" | "actorKid" | "operations" | "status">,
  ): void {
    this.entries.set(entry.actor, { ...entry, operations: [...entry.operations] });
  }
  async lookup(actor: string, request: string): Promise<string | undefined> {
    if (!this.available) return undefined;
    const entry = this.entries.get(actor);
    if (!entry) return undefined;
    return signStatement(this.key, "awp-agent-registration+jws", {
      ...entry,
      type: "AgentRegistration",
      id: `urn:registration:${digestOf(actor).slice(8)}`,
      issuer: this.identity,
      request,
      issuedAt: this.now(),
      validUntil: new Date(Date.parse(this.now()) + 60000).toISOString(),
    });
  }
  async verify(
    jws: string | undefined,
    request: string,
    expected: {
      actor: string;
      principal: string;
      kid: string;
      operation: string;
      trust: TrustStore;
      accepted: boolean;
    },
  ): Promise<
    | { ok: true; entry: AgentRegistration; digest: string; credential: string }
    | {
        ok: false;
        reason:
          | "representation-invalid"
          | "representation-out-of-scope"
          | "mandate-withdrawn"
          | "lookup-failed";
      }
  > {
    if (!expected.accepted || !jws) return { ok: false, reason: "lookup-failed" };
    const checked = await verifyStatement(jws, {
      trust: expected.trust,
      typ: "awp-agent-registration+jws",
      role: "issuer",
      schema: entrySchema,
      limits: DEFAULT_LIMITS,
      verifier: expected.principal,
      at: this.now(),
    });
    if (
      checked.verification.outcome !== "valid" ||
      checked.signer?.subject !== this.identity ||
      !checked.payload
    )
      return { ok: false, reason: "representation-invalid" };
    const credential = EmbeddedCredentialNode.fromJws(
      jws,
      "urn:awp:registration:" + digestOf(jws).slice(8),
      new Store(),
    );
    const entry = credential.payload as unknown as AgentRegistration;
    if (
      entry.issuer !== this.identity ||
      entry.actor !== expected.actor ||
      entry.principal !== expected.principal ||
      entry.actorKid !== expected.kid ||
      entry.request !== request
    )
      return { ok: false, reason: "representation-invalid" };
    if (
      Date.parse(entry.issuedAt) > Date.parse(this.now()) ||
      Date.parse(entry.validUntil) <= Date.parse(this.now()) ||
      Date.parse(entry.validUntil) - Date.parse(entry.issuedAt) > 60000
    )
      return { ok: false, reason: "lookup-failed" };
    if (entry.status !== "active") return { ok: false, reason: "mandate-withdrawn" };
    if (!entry.operations.includes(expected.operation))
      return { ok: false, reason: "representation-out-of-scope" };
    return { ok: true, entry, digest: digestOf(jws), credential: jws };
  }
  async check(expected: Parameters<FictionalAgentRegistry["verify"]>[2]) {
    const request = `urn:registry-query:${++this.nonce}`;
    return this.verify(await this.lookup(expected.actor, request), request, expected);
  }
}
