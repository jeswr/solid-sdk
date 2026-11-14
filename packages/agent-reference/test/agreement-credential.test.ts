// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { MandateStatusLists } from "../src/mechanisms/mandate-status.js";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { copyData } from "../src/model/copy.js";
import { MessageNode } from "../src/model/message-nodes.js";
import { alternativeWireId } from "../src/profile/configurations.js";
import { AWP, PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { testKey } from "../src/reference/keys.js";
import { AgreementCredentialProtocol } from "../src/wire/agreement-credential.js";
import { decodeCompactPayload } from "../src/wire/inspect.js";

async function fixture() {
  let at = "2026-11-13T09:00:00.000Z";
  const [valuer, sam, owner, stranger] = await Promise.all(
    ["valuer", "sam", "valuer-owner", "stranger"].map((id) => testKey("credential/" + id)),
  );
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:valuer",
    sourceAuthority: [],
    keys: [
      { ...valuer!, role: "actor", subject: "urn:valuer-agent", party: "urn:valuer" },
      { ...sam!, role: "actor", subject: "urn:sam-agent", party: "urn:sam" },
      { ...stranger!, role: "actor", subject: "urn:stranger-agent", party: "urn:stranger" },
    ].map(({ privateKey: _privateKey, ...key }) => key),
  });
  const status = new MandateStatusLists("urn:valuer", owner!, () => at);
  await status.setup();
  const producer = new AgreementCredentialProtocol(status),
    consumer = new AgreementCredentialProtocol(status);
  const terms = {
    service: "Home valuation",
    compensation: { amount: "450.00", currency: "USD", payee: "urn:valuer" },
    validFrom: at,
    validUntil: "2026-11-20T09:00:00.000Z",
    purpose: "urn:valuation",
  };
  const base = {
    profile: PILOT_PROFILE,
    configuration: alternativeWireId("commitments-agreement-credential"),
    conversation: "urn:valuation-conversation",
    createdAt: at,
    expiresAt: "2026-11-13T10:00:00.000Z",
  };
  const offer = MessageNode.toNode({
    ...base,
    id: "urn:valuation-offer",
    kind: "propose",
    from: { actor: "urn:valuer-agent", onBehalfOf: "urn:valuer" },
    to: { actor: "urn:sam-agent", party: "urn:sam" },
    body: {
      operation: { id: "urn:op:paid-service", version: "0.1" },
      terms,
      termsDigest: digestOf(terms),
      round: 1,
    },
  });
  offer.evidence = [(await producer.offer(offer, valuer!))!];
  const signed = (await consumer.accept(offer, sam!, trust, at))!;
  const accept = MessageNode.toNode({
    ...base,
    id: "urn:valuation-accept",
    kind: "accept",
    from: { actor: "urn:sam-agent", onBehalfOf: "urn:sam" },
    to: { actor: "urn:valuer-agent", party: "urn:valuer" },
    body: {
      proposal: offer.id,
      termsDigest: digestOf(terms),
      agreement: "urn:valuation-agreement",
    },
    evidence: [signed.evidence],
  });
  const check = (message = accept) => producer.check(message, offer, trust, at);
  async function rewrite(change: (credential: any) => void, carrierKey = sam!) {
    const raw = copyData(accept.live);
    const payload = decodeCompactPayload(raw.evidence![0]!.value);
    change(payload.credential);
    return MessageNode.toNode({
      ...raw,
      evidence: [
        {
          role: "authorisation",
          format: "agreement-credential+jws",
          value: await signStatement(carrierKey, "awp-agreement-credential+jws", payload),
        },
      ],
    });
  }
  return {
    offer,
    accept,
    check,
    rewrite,
    producer,
    consumer,
    status,
    trust,
    sam: sam!,
    stranger: stranger!,
    digest: digestOf(terms),
    advance: (value: string) => {
      at = value;
    },
  };
}

