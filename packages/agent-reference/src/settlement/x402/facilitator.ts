// AUTHORED-BY Codex GPT-6
import { canonicalJson } from "../../core/canonical.js";
import { authorizationOnceKey, type Eip712Domain, recoverAuthorization } from "../eip3009.js";
import { type Ledger, LedgerError } from "../ledger.js";
import {
  convertX402Amount,
  type PaymentPayload,
  type PaymentRequirements,
  paymentPayloadSchema,
  paymentRequirementsSchema,
  type SettlementResponse,
  type VerificationResponse,
  type X402Error,
} from "./objects.js";

export function requirementsDomain(requirements: PaymentRequirements): Eip712Domain {
  const req = paymentRequirementsSchema.parse(requirements);
  return {
    ...req.extra,
    chainId: req.network.slice("eip155:".length),
    verifyingContract: req.asset,
  };
}

/** No chain: real EIP-712 verification followed by a fictional provider-owned ledger. */
export class X402Facilitator {
  readonly requirements: Readonly<PaymentRequirements>;
  private readonly domain: Eip712Domain;
  constructor(
    private readonly ledger: Ledger,
    requirements: PaymentRequirements,
    private readonly currency: string,
    private readonly decimals: number,
  ) {
    const req = paymentRequirementsSchema.parse(requirements);
    this.requirements = Object.freeze({ ...req, extra: Object.freeze(req.extra) });
    this.domain = requirementsDomain(req);
    convertX402Amount({ units: req.amount, currency }, decimals);
  }

  verify(input: unknown, now: number): VerificationResponse {
    const failure = (invalidReason: X402Error): VerificationResponse => ({
      isValid: false,
      invalidReason,
    });
    if (typeof input === "object" && input !== null && "accepted" in input) {
      const accepted = input.accepted;
      if (
        typeof accepted === "object" &&
        accepted !== null &&
        "scheme" in accepted &&
        accepted.scheme !== "exact"
      )
        return failure("invalid_scheme");
    }
    const parsed = paymentPayloadSchema.safeParse(input);
    if (!parsed.success || !Number.isSafeInteger(now) || now < 0) return failure("invalid_payload");
    const payload = parsed.data;
    const auth = payload.payload.authorization;
    if (
      auth.to.toLowerCase() !== payload.accepted.payTo.toLowerCase() ||
      auth.to.toLowerCase() !== this.requirements.payTo.toLowerCase()
    )
      return failure("invalid_exact_evm_payload_recipient_mismatch");
    if (auth.value !== payload.accepted.amount || auth.value !== this.requirements.amount)
      return failure("invalid_exact_evm_payload_authorization_value_mismatch");
    if (canonicalJson(payload.accepted) !== canonicalJson(this.requirements))
      return failure("invalid_payload");
    if (
      BigInt(now) <= BigInt(auth.validAfter) ||
      BigInt(now) >= BigInt(auth.validBefore) ||
      BigInt(auth.validBefore) - BigInt(now) > BigInt(this.requirements.maxTimeoutSeconds)
    )
      return failure("invalid_payload");
    try {
      const payer = recoverAuthorization(this.domain, auth, payload.payload.signature);
      if (payer !== auth.from.toLowerCase()) return failure("invalid_payload");
      if (this.ledger.hasUsed(authorizationOnceKey(this.domain, auth)))
        return failure("invalid_payload");
      const amount = convertX402Amount(
        { units: auth.value, currency: this.currency },
        this.decimals,
      );
      const balance = convertX402Amount(
        { amount: this.ledger.balance(payer, this.currency), currency: this.currency },
        this.decimals,
      );
      if (BigInt(balance.units) < BigInt(auth.value)) return failure("insufficient_funds");
      // Verify recipient registration as well, without moving money or consuming replay state.
      this.ledger.balance(auth.to.toLowerCase(), amount.currency);
      return { isValid: true, payer };
    } catch {
      return failure("invalid_payload");
    }
  }

  settle(input: unknown, now: number): SettlementResponse {
    const verified = this.verify(input, now);
    if (!verified.isValid)
      return {
        success: false,
        transaction: "",
        network: this.requirements.network,
        errorReason: verified.invalidReason,
      };
    const payload: PaymentPayload = paymentPayloadSchema.parse(input);
    const auth = payload.payload.authorization;
    try {
      const amount = convertX402Amount(
        { units: auth.value, currency: this.currency },
        this.decimals,
      );
      const entry = this.ledger.transfer(
        verified.payer,
        auth.to.toLowerCase(),
        amount.amount,
        amount.currency,
        authorizationOnceKey(this.domain, auth),
      );
      return {
        success: true,
        payer: verified.payer,
        network: this.requirements.network,
        transaction: entry.digest,
      };
    } catch (error) {
      return {
        success: false,
        payer: verified.payer,
        transaction: "",
        network: this.requirements.network,
        errorReason:
          error instanceof LedgerError && error.code === "insufficient_funds"
            ? "insufficient_funds"
            : "invalid_payload",
      };
    }
  }
}
