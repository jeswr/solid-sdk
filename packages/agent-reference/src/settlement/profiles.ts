// AUTHORED-BY Codex GPT-6
import { HTTP_STAND_IN } from "./adapter.js";

/** Narrow local profiles over the confirmed research. These do not register live engine support. */
export const SETTLEMENT_PROFILES = {
  x402: {
    version: "2",
    scheme: "exact",
    network: "eip155:84532",
    closedInstruction:
      "EIP-3009 authorization: one recipient, value, validity window and once-key-derived nonce",
    extraKeys: "Payer secp256k1 key, admitted identity-signed SettlementKey",
    receiptSource:
      "Facilitator identity-signed payment-receipt; x402 SettlementResponse is unsigned",
    suppliedByHost: [
      "agreement and offer/acceptance proofs",
      "payee account ownership and accepted source",
      "currency and asset precision",
      "mandate and owner approval",
      "once-key association",
    ],
    standIns: [
      HTTP_STAND_IN,
      "There is no chain. The facilitator checks the real EIP-712 signature and settles on its own ledger. The network and asset identifiers name a test network and are not used.",
    ],
  },
  mpp: {
    version: "draft 01",
    intent: "charge",
    method: "evm",
    type: "authorization",
    closedInstruction:
      "EIP-3009 authorization bound to the HMAC-authenticated single-use challenge",
    extraKeys: "Payer secp256k1 key, admitted identity-signed SettlementKey",
    receiptSource: "Provider identity-signed payment-receipt; MPP Payment-Receipt is unsigned",
    suppliedByHost: [
      "offer/acceptance proofs",
      "account ownership and accepted source",
      "token domain and precision",
      "mandate and owner approval",
      "challenge-to-once-key association",
    ],
    standIns: [
      HTTP_STAND_IN,
      "There is no chain. Real EIP-712 signatures are checked and the fictional provider settles on its own ledger.",
    ],
  },
  ap2: {
    version: "0.2",
    mode: "person present",
    closedInstruction:
      "Closed Payment Mandate: one payee, amount, instrument and transaction_id equal to checkout_hash",
    extraKeys:
      "Person, merchant and processor ES256 keys, each admitted through an identity-signed SettlementKey",
    receiptSource:
      "ES256 Payment Receipt from the merchant's processor and ES256 Checkout Receipt from the merchant; local receipt claim profile",
    suppliedByHost: [
      "agreement and offer/acceptance proofs",
      "payee account ownership",
      "mandate and approval flow",
      "expiry of the checked order",
      "checkout-to-agreement and nonce-to-once-key associations",
    ],
    standIns: [
      HTTP_STAND_IN,
      "The credential provider and the merchant's payment processor are distinct fictional parties. Their provider account references replace real payment instruments. Receipt claims are a local profile because the research confirms no field table.",
    ],
  },
  acp: {
    version: "2026-04-17",
    closedInstruction:
      "One-time allowance bound to merchant, session, amount, currency and expiry; single-use delegated token",
    extraKeys: "None; Signature uses the parties' pinned Ed25519 identity keys",
    receiptSource:
      "Completed merchant checkout order plus provider identity-signed payment-receipt",
    suppliedByHost: [
      "agreement and offer/acceptance proofs",
      "merchant account-to-party binding",
      "mandate and owner approval",
      "session-to-agreement and idempotency-key-to-once-key associations",
    ],
    signatures:
      "ACP makes Signature and Timestamp optional; this local profile requires both on every agent request and merchant response",
    standIns: [
      HTTP_STAND_IN,
      "The card details ACP expects in payment_method are replaced by the provider's own account reference: {type: account, account_id}. The token is redeemable only on the fictional ledger.",
    ],
  },
} as const;
export type ProtocolSuiteId = keyof typeof SETTLEMENT_PROFILES;
