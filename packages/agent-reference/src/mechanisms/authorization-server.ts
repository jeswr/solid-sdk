// AUTHORED-BY Codex GPT-6
/** Closed RFC 9396 grant profile with RFC 8693 actor and a key confirmation thumbprint. */

import { Store } from "n3";
import { z } from "zod";
import { canonicalJson, digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { EmbeddedCredentialNode } from "../model/evidence-item.js";
import { NamedValuesNode } from "../model/named-values.js";
import { type SigningKey, verifyCompact } from "./jws.js";
import { type LoadedMandate, mandateSchema, type OwnerMandate } from "./mandate.js";
import { signStatement, verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";

const detail = z.strictObject({
  type: z.literal("answerable_odrl"),
  actions: z.array(z.string()),
  locations: z.array(z.string()),
  approval_required: z.boolean(),
  policy: mandateSchema.shape.autonomous,
});
export const authorizationGrantSchema = z.strictObject({
  iss: z.string(),
  sub: z.string(),
  aud: z.array(z.string()).min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  act: z.strictObject({ sub: z.string() }).optional(),
  cnf: z.strictObject({ jkt: z.string() }),
  jti: z.string(),
  authorization_details: z.array(detail).length(2),
  mandate_id: z.string(),
  mandate_version: z.number().int().positive(),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export type AuthorizationGrant = z.infer<typeof authorizationGrantSchema>;
const actions = (policy: OwnerMandate["autonomous"]) =>
  [
    ...new Set(
      [...(policy.permissions ?? []), ...(policy.prohibitions ?? [])].map((r) => r.action),
    ),
  ].sort();
const locations = (policy: OwnerMandate["autonomous"]) =>
  [
    ...new Set(
      [...(policy.permissions ?? []), ...(policy.prohibitions ?? [])].flatMap((r) =>
        r.target ? [r.target] : [],
      ),
    ),
  ].sort();
export class FictionalAuthorizationServer {
  private withdrawn = false;
  private checkedAt = -Infinity;
  private statusFailure: "mandate-withdrawn" | "lookup-failed" | undefined = "lookup-failed";
  available = true;
  revoke(): void {
    this.withdrawn = true;
    this.checkedAt = -Infinity;
  }
  async refreshStatus(): Promise<void> {
    if (!this.available) {
      this.statusFailure = "lookup-failed";
      this.checkedAt = Date.parse(this.now());
      return;
    }
    const status = await signStatement(this.key, "awp-grant-status+jws", {
      issuer: this.identity,
      active: !this.withdrawn,
      at: this.now(),
      validUntil: new Date(Date.parse(this.now()) + 60000).toISOString(),
    });
    const result = await verifyCompact(status, {
      typ: "awp-grant-status+jws",
      allowedAlgs: ["EdDSA"],
      limits: DEFAULT_LIMITS,
      resolve: (kid) => (kid === this.key.kid ? this.key : undefined),
    });
    const parsed =
      result.outcome === "valid"
        ? z
            .strictObject({
              issuer: z.string(),
              active: z.boolean(),
              at: z.iso.datetime(),
              validUntil: z.iso.datetime(),
            })
            .safeParse(result.payload)
        : undefined;
    this.statusFailure =
      !parsed?.success ||
      parsed.data.issuer !== this.identity ||
      Date.parse(parsed.data.validUntil) <= Date.parse(this.now())
        ? "lookup-failed"
        : parsed.data.active
          ? undefined
          : "mandate-withdrawn";
    this.checkedAt = Date.parse(this.now());
  }
  current(): "mandate-withdrawn" | "lookup-failed" | undefined {
    return Date.parse(this.now()) - this.checkedAt < 60000 ? this.statusFailure : "lookup-failed";
  }
  constructor(
    readonly identity: string,
    readonly key: SigningKey,
    readonly now: () => string,
  ) {}
  /** Principal consent is itself verified; callers cannot manufacture approval with a boolean. */
  async issue(
    mandate: OwnerMandate,
    actorKid: string,
    audiences: readonly string[],
    consent: string,
    principalTrust: TrustStore,
    withoutActor = false,
  ): Promise<string> {
    const approved = await verifyStatement(consent, {
      trust: principalTrust,
      typ: "awp-grant-consent+jws",
      role: "party",
      schema: z.strictObject({
        issuer: z.string(),
        actor: z.string(),
        kid: z.string(),
        mandateDigest: z.string(),
        validUntil: z.iso.datetime(),
      }),
      limits: DEFAULT_LIMITS,
      verifier: this.identity,
      at: this.now(),
    });
    const c = approved.payload;
    if (
      !c ||
      approved.verification.outcome !== "valid" ||
      approved.signer?.subject !== mandate.issuer ||
      c.issuer !== mandate.issuer ||
      c.actor !== mandate.subject ||
      c.kid !== actorKid ||
      c.mandateDigest !== digestOf(mandate) ||
      Date.parse(c.validUntil) <= Date.parse(this.now())
    )
      throw new Error("Principal consent is not bound to this grant");
    await this.refreshStatus();
    return signStatement(this.key, "at+jwt", {
      iss: this.identity,
      sub: mandate.issuer,
      aud: [...audiences],
      iat: Math.floor(Date.parse(this.now()) / 1000),
      exp: Math.floor(Date.parse(mandate.validUntil) / 1000),
      ...(!withoutActor ? { act: { sub: mandate.subject } } : {}),
      cnf: { jkt: actorKid },
      jti: `${mandate.id}:grant`,
      mandate_id: mandate.id,
      mandate_version: mandate.version,
      validFrom: mandate.validFrom,
      validUntil: mandate.validUntil,
      authorization_details: [mandate.autonomous, mandate.withApproval].map((policy, i) => ({
        type: "answerable_odrl",
        actions: actions(policy),
        locations: locations(policy),
        approval_required: i === 1,
        policy,
      })),
    });
  }
  async verify(
    jws: string,
    input: {
      trust: TrustStore;
      actor: string;
      party: string;
      kid: string;
      audience: string;
      accepted: boolean;
    },
  ) {
    const checked = await verifyStatement(jws, {
      trust: input.trust,
      typ: "at+jwt",
      role: "issuer",
      schema: authorizationGrantSchema,
      limits: DEFAULT_LIMITS,
      verifier: input.audience,
      at: this.now(),
    });
    const invalid = (
      reason:
        | "representation-invalid"
        | "mandate-withdrawn"
        | "lookup-failed" = "representation-invalid",
    ) => ({ ok: false as const, reason, verification: checked.verification });
    if (
      !input.accepted ||
      checked.signer?.subject !== this.identity ||
      !checked.payload ||
      checked.verification.outcome !== "valid"
    )
      return invalid();
    await this.refreshStatus();
    if (this.current()) return invalid(this.current());
    const credential = EmbeddedCredentialNode.fromJws(
      jws,
      "urn:awp:authority-grant:" + digestOf(jws).slice(8),
      new Store(),
    );
    const grant = credential.payload as unknown as AuthorizationGrant;
    if (
      grant.iss !== this.identity ||
      grant.sub !== input.party ||
      grant.act?.sub !== input.actor ||
      grant.cnf.jkt !== input.kid ||
      !grant.aud.includes(input.audience) ||
      grant.iat > Date.parse(this.now()) / 1000 ||
      grant.exp <= Date.parse(this.now()) / 1000 ||
      Date.parse(grant.validFrom) > Date.parse(this.now()) ||
      Date.parse(grant.validUntil) <= Date.parse(this.now())
    )
      return invalid();
    const autonomous = grant.authorization_details.find((d) => !d.approval_required),
      withApproval = grant.authorization_details.find((d) => d.approval_required);
    if (!autonomous || !withApproval) return invalid();
    for (const d of grant.authorization_details) {
      const p = d.policy as OwnerMandate["autonomous"];
      if (
        p.assigner !== grant.sub ||
        p.assignee !== grant.act.sub ||
        canonicalJson(d.actions) !== canonicalJson(actions(p)) ||
        canonicalJson(d.locations) !== canonicalJson(locations(p))
      )
        return invalid();
    }
    const lifted: OwnerMandate = {
      type: "OwnerMandate",
      id: grant.mandate_id,
      version: grant.mandate_version,
      issuer: grant.sub,
      subject: grant.act.sub,
      validFrom: grant.validFrom,
      validUntil: grant.validUntil,
      autonomous: autonomous.policy as OwnerMandate["autonomous"],
      withApproval: withApproval.policy as OwnerMandate["autonomous"],
    };
    const view = NamedValuesNode.from(lifted as never, "urn:awp:lifted-mandate", new Store());
    const loaded: LoadedMandate = {
      mandate: view.live as unknown as OwnerMandate,
      credential,
      digest: digestOf(lifted),
      verification: checked.verification,
    };
    return { ok: true as const, loaded };
  }
}
