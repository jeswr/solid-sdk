// AUTHORED-BY Codex GPT-6
import { canonicalJson } from "../../core/canonical.js";
import {
  authorizationOnceKey,
  domainSchema,
  type Eip712Domain,
  recoverAuthorization,
} from "../eip3009.js";
import { type HttpExchange, header } from "../http.js";
import { type Ledger, LedgerError } from "../ledger.js";
import {
  buildChallenge,
  type Challenge,
  type Credential,
  challengeNonce,
  chargeRequest,
  checkChallengeBinding,
  convertMppAmount,
  credentialSchema,
  encodeReceipt,
  MppError,
  type PaymentReceipt,
  parseCredential,
} from "./objects.js";

export class MppServer {
  private readonly consumed = new Set<string>();
  private readonly secret: Uint8Array;
  private readonly domain: Eip712Domain;
  constructor(
    private readonly ledger: Ledger,
    secret: Uint8Array,
    domain: Eip712Domain,
    private readonly currency: string,
    private readonly decimals: number,
  ) {
    if (secret.length < 32) throw new Error("challenge secret needs 32 bytes");
    this.secret = Uint8Array.from(secret);
    this.domain = domainSchema.parse(domain);
    convertMppAmount({ units: "0", currency }, decimals);
  }

  /** expected is the challenge the merchant issued, never a value asserted by the client. */
  verify(input: unknown, expected: Challenge, now: number): Credential {
    const result = credentialSchema.safeParse(input);
    if (!result.success) throw new MppError("malformed-credential");
    const credential = result.data;
    const challenge = credential.challenge;
    if (challenge.method !== "evm" || challenge.intent !== "charge")
      throw new MppError("method-unsupported");
    const binding = checkChallengeBinding(challenge, this.secret);
    if (
      !binding ||
      canonicalJson(challenge) !== canonicalJson(expected) ||
      this.consumed.has(challenge.id)
    )
      throw new MppError("invalid-challenge");
    if (!Number.isSafeInteger(now) || now < 0) throw new MppError("bad-request");
    if (!challenge.expires || Date.parse(challenge.expires) <= now * 1000)
      throw new MppError("payment-expired");
    let request: ReturnType<typeof chargeRequest>;
    try {
      request = chargeRequest(challenge);
    } catch {
      throw new MppError("invalid-challenge");
    }
    const { type: _type, signature, ...auth } = credential.payload;
    if (
      !request.recipient ||
      request.currency !== this.currency ||
      request.amount !== auth.value ||
      request.recipient.toLowerCase() !== auth.to.toLowerCase() ||
      challengeNonce(challenge) !== auth.nonce.toLowerCase()
    )
      throw new MppError("invalid-payload");
    if (
      BigInt(now) <= BigInt(auth.validAfter) ||
      BigInt(now) >= BigInt(auth.validBefore) ||
      BigInt(auth.validBefore) * 1000n > BigInt(Date.parse(challenge.expires))
    )
      throw new MppError("payment-expired");
    let signer: string;
    try {
      signer = recoverAuthorization(this.domain, auth, signature);
    } catch {
      throw new MppError("verification-failed");
    }
    if (
      signer !== auth.from.toLowerCase() ||
      credential.source.toLowerCase() !== `did:pkh:eip155:${this.domain.chainId}:${signer}`
    )
      throw new MppError("verification-failed");
    if (this.ledger.hasUsed(authorizationOnceKey(this.domain, auth)))
      throw new MppError("invalid-challenge");
    try {
      const balance = convertMppAmount(
        { amount: this.ledger.balance(signer, this.currency), currency: this.currency },
        this.decimals,
      );
      this.ledger.balance(auth.to.toLowerCase(), this.currency);
      if (BigInt(balance.units) < BigInt(auth.value)) throw new MppError("payment-insufficient");
    } catch (error) {
      if (error instanceof MppError) throw error;
      throw new MppError("verification-failed");
    }
    return credential;
  }

  settle(input: unknown, expected: Challenge, now: number): PaymentReceipt {
    const credential = this.verify(input, expected, now);
    const { type: _type, signature: _signature, ...auth } = credential.payload;
    const amount = convertMppAmount({ units: auth.value, currency: this.currency }, this.decimals);
    try {
      const entry = this.ledger.transfer(
        auth.from.toLowerCase(),
        auth.to.toLowerCase(),
        amount.amount,
        amount.currency,
        authorizationOnceKey(this.domain, auth),
      );
      this.consumed.add(credential.challenge.id);
      return {
        status: "success",
        method: "evm",
        timestamp: new Date(now * 1000).toISOString(),
        reference: entry.digest,
        challengeId: credential.challenge.id,
        chainId: this.domain.chainId,
      };
    } catch (error) {
      throw new MppError(
        error instanceof LedgerError && error.code === "insufficient_funds"
          ? "payment-insufficient"
          : "verification-failed",
      );
    }
  }

  /** A failed credential gets a caller-supplied fresh challenge, never the consumed one. */
  handle(
    exchange: HttpExchange,
    expected: Challenge,
    now: number,
    freshChallenge: () => Challenge,
  ): HttpExchange {
    try {
      const name = expected.header ?? "Authorization";
      const raw = header(exchange.headers, name);
      if (!raw) throw new MppError("payment-required");
      const receipt = this.settle(parseCredential(raw), expected, now);
      return {
        ...exchange,
        status: 200,
        headers: { "Payment-Receipt": encodeReceipt(receipt) },
        body: null,
      };
    } catch (error) {
      const problem = error instanceof MppError ? error : new MppError("malformed-credential");
      const challenge = freshChallenge();
      if (
        challenge.id === expected.id ||
        this.consumed.has(challenge.id) ||
        !checkChallengeBinding(challenge, this.secret)
      )
        throw new Error("fresh challenge required");
      // The core draft gives unsupported-method/bad-request their own 400 status.
      return {
        ...exchange,
        status: problem.status,
        headers: { "WWW-Authenticate": buildChallenge(challenge), "Cache-Control": "no-store" },
        body: { type: problem.type, status: problem.status },
      };
    }
  }
}
