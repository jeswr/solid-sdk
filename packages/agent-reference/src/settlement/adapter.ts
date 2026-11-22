// AUTHORED-BY Codex GPT-6
/** Host-side protocol admission. No protocol parser or signing handle is exposed to a core. */

import { Store } from "n3";
import { z } from "zod";
import { canonicalJson, digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { paymentDigest, sameAmount } from "../gates/payment.js";
import {
  type PublicKeyRecord,
  type SigningKey,
  signCompact,
  verifyCompact,
} from "../mechanisms/jws.js";
import { PaymentAgreementNode, PaymentFacts, paymentOnceKey } from "../model/payment.js";
import { paymentDocument } from "../wire/payment.js";
import { decodeBase64url, type HttpExchange, strictJson } from "./http.js";
import type { Ledger } from "./ledger.js";
import type {
  AmountDue,
  CheckedPayment,
  ProtocolObjects,
  ProviderContext,
  SettlementTrace,
} from "./types.js";

export type Step = "payment-request" | "payment" | "payment-receipt" | "protocol-key";
export interface PartyProfile {
  party: string;
  identity: PublicKeyRecord;
}
export interface AdapterProfile {
  payer: PartyProfile & { account: string };
  merchant: PartyProfile & { account: string };
  provider: PartyProfile & { signingKey: SigningKey };
  currency: string;
  decimals: number;
  ledger: Ledger;
  now: () => string;
  /** Mandatory host seam: run the ordinary inbound gates over the actual enclosing message.
   * A signature or successful protocol check cannot substitute for this admission.
   * This callback must reject on failure and bind the complete content and routing.
   */
  admit: (source: string, step: Step, objects: ProtocolObjects) => Promise<void>;
}
export class SettlementError extends Error {
  constructor(
    readonly reason:
      | "evidence-invalid"
      | "source-not-authoritative"
      | "terms-digest-mismatch"
      | "unsigned-not-allowed",
    readonly protocolCode?: string,
    readonly exchange?: HttpExchange,
  ) {
    super(protocolCode ? `${reason}: ${protocolCode}` : reason);
  }
}
export function invalid(code?: string, exchange?: HttpExchange): never {
  throw new SettlementError("evidence-invalid", code, exchange);
}
export function protocolFailure(error: unknown): never {
  if (error instanceof SettlementError) throw error;
  return invalid();
}
export function requireValue<T>(value: T | undefined): T {
  if (value === undefined) return invalid();
  return value;
}
export function seconds(profile: AdapterProfile): number {
  const n = Date.parse(profile.now()) / 1000;
  if (!Number.isFinite(n) || n < 0) return invalid();
  return Math.floor(n);
}
export function nonceOf(onceKey: string): string {
  return `0x${digestOf(onceKey).slice("sha-256:".length)}`;
}
export function httpObject(
  name: string,
  exchange: HttpExchange,
  shown: unknown,
): ProtocolObjects["objects"][number] {
  return {
    name,
    form:
      (
        {
          PaymentRequired: "HTTP header, base64 JSON",
          PaymentPayload: "HTTP header, base64 JSON",
          SettlementResponse: "HTTP header, base64 JSON",
          Challenge: "HTTP authentication parameters; request is base64url JCS",
          Credential: "HTTP Authorization, base64url JSON",
          "Payment-Receipt": "HTTP header, base64url JSON",
        } as Record<string, string>
      )[name] ?? "HTTP exchange",
    raw: structuredClone(exchange),
    shown: structuredClone(shown),
  };
}
export function jwtShown(raw: string): unknown {
  try {
    const parts = raw.split(".");
    if (parts.length !== 3) return invalid();
    return {
      header: strictJson(decodeBase64url(requireValue(parts[0]))),
      payload: strictJson(decodeBase64url(requireValue(parts[1]))),
    };
  } catch (error) {
    return protocolFailure(error);
  }
}
export function keyObject(
  name: string,
  statement: string | undefined,
): ProtocolObjects["objects"][number] {
  const raw = requireValue(statement);
  return {
    name: `SettlementKey (${name})`,
    form: "identity-signed JWS (local profile)",
    raw,
    shown: jwtShown(raw),
  };
}
export function rawExchange(objects: ProtocolObjects, name: string): HttpExchange {
  const candidates = objects.objects.filter((o) => o.name === name);
  if (candidates.length !== 1) return invalid();
  const parsed = z
    .strictObject({
      method: z.string(),
      path: z.string(),
      status: z.number().int().optional(),
      headers: z.record(z.string(), z.string()),
      body: z.json(),
    })
    .safeParse(candidates[0]?.raw);
  if (!parsed.success) return invalid();
  return parsed.data;
}
export function rawToken(objects: ProtocolObjects, name: string): string {
  const candidates = objects.objects.filter((o) => o.name === name);
  if (candidates.length !== 1 || typeof candidates[0]?.raw !== "string") return invalid();
  return candidates[0].raw;
}
export function bundle(suite: string, objects: ProtocolObjects["objects"]): ProtocolObjects {
  return { suite, objects: structuredClone(objects) };
}

/** Async verifiers in each lift.ts admit exact objects here. Synchronous lift never parses
 * unverified data or trusts the caller's `native` property. Returned datasets are copies.
 */
export class LiftStore {
  private readonly admitted = new Map<
    string,
    { facts: PaymentFacts; from: Record<string, string>; objects: ProtocolObjects }
  >();
  constructor(readonly suite: string) {}
  private key(objects: ProtocolObjects): string {
    if (objects.suite !== this.suite) return invalid();
    return digestOf({ suite: objects.suite, objects: objects.objects });
  }
  remember(
    objects: ProtocolObjects,
    facts: PaymentFacts,
    from: Record<string, string>,
  ): ProtocolObjects {
    const origins = { ...from };
    const supplied = {
      id: "not in protocol: host-minted payment document identifier",
      agreement: "not in protocol: host agreement association",
      payer: "not in protocol: admitted sender identity",
      payee: "not in protocol: accepted payee/account binding",
      account: "not in protocol: accepted host account binding",
      invoice: "not in protocol: host request-to-order association",
      onceKey: "not in protocol: engine agreement/instalment once-key",
      validUntil: "not in protocol: checked host order expiry",
      instalment: "not in protocol: held agreement instalment",
      kind: "not in protocol: local receipt classification",
      order: "not in protocol: recorded checked order association",
      provider: "not in protocol: admitted receipt issuer",
      status: "not in protocol: local successful-receipt classification",
      ledgerReference: "not in protocol: provider ledger statement",
      amount: "not in protocol: authenticated host statement",
      currency: "not in protocol: configured currency profile",
    };
    for (const field of Object.keys(supplied) as (keyof typeof supplied)[]) {
      const value = facts[field];
      if (
        value !== undefined &&
        !(typeof value === "number" && Number.isNaN(value)) &&
        !origins[field]
      )
        origins[field] = supplied[field];
    }
    this.admitted.set(this.key(objects), {
      facts: facts.snapshot(),
      from: origins,
      objects: bundle(this.suite, objects.objects),
    });
    return objects;
  }
  lift(objects: ProtocolObjects): PaymentFacts {
    const value = this.admitted.get(this.key(this.restore(objects)));
    if (!value) return invalid();
    return value.facts.snapshot();
  }
  restore(objects: ProtocolObjects): ProtocolObjects {
    this.key(objects);
    const direct = this.admitted.get(this.key(objects));
    if (direct) return bundle(this.suite, direct.objects.objects);
    if (objects.objects.length !== 1) return invalid();
    const object = objects.objects[0];
    const matches = [...this.admitted.values()].filter((v) =>
      v.objects.objects.some((o) => digestOf(o) === digestOf(object)),
    );
    if (!matches.length) return invalid();
    const last = requireValue(matches.at(-1));
    return bundle(this.suite, last.objects.objects);
  }
  find(facts: PaymentFacts): ProtocolObjects | undefined {
    return [...this.admitted.values()].findLast(
      (v) => v.facts.id === facts.id || v.facts.id === facts.invoice,
    )?.objects;
  }
  async trace(objects: ProtocolObjects): Promise<SettlementTrace> {
    objects = this.restore(objects);
    const facts = this.lift(objects);
    const from = requireValue(this.admitted.get(this.key(objects))).from;
    return {
      suite: this.suite,
      objects: structuredClone(objects.objects),
      facts: await paymentDocument(facts),
      from: { ...from },
    };
  }
}
export interface RequestAssociation<T> {
  due: AmountDue;
  facts: PaymentFacts;
  objects: ProtocolObjects;
  request: T;
}
export function snapshotDue(due: AmountDue): AmountDue {
  return {
    ...due,
    agreement: new PaymentAgreementNode(due.agreement.id, new Store([...due.agreement.dataset])),
  };
}
export function snapshotChecked(checked: CheckedPayment): CheckedPayment {
  return { facts: checked.facts.snapshot(), digest: checked.digest };
}
/** A protocol may retry one instruction, but cannot mint another instruction for its once-key. */
export class OnceAssociation {
  private readonly instructions = new Map<string, string>();
  check(onceKey: string, instruction: string): void {
    const old = this.instructions.get(onceKey);
    if (old !== undefined && old !== instruction) invalid();
  }
  claim(onceKey: string, instruction: string): void {
    this.check(onceKey, instruction);
    this.instructions.set(onceKey, instruction);
  }
}
export function invoiceFacts(
  due: AmountDue,
  payee: string,
  account: string,
  amount: string,
  currency: string,
): PaymentFacts {
  return PaymentFacts.invoiceFor({
    id: due.invoice,
    agreement: requireValue(due.agreement.digest),
    payee,
    account,
    amount,
    currency,
    dueDate: due.dueDate,
  });
}
/** Reuse the checked native request, rather than converting model money a second time. */
export function checkedRequest<T>(
  checked: CheckedPayment,
  profile: AdapterProfile,
  requests: Map<string, RequestAssociation<T>>,
): RequestAssociation<T> {
  const facts = checked.facts;
  const request = requireValue(requests.get(requireValue(facts.invoice)));
  if (
    checked.digest !== paymentDigest(facts) ||
    facts.payer !== profile.payer.party ||
    facts.agreement !== request.facts.agreement ||
    facts.payee !== request.facts.payee ||
    facts.account !== request.facts.account ||
    !sameAmount(facts.amount, request.facts.amount) ||
    facts.currency !== request.facts.currency ||
    facts.onceKey !== paymentOnceKey(requireValue(facts.agreement), facts.instalment) ||
    !facts.validUntil ||
    Date.parse(facts.validUntil) <= Date.parse(profile.now()) ||
    Date.parse(facts.validUntil) > Date.parse(request.due.agreement.validUntil ?? "")
  )
    return invalid();
  return request;
}
export function checkProvider(profile: AdapterProfile, provider: ProviderContext): void {
  if (
    provider.party !== profile.provider.party ||
    provider.payerAccount !== profile.payer.account ||
    provider.ledger !== profile.ledger ||
    provider.now !== profile.now()
  )
    invalid();
}
export async function verifyIdentity(
  token: string,
  identity: PublicKeyRecord,
  typ: string,
): Promise<unknown> {
  const result = await verifyCompact(token, {
    resolve: (kid) => (kid === identity.kid ? identity : undefined),
    typ,
    allowedAlgs: [identity.alg],
    limits: DEFAULT_LIMITS,
  });
  if (result.outcome !== "valid") return invalid();
  return result.payload;
}
/** Check host signing handles before a ledger effect, including non-extractable keys. */
export async function verifySigningHandle(key: SigningKey, pinned: PublicKeyRecord): Promise<void> {
  if (
    key.kid !== pinned.kid ||
    key.alg !== pinned.alg ||
    canonicalJson(key.publicJwk) !== canonicalJson(pinned.publicJwk)
  )
    invalid();
  await verifyIdentity(
    await signCompact(key, "awp-settlement-key-possession+jws", { key: pinned.kid }),
    pinned,
    "awp-settlement-key-possession+jws",
  );
}
const keyClaim = z.strictObject({
  type: z.literal("SettlementKey"),
  party: z.string(),
  suite: z.string(),
  algorithm: z.enum(["ES256", "secp256k1"]),
  publicKey: z.union([z.string(), z.record(z.string(), z.json())]),
  validFrom: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }),
});
export async function publishProtocolKey(
  identity: SigningKey,
  claim: z.infer<typeof keyClaim>,
): Promise<string> {
  return signCompact(identity, "awp-settlement-key+jws", keyClaim.parse(claim));
}
export async function checkProtocolKey(
  profile: AdapterProfile,
  suite: string,
  party: PartyProfile,
  algorithm: "ES256" | "secp256k1",
  publicKey: unknown,
  statement: string | undefined,
): Promise<void> {
  try {
    if (!statement) throw new SettlementError("source-not-authoritative");
    const objects = bundle(suite, [
      {
        name: "SettlementKey",
        form: "identity-signed JWS",
        raw: statement,
        shown: jwtShown(statement),
      },
    ]);
    await profile.admit(party.party, "protocol-key", objects);
    const c = keyClaim.parse(
      await verifyIdentity(statement, party.identity, "awp-settlement-key+jws"),
    );
    if (
      c.party !== party.party ||
      c.suite !== suite ||
      c.algorithm !== algorithm ||
      canonicalJson(c.publicKey) !== canonicalJson(publicKey) ||
      Date.parse(c.validFrom) > Date.parse(profile.now()) ||
      Date.parse(c.validUntil) <= Date.parse(profile.now())
    )
      throw new SettlementError("source-not-authoritative");
  } catch (error) {
    return protocolFailure(error);
  }
}
const paymentDataSchema = z.strictObject({
  id: z.string(),
  agreement: z.string(),
  payer: z.string(),
  payee: z.string(),
  account: z.string(),
  amount: z.string(),
  currency: z.string(),
  invoice: z.string(),
  onceKey: z.string(),
  validUntil: z.string(),
  instalment: z.number().int().positive(),
});
const receiptClaim = z.strictObject({
  claimType: z.literal("payment-receipt"),
  provider: z.string(),
  reference: z.string().min(1),
  protocolDigest: z.string(),
  orderDigest: z.string(),
  payment: paymentDataSchema,
});
export async function signProviderReceipt(
  profile: AdapterProfile,
  order: PaymentFacts,
  reference: string,
  protocolObjects: ProtocolObjects,
): Promise<ProtocolObjects["objects"][number]> {
  const raw = await signCompact(
    profile.provider.signingKey,
    "awp-payment-receipt+jws",
    receiptClaim.parse({
      claimType: "payment-receipt",
      provider: profile.provider.party,
      reference,
      protocolDigest: digestOf(protocolObjects.objects),
      orderDigest: paymentDigest(order),
      payment: order.data(),
    }),
  );
  return {
    name: "payment-receipt",
    form: "provider identity-signed JWS (local profile)",
    raw,
    shown: jwtShown(raw),
  };
}
export async function liftProviderReceipt(
  profile: AdapterProfile,
  objects: ProtocolObjects,
  order: PaymentFacts,
  protocolObjects: ProtocolObjects,
  reference: string,
): Promise<PaymentFacts> {
  try {
    await profile.admit(profile.provider.party, "payment-receipt", objects);
    const c = receiptClaim.parse(
      await verifyIdentity(
        rawToken(objects, "payment-receipt"),
        profile.provider.identity,
        "awp-payment-receipt+jws",
      ),
    );
    if (
      c.provider !== profile.provider.party ||
      c.reference !== reference ||
      c.protocolDigest !== digestOf(protocolObjects.objects) ||
      c.orderDigest !== paymentDigest(order)
    )
      return invalid();
    // Semantic receipt differences are left for the unchanged receipt check.
    return PaymentFacts.receipt(PaymentFacts.create(c.payment), c.provider, c.reference);
  } catch (error) {
    return protocolFailure(error);
  }
}
export const HTTP_STAND_IN =
  "HTTP requests and responses are passed in process with the same method, path, headers and body. No money moves: the payment provider is a fictional party that keeps a ledger.";
