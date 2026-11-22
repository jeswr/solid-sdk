// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { Ledger } from "../../src/settlement/ledger.js";
import { createChallenge, createCredential } from "../../src/settlement/mpp/objects.js";
import { MppServer } from "../../src/settlement/mpp/server.js";
import { X402Facilitator } from "../../src/settlement/x402/facilitator.js";
import { domain, now, payee, payer, secretKey } from "./fixtures.js";

it.each([
  "x402",
  "mpp",
])("refuses reuse of the same EIP-3009 authorization after %s settlement", (first) => {
  const ledger = new Ledger();
  ledger.createAccount(payer, { USD: "10.00" });
  ledger.createAccount(payee);
  const secret = new Uint8Array(32).fill(7);
  const challenge = createChallenge(
    { amount: "1250000", currency: "USD", recipient: payee },
    {
      realm: "valuer.example",
      method: "evm",
      intent: "charge",
      expires: new Date((now + 300) * 1000).toISOString(),
    },
    secret,
  );
  const credential = createCredential(challenge, domain, payer, "0", String(now + 300), secretKey);
  const requirements = {
    scheme: "exact" as const,
    network: "eip155:84532",
    amount: "1250000",
    asset: domain.verifyingContract,
    payTo: payee,
    maxTimeoutSeconds: 300,
    extra: { name: domain.name, version: domain.version },
  };
  const { type: _type, signature, ...authorization } = credential.payload;
  const payload = { x402Version: 2, accepted: requirements, payload: { signature, authorization } };
  const x402 = new X402Facilitator(ledger, requirements, "USD", 6);
  const mpp = new MppServer(ledger, secret, domain, "USD", 6);
  if (first === "x402") {
    expect(x402.settle(payload, now).success).toBe(true);
    expect(() => mpp.settle(credential, challenge, now)).toThrow("invalid-challenge");
  } else {
    expect(mpp.settle(credential, challenge, now).status).toBe("success");
    expect(x402.settle(payload, now)).toMatchObject({
      success: false,
      errorReason: "invalid_payload",
    });
  }
  expect(ledger.entries).toHaveLength(1);
  expect(ledger.balance(payer, "USD")).toBe("8.750000");
});
