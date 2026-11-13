/**
 * Helpers shared by the extension scenarios: provision parties/agents with bounded
 * mandates, perform the reviewed introductions, pin issuers and source rules, start
 * runtimes, and produce owner approvals. Every scenario still runs the same runtime.
 */
import type { OdrlRule } from "@jeswr/solid-odrl";
import { newUrn, scopedUrn } from "../core/canonical.js";
import type { Iri } from "../core/types.js";
import { generateSigningKey, type SigningKey } from "../mechanisms/jws.js";
import { type OwnerMandate, signApproval } from "../mechanisms/mandate.js";
import { signStatement, TYP } from "../mechanisms/statements.js";
import { type SourceAuthorityRule, TrustStore, type TrustStoreData } from "../mechanisms/trust.js";
import { CONFIG_ED25519 } from "../profile/configurations.js";
import { AgentRuntime } from "../runtime/agent.js";
import type { EffectAdapter, OperationHandler } from "../runtime/operations.js";
import {
  addSourceRule,
  type Identity,
  introduce,
  type ProvisionedAgent,
  pinIssuer,
  provisionAgent,
  reissue,
} from "../setup.js";
import { MemoryLedger } from "../store/ledger.js";
import { MemoryStateStore } from "../store/state.js";
import { scenarioPolicyEngine } from "./policy.js";

export type Ids = { owner: Iri; actor: Iri; validFrom: string; validUntil: string };

/**
 * Build a mandate factory from explicit autonomous / with-approval rules. A rule id given as
 * a local label (`"#compare"`) is minted here, where the actor is known, as
 * `scopedUrn("rule", actor, label)` — a relative reference is not a valid rule identifier.
 */
export function mandateOf(
  label: string,
  autonomousRules: OdrlRule[],
  withApprovalRules: OdrlRule[] = [],
  prohibitionRules: OdrlRule[] = [],
) {
  return (ids: Ids): OwnerMandate => {
    const mint = (rules: OdrlRule[]): OdrlRule[] =>
      rules.map((r) =>
        r.id?.startsWith("#") ? { ...r, id: scopedUrn("rule", ids.actor, r.id.slice(1)) } : r,
      );
    return build(ids, mint(autonomousRules), mint(withApprovalRules), mint(prohibitionRules));
  };
  function build(
    ids: Ids,
    autonomous: OdrlRule[],
    withApproval: OdrlRule[],
    prohibitions: OdrlRule[],
  ): OwnerMandate {
    return {
      type: "OwnerMandate",
      id: scopedUrn("mandate", ids.actor, label),
      version: 1,
      issuer: ids.owner,
      subject: ids.actor,
      validFrom: ids.validFrom,
      validUntil: ids.validUntil,
      autonomous: {
        id: scopedUrn("policy", ids.actor, `${label}/autonomous`),
        type: "Set",
        assigner: ids.owner,
        assignee: ids.actor,
        conflict: "prohibit",
        permissions: autonomous,
        prohibitions,
      },
      withApproval: {
        id: scopedUrn("policy", ids.actor, `${label}/with-approval`),
        type: "Set",
        assigner: ids.owner,
        assignee: ids.actor,
        conflict: "prohibit",
        permissions: withApproval,
        prohibitions,
      },
      note: `Synthetic ${label} mandate (pilot subset).`,
    };
  }
}

/** A permission rule in the pilot subset. */
export function permit(
  action: OdrlRule["action"],
  target: Iri,
  purposes: readonly Iri[],
  recipients?: readonly Iri[],
  id?: string,
): OdrlRule {
  return {
    ...(id ? { id } : {}),
    type: "permission",
    action,
    target,
    constraints: [
      { leftOperand: "purpose", operator: "isAnyOf", rightOperand: [...purposes] },
      ...(recipients
        ? [
            {
              leftOperand: "recipient" as const,
              operator: "isAnyOf" as const,
              rightOperand: [...recipients],
            },
          ]
        : []),
    ],
  };
}

export class Cast {
  readonly agents = new Map<string, ProvisionedAgent>();
  readonly trust = new Map<string, TrustStoreData>();

  constructor(private readonly now: () => Date) {}

