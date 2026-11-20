// AUTHORED-BY Codex GPT-6
import { canonicalJson } from "../../core/canonical.js";
import {
  type AdapterProfile,
  invalid,
  invoiceFacts,
  protocolFailure,
  rawExchange,
  requireValue,
} from "../adapter.js";
import { type Eip712Domain, recoverAuthorization } from "../eip3009.js";
import { type HttpExchange, header } from "../http.js";
import type { AmountDue, PayeeContext, ProtocolObjects } from "../types.js";
import { accountIri } from "../x402/lift.js";
import {
  type Challenge,
  challengeNonce,
  chargeRequest,
  checkChallengeBinding,
  convertMppAmount,
  parseChallenge,
  parseCredential,
  parseReceipt,
} from "./objects.js";

export function liftRequest(
  exchange: HttpExchange,
  due: AmountDue,
  payee: PayeeContext,
  profile: AdapterProfile,
  secret: Uint8Array,
) {
  try {
    if (
      exchange.method !== "GET" ||
      exchange.path !== "/valuation-booking" ||
      exchange.status !== 402 ||
      header(exchange.headers, "Cache-Control") !== "no-store" ||
      payee.party !== profile.merchant.party
    )
      return invalid();
    const challenge = parseChallenge(requireValue(header(exchange.headers, "WWW-Authenticate")));
    const charge = chargeRequest(challenge);
    if (
      !checkChallengeBinding(challenge, secret) ||
      challenge.method !== "evm" ||
      challenge.intent !== "charge" ||
      challenge.realm !== "valuer.example" ||
      !challenge.expires ||
      Date.parse(challenge.expires) <= Date.parse(profile.now()) ||
      charge.externalId !== due.agreement.digest ||
      charge.currency !== profile.currency
    )
      return invalid();
    const amount = convertMppAmount(
      { units: charge.amount, currency: charge.currency },
      profile.decimals,
    );
    const recipient = requireValue(charge.recipient);
    return {
      challenge,
      charge,
      facts: invoiceFacts(
        due,
        payee.party,
        accountIri(recipient, "eip155:84532"),
        amount.amount,
        amount.currency,
      ),
    };
  } catch (error) {
    return protocolFailure(error);
  }
}
export function liftOrder(
  objects: ProtocolObjects,
  profile: AdapterProfile,
  domain: Eip712Domain,
  expected: Challenge,
) {
  try {
    const exchange = rawExchange(objects, "Credential");
    if (
      exchange.method !== "GET" ||
      exchange.path !== "/valuation-booking" ||
      exchange.status !== undefined
    )
      return invalid();
    const credential = parseCredential(
      requireValue(header(exchange.headers, expected.header ?? "Authorization")),
    );
    const { signature, type: _type, ...auth } = credential.payload;
    if (
      canonicalJson(credential.challenge) !== canonicalJson(expected) ||
      auth.nonce !== challengeNonce(expected) ||
      auth.from.toLowerCase() !== profile.payer.account.toLowerCase() ||
      credential.source !==
        `did:pkh:eip155:${domain.chainId}:${profile.payer.account.toLowerCase()}` ||
      recoverAuthorization(domain, auth, signature) !== profile.payer.account.toLowerCase()
    )
      return invalid();
    return { exchange, credential };
  } catch (error) {
    return protocolFailure(error);
  }
}
export function liftReceipt(exchange: HttpExchange, challenge: Challenge, domain: Eip712Domain) {
  try {
    if (exchange.method !== "GET" || exchange.path !== "/valuation-booking") return invalid();
    if (exchange.status !== 200) {
      const body = exchange.body as { type?: string } | null;
      return invalid(body?.type ?? "invalid-payload", exchange);
    }
    const receipt = parseReceipt(
      requireValue(header(exchange.headers, "Payment-Receipt")),
      exchange.status,
    );
    if (receipt.challengeId !== challenge.id || receipt.chainId !== domain.chainId)
      return invalid();
    return receipt;
  } catch (error) {
    return protocolFailure(error);
  }
}
