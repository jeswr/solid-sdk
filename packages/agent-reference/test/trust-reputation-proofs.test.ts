// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { issueAgentRating } from "../src/standins/reputation.js";
import { ReputationResolver } from "../src/suites/trust-reputation.js";
import { decodeCompactPayload } from "../src/wire/inspect.js";

it("requires the accepted service, signed score, exact actor key, lifetime and principal threshold", async () => {
  const key = await testKey("reputation/service"),
    at = "2026-11-13T09:00:00.000Z",
    source = "urn:rating-service",
    party = "urn:lender",
    actor = "urn:lender-agent",
    kid = "independently-held-actor-thumbprint";
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:sam",
    keys: [
      { kid: key.kid, alg: key.alg, publicJwk: key.publicJwk, role: "issuer", subject: source },
    ],
    sourceAuthority: [
      {
        id: "urn:rating-policy",
        version: "1",
        source,
        claimTypes: ["agent.reputation"],
        subjects: [actor],
      },
    ],
  });
  const make = (registered = true, service = source) =>
    new ReputationResolver(
      {
        principal: "Sam",
        trust,
        name: () => "The fictional lender",
        ownList: registered ? [{ party, tasks: ["urn:mortgage"] }] : [],
        root: registered
          ? {
              id: "urn:root",
              name: "Fictional root",
              delegates: [
                {
                  id: "urn:register",
                  name: "Fictional register",
                  answersFor: "lenders",
                  answerTtlMs: 60000,
                  entries: [
                    {
                      party,
                      id: "urn:entry",
                      authorizedFor: ["urn:mortgage"],
                      claimTypes: ["mortgage.product"],
                      status: "authorized",
                    },
                  ],
                },
              ],
            }
          : undefined,
      },
      { service, minimum: 0.8, targets: [{ party, actor, kid }] },
      trust,
      "urn:sam-agent",
    );
  const rating = await issueAgentRating(key, {
    service: source,
    party,
    actor,
    kid,
    score: 0.93,
    at,
  });
  const question = { evaluator: "urn:sam-agent", source: party, claimType: "mortgage.product", at };
  const valid = make();
  await valid.present([rating], at, () => {});
  expect(valid.resolveSource(question).outcome).toBe("accepted");
  const unregistered = make(false);
  await unregistered.present([rating], at, () => {});
  expect(unregistered.resolveSource(question).outcome).not.toBe("accepted");
  for (const attack of [
    "score",
    "actor",
    "subjectKey",
    "issuer",
    "issuedAt",
    "validUntil",
    "signature",
  ]) {
    const value = decodeCompactPayload(rating.value);
    if (attack === "score") value.score = 0.79;
    if (attack === "actor") value.actor = "urn:another-agent";
    if (attack === "subjectKey") value.subjectKey = "another-key";
    if (attack === "issuer") value.issuer = "urn:another-service";
    if (attack === "issuedAt") value.issuedAt = "2027-01-01T00:00:00Z";
    if (attack === "validUntil") value.validUntil = at;
    const forged = {
      ...rating,
      value:
        attack === "signature"
          ? rating.value.slice(0, -5) + "AAAAA"
          : await signStatement(key, "awp-agent-reputation+jws", value),
    };
    const verifier = make();
    await verifier.present([forged], at, () => {});
    expect(verifier.resolveSource(question).outcome, attack).not.toBe("accepted");
  }
  const none = make();
  expect(none.resolveSource(question).outcome).not.toBe("accepted");
  const unknown = make(true, "urn:unaccepted-service");
  await unknown.present([rating], at, () => {});
  expect(unknown.resolveSource(question).outcome).not.toBe("accepted");
  expect(valid.resolveSource({ ...question, at: "2026-11-15T09:00:00Z" }).outcome).not.toBe(
    "accepted",
  );
});