  async add(
    identity: Identity,
    mandate: (ids: Ids) => OwnerMandate,
    representationOps: readonly Iri[],
    opts: { ownerKey?: SigningKey } = {},
  ): Promise<ProvisionedAgent> {
    const p = await provisionAgent({
      identity,
      now: this.now(),
      mandate,
      representationOperations: representationOps,
      validityDays: 60,
    });
    let agent = p;
    if (opts.ownerKey) {
      // Several agents of one organisation share the organisation's (party) key.
      agent = await reissue(
        { ...p, ownerKey: opts.ownerKey },
        { now: this.now(), mandate, representationOperations: representationOps, validityDays: 60 },
      );
      agent = {
        ...agent,
        trust: {
          ...p.trust,
          keys: [
            {
              role: "party",
              subject: identity.party,
              kid: opts.ownerKey.kid,
              alg: opts.ownerKey.alg,
              publicJwk: opts.ownerKey.publicJwk,
              note: "organisation key",
            },
          ],
        },
        card: {
          ...agent.card,
          partyKey: {
            kid: opts.ownerKey.kid,
            alg: opts.ownerKey.alg,
            publicJwk: opts.ownerKey.publicJwk,
          },
        },
      };
    }
    this.agents.set(identity.name, agent);
    this.trust.set(identity.name, agent.trust);
    return agent;
  }

  get(name: string): ProvisionedAgent {
    const a = this.agents.get(name);
    if (!a) throw new Error(`no agent ${name}`);
    return a;
  }

  /** The reviewed introduction, both directions. */
  introduce(a: string, b: string): void {
    this.trust.set(a, introduce(this.trust.get(a) as TrustStoreData, this.get(b).card));
    this.trust.set(b, introduce(this.trust.get(b) as TrustStoreData, this.get(a).card));
  }

  /** One-directional: `who` pins `whom` (e.g. a public client pinning a published service key). */
  pin(who: string, whom: string): void {
    this.trust.set(who, introduce(this.trust.get(who) as TrustStoreData, this.get(whom).card));
  }

  pinIssuer(who: string, issuer: Iri, key: SigningKey, note?: string): void {
    this.trust.set(who, pinIssuer(this.trust.get(who) as TrustStoreData, issuer, key, note));
  }

  rule(who: string, rule: SourceAuthorityRule): void {
    this.trust.set(who, addSourceRule(this.trust.get(who) as TrustStoreData, rule));
  }

  async runtime(
    name: string,
    handlers: OperationHandler[],
    effects: EffectAdapter[] = [],
    accepted: string[] = [CONFIG_ED25519],
  ): Promise<{ runtime: AgentRuntime; ledger: MemoryLedger }> {
    const p = this.get(name);
    const ledger = new MemoryLedger();
    const runtime = await AgentRuntime.create({
      identity: {
        actor: p.identity.actor,
        party: p.identity.party,
        ...(p.identity.operator ? { operator: p.identity.operator } : {}),
      },
      actorKeys: [p.actorKey],
      trust: await TrustStore.load(this.trust.get(name)),
      mandateJws: p.mandateJws,
      representationJws: p.representationJws,
      accepted,
      handlers,
      effects,
      store: new MemoryStateStore(),
      ledger,
      now: this.now,
      ...(scenarioPolicyEngine() ? { policyEngine: scenarioPolicyEngine() } : {}),
    });
    return { runtime, ledger };
  }

  /** The represented party (owner) approves or denies one exact pending action. */
  approval(
    name: string,
    actionDigest: string,
    conversation: Iri,
    decision: "approve" | "deny" = "approve",
  ): Promise<string> {
    const p = this.get(name);
    return signApproval(p.ownerKey, {
      type: "OwnerApproval",
      id: newUrn(),
      issuer: p.identity.party,
      actor: p.identity.actor,
      actionDigest,
      conversation,
      decision,
      issuedAt: this.now().toISOString(),
      validUntil: new Date(this.now().getTime() + 3_600_000).toISOString(),
      note: "synthetic owner decision (scripted in the scenario driver)",
    });
  }
}

/**
 * Test-harness only: sign an arbitrary message with an agent's REAL actor key, bypassing
 * its runtime (models a buggy or compromised client) so responder-side checks can be shown.
 */
export async function craftSigned(
  agent: ProvisionedAgent,
  message: object,
): Promise<{ format: "awp-jws-compact/0.1"; jws: string }> {
  return {
    format: "awp-jws-compact/0.1",
    jws: await signStatement(agent.actorKey, TYP.message, message),
  };
}

export async function newIssuer(): Promise<SigningKey> {
  return (await generateSigningKey("EdDSA")).key;
}

export function signClaim(key: SigningKey, statement: object): Promise<string> {
  return signStatement(key, TYP.statement, statement);
}
