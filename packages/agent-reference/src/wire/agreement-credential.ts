// AUTHORED-BY Codex GPT-6
/** Native Data Integrity proof sets carried as original signed evidence in the RDF message. */
import {
  type Credential,
  countersign,
  credentialToRdf,
  type DataIntegrityProof,
  DataIntegritySuite,
  issue,
  type VerifiableCredential,
} from "@jeswr/solid-vc";
import { importJWK } from "jose";
import { z } from "zod";
import { canonicalJson, digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { SigningKey } from "../mechanisms/jws.js";
import type { MandateStatusLists } from "../mechanisms/mandate-status.js";
import { signStatement } from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { copyData } from "../model/copy.js";
import type { AnyMessage, EvidenceItem } from "../model/inputs.js";
import { MessageNode } from "../model/message-nodes.js";
import { SuiteValuesNode } from "../model/suite-values.js";
import { AWP } from "../profile/vocabulary.js";
import { verifyCompact } from "./jws-compact.js";

const FORMAT = "agreement-credential+jws";
const TYP = "awp-agreement-credential+jws";
const ODRL = "http://www.w3.org/ns/odrl/2/";
const proofSchema = z.strictObject({
  type: z.literal("DataIntegrityProof"),
  cryptosuite: z.literal("eddsa-rdfc-2022"),
  verificationMethod: z.string(),
  proofPurpose: z.literal("assertionMethod"),
  created: z.iso.datetime(),
  proofValue: z.string(),
});
const statusSchema = z.strictObject({
  type: z.literal("BitstringStatusListEntry"),
  statusPurpose: z.enum(["suspension", "revocation"]),
  statusListIndex: z.string(),
  statusListCredential: z.string(),
});
const credentialSchema = z.strictObject({
  id: z.string(),
  type: z.array(z.string()),
  issuer: z.string(),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  credentialSubject: z.record(z.string(), z.json()),
  credentialStatus: z.array(statusSchema),
  proof: z.union([proofSchema, z.array(proofSchema).min(1).max(2)]),
});
const envelopeSchema = z.strictObject({
  issuer: z.string(),
  type: z.literal("AgreementCredentialEnvelope"),
  credential: credentialSchema,
});
export type CredentialCheck = {
  state: "not-applicable" | "offer" | "agreement" | "invalid";
  reason?: "evidence-invalid" | "no-agreement" | "expired" | "status-withdrawn" | "lookup-failed";
  credential?: VerifiableCredential;
};
export function agreementMessageNode(message: AnyMessage | undefined): MessageNode | undefined {
  return message instanceof MessageNode
    ? message
    : message
      ? MessageNode.toNode(copyData(message))
      : undefined;
}
export class AgreementCredentialError extends Error {
  constructor(readonly reason: NonNullable<CredentialCheck["reason"]>) {
    super("The agreement credential cannot authorize this acceptance.");
  }
}

export class AgreementCredentialProtocol {
  private readonly agreements = new Map<string, string>();
  constructor(
    readonly status: MandateStatusLists,
    readonly omitAcceptorProof = false,
  ) {}
  current(digest: string): boolean {
    const until = this.agreements.get(digest);
    return (
      !!until &&
      Date.parse(this.status.now()) < Date.parse(until) &&
      this.status.current() === undefined
    );
  }

  private async key(key: SigningKey) {
    return {
      privateKey: key.privateKey,
      publicKey: (await importJWK(key.publicJwk, "EdDSA")) as CryptoKey,
      verificationMethod: "urn:awp:key:" + key.kid,
    };
  }
  private terms(offer: MessageNode) {
    const m = offer.live;
    if (m.kind !== "propose" || !m.body.terms.compensation) return undefined;
    return copyData(m.body.terms);
  }
  private binding(offer: MessageNode): string {
    const m = offer.live;
    if (m.kind !== "propose") throw new TypeError("Expected offer");
    return digestOf({ termsDigest: m.body.termsDigest, offeror: m.from, offeree: m.to }).slice(8);
  }
  private subject(offer: MessageNode) {
    const m = offer.live;
    if (m.kind !== "propose") throw new TypeError("Expected offer");
    const offeree = m.to?.party;
    const offeror = m.from.onBehalfOf;
    if (!offeree || !offeror)
      throw new TypeError("A valuation offer must identify both principals.");
    return {
      id: "urn:awp:agreement:" + this.binding(offer),
      [AWP + "termsDigest"]: m.body.termsDigest,
      [AWP + "terms"]: this.terms(offer)!,
      [ODRL + "assigner"]: offeror,
      [ODRL + "assignee"]: offeree,
    };
  }
  private async evidence(
    vc: VerifiableCredential,
    key: SigningKey,
    actor: string,
  ): Promise<EvidenceItem> {
    return {
      role: "authorisation",
      format: FORMAT,
      value: await signStatement(key, TYP, {
        type: "AgreementCredentialEnvelope",
        issuer: actor,
        credential: vc,
      }),
    };
  }
  async offer(message: MessageNode, key: SigningKey): Promise<EvidenceItem | undefined> {
    const terms = this.terms(message);
    if (!terms) return undefined;
    const m = message.live;
    const credential: Credential = {
      id: "urn:awp:valuation-credential:" + this.binding(message),
      type: [ODRL + "Agreement"],
      issuer: m.from.onBehalfOf!,
      validFrom: String(terms.validFrom),
      validUntil: String(terms.validUntil),
      credentialSubject: this.subject(message),
      credentialStatus: this.status.entries,
    };
    const vc = await issue({
      credential,
      key: await this.key(key),
      options: { created: new Date(m.createdAt) },
    });
    return this.evidence(vc, key, m.from.actor!);
  }
  private async read(
    message: MessageNode,
    trust: TrustStore,
  ): Promise<VerifiableCredential | undefined> {
    const m = message.live;
    const evidence = (m.evidence ?? []).filter(
      (e) => e.format === FORMAT && e.role === "authorisation",
    );
    if (evidence.length !== 1) return undefined;
    const checked = await verifyCompact(evidence[0]!.value, {
      typ: TYP,
      resolve: trust.resolver("actor", ["EdDSA"]),
      allowedAlgs: ["EdDSA"],
      limits: DEFAULT_LIMITS,
    });
    const parsed = envelopeSchema.safeParse(
      checked.outcome === "valid" ? checked.payload : undefined,
    );
    if (
      !parsed.success ||
      parsed.data.issuer !== m.from.actor ||
      checked.outcome !== "valid" ||
      trust.resolver("actor")(checked.kid)?.subject !== m.from.actor
    )
      return undefined;
    // Read the same admitted RDF payload, not an unverified compact-token projection.
    const item = message.evidence?.find((e) => e.format === FORMAT);
    if (!item?.credential?.projectionMatches(item.format)) return undefined;
    const payload = SuiteValuesNode.fromSignedPayload(item.credential.payload);
    const native = payload.node("credential")?.toObject();
    if (!native || canonicalJson(native) !== canonicalJson(parsed.data.credential))
      return undefined;
    return native as unknown as VerifiableCredential;
  }
  private async verify(
    vc: VerifiableCredential,
    offer: MessageNode,
    trust: TrustStore,
    at: string,
  ): Promise<CredentialCheck> {
    const m = offer.live,
      terms = this.terms(offer);
    if (
      !terms ||
      m.kind !== "propose" ||
      !m.from.actor ||
      !m.from.onBehalfOf ||
      !m.to?.actor ||
      !m.to.party ||
      m.from.actor === m.to.actor ||
      this.status.owner !== m.from.onBehalfOf
    )
      return { state: "invalid", reason: "evidence-invalid" };
    if (
      vc.issuer !== m.from.onBehalfOf ||
      canonicalJson(vc.credentialSubject) !== canonicalJson(this.subject(offer)) ||
      vc.id !== "urn:awp:valuation-credential:" + this.binding(offer) ||
      canonicalJson(vc.type) !== canonicalJson([ODRL + "Agreement"]) ||
      vc.validFrom !== terms.validFrom ||
      vc.validUntil !== terms.validUntil
    )
      return { state: "invalid", reason: "evidence-invalid" };
    if (
      !vc.validFrom ||
      !vc.validUntil ||
      !Number.isFinite(Date.parse(at)) ||
      Date.parse(at) < Date.parse(vc.validFrom) ||
      Date.parse(at) >= Date.parse(vc.validUntil)
    )
      return { state: "invalid", reason: "expired" };
    const proofs = Array.isArray(vc.proof) ? vc.proof : [vc.proof];
    if (proofs.length < 1 || proofs.length > 2)
      return { state: "invalid", reason: "evidence-invalid" };
    const parties = [
      { actor: m.from.actor, party: m.from.onBehalfOf },
      { actor: m.to.actor, party: m.to.party },
    ];
    const { proof: _proof, ...unsigned } = vc;
    const quads = credentialToRdf(unsigned);
    const signers = new Set<string>();
    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i] as DataIntegrityProof;
      const pinned = trust.resolver("actor", ["EdDSA"])(
        proof.verificationMethod.replace(/^urn:awp:key:/, ""),
      );
      const expected = parties.find(
        (party) => party.actor === pinned?.subject && party.party === pinned?.party,
      );
      if (
        !pinned ||
        !expected ||
        signers.has(pinned.subject) ||
        (proofs.length === 1 && pinned.subject !== parties[0]!.actor) ||
        proof.verificationMethod !== "urn:awp:key:" + pinned.kid ||
        proof.proofPurpose !== "assertionMethod" ||
        !proof.created ||
        Date.parse(proof.created) > Date.parse(at) ||
        Date.parse(proof.created) < Date.parse(vc.validFrom) ||
        !(await new DataIntegritySuite("eddsa-rdfc-2022").verify(quads, proof, {
          resolveKey: async (method) =>
            method === proof.verificationMethod
              ? ((await importJWK(pinned.publicJwk, "EdDSA")) as CryptoKey)
              : undefined,
        }))
      )
        return { state: "invalid", reason: "evidence-invalid" };
      signers.add(pinned.subject);
    }
    if (proofs.length === 2 && proofs[0]!.verificationMethod === proofs[1]!.verificationMethod)
      return { state: "invalid", reason: "evidence-invalid" };
    const status = await this.status.check(vc.credentialStatus);
    if (status)
      return {
        state: "invalid",
        reason: status === "mandate-withdrawn" ? "status-withdrawn" : "lookup-failed",
      };
    return { state: proofs.length === 2 ? "agreement" : "offer" };
  }
  async check(
    message: MessageNode,
    offer: MessageNode | undefined,
    trust: TrustStore,
    at: string,
  ): Promise<CredentialCheck> {
    try {
      const m = message.live;
      if (m.kind === "propose") offer = message;
      if (m.kind === "accept" && !offer) return { state: "invalid", reason: "no-agreement" };
      if (!offer || !this.terms(offer))
        return (m.evidence ?? []).some((item) => item.format === FORMAT)
          ? { state: "invalid", reason: "evidence-invalid" }
          : { state: "not-applicable" };
      const vc = await this.read(message, trust);
      if (!vc) return { state: "invalid", reason: "evidence-invalid" };
      const result = await this.verify(vc, offer, trust, at);
      if (m.kind === "accept") {
        const original = offer.live;
        if (
          original.kind !== "propose" ||
          m.body.termsDigest !== original.body.termsDigest ||
          m.from.actor !== original.to?.actor ||
          m.from.onBehalfOf !== original.to?.party ||
          m.to?.actor !== original.from.actor ||
          m.to?.party !== original.from.onBehalfOf
        )
          return { state: "invalid", reason: "evidence-invalid" };
        if (result.state === "offer")
          return { state: "offer", reason: "no-agreement", credential: copyData(vc) };
        if (result.state === "agreement") this.agreements.set(m.body.termsDigest, vc.validUntil!);
      } else if (result.state !== "offer") return { state: "invalid", reason: "evidence-invalid" };
      return result.state === "invalid" ? result : { ...result, credential: copyData(vc) };
    } catch {
      return { state: "invalid", reason: "evidence-invalid" };
    }
  }
  async accept(
    offer: MessageNode,
    key: SigningKey,
    trust: TrustStore,
    at: string,
  ): Promise<{ evidence: EvidenceItem; complete: boolean } | undefined> {
    if (!this.terms(offer)) return undefined;
    const vc = await this.read(offer, trust);
    if (!vc) throw new AgreementCredentialError("evidence-invalid");
    const checked = await this.verify(vc, offer, trust, at);
    if (checked.state !== "offer")
      throw new AgreementCredentialError(checked.reason ?? "evidence-invalid");
    const m = offer.live;
    if (m.kind !== "propose" || trust.resolver("actor")(key.kid)?.subject !== m.to?.actor)
      throw new TypeError("The acceptor key does not match the offer");
    const signed = this.omitAcceptorProof
      ? vc
      : await countersign(vc, await this.key(key), { options: { created: new Date(at) } });
    const complete = (await this.verify(signed, offer, trust, at)).state === "agreement";
    if (complete) this.agreements.set(m.body.termsDigest, signed.validUntil!);
    return { evidence: await this.evidence(signed, key, m.to!.actor!), complete };
  }
}
