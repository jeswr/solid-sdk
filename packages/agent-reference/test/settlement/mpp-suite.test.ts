// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { checkPayment, checkReceipt } from "../../src/gates/payment.js";
import { rawExchange } from "../../src/settlement/adapter.js";
import { MppSuite } from "../../src/settlement/mpp/index.js";
import {
  buildChallenge,
  buildCredential,
  challengeExchange,
  chargeRequest,
  createChallenge,
  parseChallenge,
  parseCredential,
} from "../../src/settlement/mpp/objects.js";
import {
  agreement,
  checkedOrder,
  mppFixture,
  paymentFromInvoice,
  paymentRecord,
} from "./adapter-fixtures.js";

it("MPP Suite lifts the HMAC-bound charge, sends EIP-3009 credential and authenticates the provider receipt", async () => {
  const f = await mppFixture();
  const { request, order, facts } = await checkedOrder(f);
  const challenge = parseChallenge(
    rawExchange(request, "Challenge").headers["WWW-Authenticate"] ?? "",
  );
  expect(chargeRequest(challenge).externalId).toBe(f.due.agreement.digest);
  const settled = await f.suite.settle(order, f.provider);
  expect(checkReceipt(f.suite.lift(settled), facts, f.profile.provider.party).ok).toBe(true);
  expect(f.profile.ledger.entries).toHaveLength(1);
  expect((await f.suite.trace(settled)).objects[0]?.raw).toMatchObject({
    status: 200,
    headers: { "Payment-Receipt": expect.any(String) },
  });
});
it("mpp-challenge-reused returns a fresh 402 invalid-challenge and never charges twice", async () => {
  const f = await mppFixture();
  const { request, order } = await checkedOrder(f);
  const old = parseChallenge(rawExchange(request, "Challenge").headers["WWW-Authenticate"] ?? "");
  await f.suite.settle(order, f.provider);
  let failure: unknown;
  try {
    await f.suite.settle(order, f.provider);
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    reason: "evidence-invalid",
    protocolCode: "https://paymentauth.org/problems/invalid-challenge",
    exchange: { status: 402, body: { type: "https://paymentauth.org/problems/invalid-challenge" } },
  });
  const response = (failure as { exchange: { headers: Record<string, string> } }).exchange;
  const fresh = parseChallenge(response.headers["WWW-Authenticate"] ?? "");
  expect(fresh.id).not.toBe(old.id);
  expect(f.profile.ledger.entries).toHaveLength(1);
});
it.each([
  ["fee-amount-differs", "P2", "amount-differs"],
  ["fee-no-offer", "P1", "no-agreement"],
])("MPP isolated %s remains an ordinary gate refusal", async (path, check, reason) => {
  const f = await mppFixture();
  if (path === "fee-amount-differs") f.due.agreement = agreement("495.00");
  const request = await f.suite.request(f.due, { party: f.profile.merchant.party });
  const record = paymentRecord(f.profile);
  if (path === "fee-no-offer") record.agreement = undefined;
  const result = checkPayment(paymentFromInvoice(f.suite.lift(request), f.profile), record);
  expect(result.reason).toBe(reason);
  expect(result.verdicts.at(-1)?.check).toBe(check);
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it("MPP refuses HMAC/terms tampering before there are facts", async () => {
  const f = await mppFixture();
  const request = await f.suite.request(f.due, { party: f.profile.merchant.party });
  const raw = rawExchange(request, "Challenge");
  const original = parseChallenge(raw.headers["WWW-Authenticate"] ?? "");
  const altered = { ...original, realm: "attacker.example" };
  raw.headers["WWW-Authenticate"] = buildChallenge(altered);
  await expect(
    f.suite.admitRequest(raw, f.due, { party: f.profile.merchant.party }),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
  const { id: _id, request: _request, ...options } = original;
  const unrelated = createChallenge(
    { ...chargeRequest(original), externalId: "sha-256:other" },
    options,
    f.options.challengeSecret,
  );
  await expect(
    f.suite.admitRequest(challengeExchange("GET", "/valuation-booking", unrelated), f.due, {
      party: f.profile.merchant.party,
    }),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
});
it("MPP refuses a changed signed credential and a missing identity-signed key", async () => {
  const f = await mppFixture();
  const { order } = await checkedOrder(f);
  const raw = rawExchange(order, "Credential");
  const credential = parseCredential(raw.headers.Authorization ?? "");
  credential.payload.value = "49500";
  raw.headers.Authorization = buildCredential(credential);
  const changed = structuredClone(order);
  const object = changed.objects.find((o) => o.name === "Credential");
  if (!object) throw new Error("missing credential");
  object.raw = raw;
  await expect(f.suite.settle(changed, f.provider)).rejects.toThrow();
  expect(f.profile.ledger.entries).toHaveLength(0);
  const suite = new MppSuite({ ...f.options, keyStatement: undefined });
  await expect(checkedOrder({ ...f, suite })).rejects.toMatchObject({
    reason: "source-not-authoritative",
  });
});