it("verifies both independent proofs, including a reordered proof set", async () => {
  const f = await fixture();
  const missingPrincipal = MessageNode.toNode({
    ...copyData(f.offer.live),
    to: { actor: "urn:sam-agent" },
  });
  await expect(f.producer.offer(missingPrincipal, f.sam)).rejects.toThrow(
    "identify both principals",
  );
  expect(
    await f.producer.check(f.offer, undefined, f.trust, "2026-11-13T09:00:00.000Z"),
  ).toMatchObject({ state: "offer" });
  expect(await f.check()).toMatchObject({ state: "agreement" });
  expect(f.producer.current(f.digest)).toBe(true);
  expect(await f.check(await f.rewrite((vc) => vc.proof.reverse()))).toMatchObject({
    state: "agreement",
  });
  expect(
    await f.producer.check(f.accept, undefined, f.trust, "2026-11-13T09:00:00.000Z"),
  ).toMatchObject({ reason: "no-agreement" });
});

it("keeps an authentic single proof as an offer and never records a complete agreement", async () => {
  const f = await fixture();
  const stripped = await f.rewrite((vc) => {
    vc.proof = vc.proof[0];
  });
  expect(await f.check(stripped)).toMatchObject({ state: "offer", reason: "no-agreement" });
  expect(f.producer.current(f.digest)).toBe(false);
  const missing = new AgreementCredentialProtocol(f.status, true);
  expect(
    (await missing.accept(f.offer, f.sam, f.trust, "2026-11-13T09:00:00.000Z"))?.complete,
  ).toBe(false);
  expect(missing.current(f.digest)).toBe(false);
});

it("rejects altered terms, parties, issuer, status, proof purpose, copied proofs and signature changes", async () => {
  const f = await fixture();
  for (const change of [
    (vc: any) => {
      vc.credentialSubject[AWP + "terms"].compensation.amount = "495.00";
    },
    (vc: any) => {
      vc.credentialSubject["http://www.w3.org/ns/odrl/2/assignee"] = "urn:stranger";
    },
    (vc: any) => {
      vc.issuer = "urn:stranger";
    },
    (vc: any) => {
      vc.credentialStatus = [];
    },
    (vc: any) => {
      vc.credentialStatus[0].statusListCredential = "https://foreign.example/status";
    },
    (vc: any) => {
      vc.proof[1].proofPurpose = "authentication";
    },
    (vc: any) => {
      vc.proof[1] = vc.proof[0];
    },
    (vc: any) => {
      vc.proof[1].proofValue += "x";
    },
    (vc: any) => {
      vc.proof = [vc.proof[1]];
    },
    (vc: any) => {
      vc.proof[1].created = "2026-11-14T09:00:00.000Z";
    },
  ])
    expect(await f.check(await f.rewrite(change))).toMatchObject({
      state: "invalid",
      reason: "evidence-invalid",
    });
  expect(await f.check(await f.rewrite(() => {}, f.stranger))).toMatchObject({
    state: "invalid",
    reason: "evidence-invalid",
  });
  const wrongRecipient = {
    ...copyData(f.accept.live),
    to: { actor: "urn:stranger-agent", party: "urn:stranger" },
  };
  expect(await f.check(MessageNode.toNode(wrongRecipient))).toMatchObject({
    reason: "evidence-invalid",
  });
});

it("requires the second proof's cryptographic signature inside an authentic carrier", async () => {
  const f = await fixture();
  const forged = await f.rewrite((vc) => {
    vc.proof[1].proofValue = vc.proof[0].proofValue;
  });
  expect(await f.check(forged)).toMatchObject({ state: "invalid", reason: "evidence-invalid" });
});

it("checks signed current status and expiry rather than trusting a prior complete proof set", async () => {
  const f = await fixture();
  expect(await f.check()).toMatchObject({ state: "agreement" });
  await f.status.set("suspension", true);
  expect(f.producer.current(f.digest)).toBe(false);
  expect(await f.check()).toMatchObject({ reason: "status-withdrawn" });
  await expect(
    f.consumer.accept(f.offer, f.sam, f.trust, "2026-11-13T09:00:00.000Z"),
  ).rejects.toMatchObject({ reason: "status-withdrawn" });
  await f.status.set("suspension", false);
  expect(await f.check()).toMatchObject({ state: "agreement" });
  f.status.available = false;
  await f.status.refresh();
  expect(f.producer.current(f.digest)).toBe(false);
  expect(await f.check()).toMatchObject({ reason: "lookup-failed" });
  f.status.available = true;
  f.advance("2026-11-20T09:00:00.000Z");
  expect(f.producer.current(f.digest)).toBe(false);
  expect(await f.check()).toMatchObject({ reason: "expired" });
});
