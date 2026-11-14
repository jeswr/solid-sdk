// AUTHORED-BY Codex GPT-6

import { checkPayment, type PaymentRecord } from "../../src/gates/payment.js";
import { generateSigningKey, signCompact } from "../../src/mechanisms/jws.js";
import {
  PaymentAccountNode,
  PaymentAgreementNode,
  PaymentFacts,
  paymentOnceKey,
} from "../../src/model/payment.js";
import { AcpSuite } from "../../src/settlement/acp/index.js";
import {
  type AdapterProfile,
  publishProtocolKey,
  verifyIdentity,
} from "../../src/settlement/adapter.js";
import { Ap2Suite } from "../../src/settlement/ap2/index.js";
import { Ledger } from "../../src/settlement/ledger.js";
import { MppSuite } from "../../src/settlement/mpp/index.js";
import type { AmountDue, ProtocolObjects, SettlementSuite } from "../../src/settlement/types.js";
import { X402Suite } from "../../src/settlement/x402/index.js";
import { accountIri } from "../../src/settlement/x402/lift.js";
import { domain, payee, payer, secretKey } from "./fixtures.js";

export const at = "2026-11-13T09:00:00.000Z";
export function agreement(amount = "450.00", currency = "USD") {
  return PaymentAgreementNode.create({
    digest: "sha-256:mortgage-valuation-terms",
    service: "Home valuation",
    payer: "urn:fictional:sam",
    payee: "urn:fictional:bracken-lantern-valuations",
    amount,
    currency,
    validFrom: at,
    validUntil: "2026-11-20T09:00:00.000Z",
    offerProof: "isolated-gate-fixture-offer",
    acceptanceProof: "isolated-gate-fixture-acceptance",
  });
}
export async function hostFixture(currency = "USD", decimals = 2) {
  const [person, merchant, provider] = await Promise.all([
    generateSigningKey(),
    generateSigningKey(),
    generateSigningKey(),
  ]);
  const keys = new Map([
    ["urn:fictional:sam", person.key],
    ["urn:fictional:bracken-lantern-valuations", merchant.key],
    ["urn:fictional:mossbridge-payment-desk", provider.key],
  ]);
  const ledger = new Ledger();
  ledger.createAccount(payer, { [currency]: decimals === 0 ? "2000" : "2000.00" });
  ledger.createAccount(payee, { [currency]: "0" });
  const admission: { source: string; step: string; objects: ProtocolObjects }[] = [];
  const profile: AdapterProfile = {
    payer: { party: "urn:fictional:sam", account: payer, identity: person.key },
    merchant: {
      party: "urn:fictional:bracken-lantern-valuations",
      account: payee,
      identity: merchant.key,
    },
    provider: {
      party: "urn:fictional:mossbridge-payment-desk",
      identity: provider.key,
      signingKey: provider.key,
    },
    ledger,
    currency: currency.toUpperCase(),
    decimals,
    now: () => at,
    // This is an isolated protocol-host test seam, not the real AgentRuntime inbound pipeline.
    admit: async (source, step, objects) => {
      const key = keys.get(source);
      if (!key) throw new Error("source-not-authoritative");
      const statement = await signCompact(key, "test-protocol-carriage+jws", { step, objects });
      await verifyIdentity(statement, key, "test-protocol-carriage+jws");
      admission.push({ source, step, objects: structuredClone(objects) });
    },
  };
  const keyStatement = await publishProtocolKey(person.key, {
    type: "SettlementKey",
    party: profile.payer.party,
    suite: "x402",
    algorithm: "secp256k1",
    publicKey: payer,
    validFrom: at,
    validUntil: "2026-11-20T09:00:00.000Z",
  });
  const due: AmountDue = {
    agreement: agreement(decimals === 0 ? "450" : "450.00", currency.toUpperCase()),
    invoice: "urn:invoice:valuation",
    dueDate: at,
    account: accountIri(payee, "eip155:84532"),
  };
  return {
    profile,
    due,
    keys,
    keyStatement,
    admission,
    provider: { party: profile.provider.party, payerAccount: payer, ledger, now: at },
  };
}
export async function x402Fixture(currency = "USD", decimals = 2) {
  const host = await hostFixture(currency, decimals);
  const options = {
    ...host.profile,
    keyStatement: host.keyStatement,
    settlementKey: secretKey,
    requirements: {
      scheme: "exact" as const,
      network: "eip155:84532",
      amount: "45000",
      asset: domain.verifyingContract,
      payTo: payee,
      maxTimeoutSeconds: 300,
      extra: { name: domain.name, version: domain.version },
    },
  };
  return { ...host, options, suite: new X402Suite(options) };
}
export async function mppFixture(currency = "USD", decimals = 2) {
  const host = await hostFixture(currency, decimals);
  const identity = host.keys.get(host.profile.payer.party);
  if (!identity) throw new Error("missing payer");
  const keyStatement = await publishProtocolKey(identity, {
    type: "SettlementKey",
    party: host.profile.payer.party,
    suite: "mpp",
    algorithm: "secp256k1",
    publicKey: payer,
    validFrom: at,
    validUntil: "2026-11-20T09:00:00.000Z",
  });
  const options = {
    ...host.profile,
    keyStatement,
    settlementKey: secretKey,
    domain,
    challengeSecret: new Uint8Array(32).fill(7),
  };
  return { ...host, options, suite: new MppSuite(options) };
}
export async function ap2Fixture(currency = "USD", decimals = 2) {
  const host = await hostFixture(currency, decimals);
  host.profile.payer.account = "urn:account:sam";
  host.profile.merchant.account = "urn:account:valuer";
  host.profile.ledger.createAccount(host.profile.payer.account, {
    [currency]: decimals === 0 ? "2000" : "2000.00",
  });
  host.profile.ledger.createAccount(host.profile.merchant.account, { [currency]: "0" });
  host.provider.payerAccount = host.profile.payer.account;
  host.due.account = host.profile.merchant.account;
  const [person, merchant, processor, processorIdentity] = await Promise.all([
    generateSigningKey("ES256"),
    generateSigningKey("ES256"),
    generateSigningKey("ES256"),
    generateSigningKey(),
  ]);
  const processorParty = "urn:fictional:merchant-processor";
  host.keys.set(processorParty, processorIdentity.key);
  async function bound(party: string, key: typeof person.key) {
    const identity = host.keys.get(party);
    if (!identity) throw new Error("missing identity");
    return {
      key,
      statement: await publishProtocolKey(identity, {
        type: "SettlementKey",
        party,
        suite: "ap2",
        algorithm: "ES256",
        publicKey: key.publicJwk as Record<string, string>,
        validFrom: at,
        validUntil: "2026-11-20T09:00:00.000Z",
      }),
    };
  }
  const options = {
    ...host.profile,
    personKey: await bound(host.profile.payer.party, person.key),
    merchantKey: await bound(host.profile.merchant.party, merchant.key),
    processor: {
      party: processorParty,
      identity: processorIdentity.key,
      ...(await bound(processorParty, processor.key)),
    },
  };
  return { ...host, options, suite: new Ap2Suite(options) };
}
export async function acpFixture(currency = "USD", decimals = 2) {
  const host = await hostFixture(currency.toLowerCase(), decimals);
  host.profile.payer.account = "urn:account:sam";
  host.profile.merchant.account = "urn:account:valuer";
  host.profile.ledger.createAccount(host.profile.payer.account, {
    [currency.toLowerCase()]: decimals === 0 ? "2000" : "2000.00",
  });
  host.profile.ledger.createAccount(host.profile.merchant.account, {
    [currency.toLowerCase()]: "0",
  });
  host.provider.payerAccount = host.profile.payer.account;
  host.due.account = host.profile.merchant.account;
  const agentKey = host.keys.get(host.profile.payer.party);
  const merchantKey = host.keys.get(host.profile.merchant.party);
  if (!agentKey || !merchantKey) throw new Error("missing identity keys");
  const options = {
    ...host.profile,
    agentKey,
    merchantKey,
    bearerToken: "fictional-provider-account",
    handlerId: "fictional-provider",
  };
  return { ...host, options, suite: new AcpSuite(options) };
}
export function paymentFromInvoice(invoice: PaymentFacts, profile: AdapterProfile) {
  return PaymentFacts.create({
    id: "urn:order:valuation",
    agreement: invoice.agreement ?? "",
    payer: profile.payer.party,
    payee: invoice.payee ?? "",
    account: invoice.account ?? "",
    amount: invoice.amount ?? "",
    currency: invoice.currency ?? "",
    invoice: invoice.id,
    instalment: 1,
    onceKey: paymentOnceKey(invoice.agreement ?? "", 1),
    validUntil: "2026-11-13T09:05:00.000Z",
  });
}
export function paymentRecord(
  profile: AdapterProfile,
  original = agreement("450.00", profile.currency),
): PaymentRecord {
  return {
    now: at,
    agreement: original,
    payer: profile.payer.party,
    proofsVerified: true,
    inEffect: true,
    protocolScoped: true,
    binding: () => undefined,
    mandate: () => ({}),
    approval: () => "approved",
    ordered: () => false,
    accountBindings: [
      PaymentAccountNode.create(
        profile.merchant.party,
        profile.merchant.account.startsWith("0x")
          ? accountIri(profile.merchant.account, "eip155:84532")
          : profile.merchant.account,
      ),
    ],
  };
}
export async function checkedOrder(f: {
  suite: SettlementSuite;
  due: AmountDue;
  profile: AdapterProfile;
}) {
  const request = await f.suite.request(f.due, { party: f.profile.merchant.party });
  const facts = paymentFromInvoice(f.suite.lift(request), f.profile);
  const checked = checkPayment(facts, paymentRecord(f.profile));
  if (!checked.ok || !checked.digest) throw new Error(`fixture payment failed: ${checked.reason}`);
  return {
    request,
    facts,
    order: await f.suite.order({ facts, digest: checked.digest }, { party: f.profile.payer.party }),
  };
}
