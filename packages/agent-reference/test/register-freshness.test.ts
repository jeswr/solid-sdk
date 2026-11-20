// AUTHORED-BY Codex GPT-6.2 Sol
import { expect, it } from "vitest";
import { TrustStore } from "../src/mechanisms/trust.js";
import { type AnsweredEntry, TrustResolver } from "../src/trust/resolver.js";

it("resolves a signed suspension ahead of stale register authorisation with a fixed expiry", async () => {
  const register = "urn:test:financial-register",
    lender = "urn:test:lender";
  const task = "urn:op:loan",
    claimType = "loan.status";
  const resolver = new TrustResolver({
    principal: "owner",
    trust: await TrustStore.load({ version: 1, owner: "urn:owner", keys: [], sourceAuthority: [] }),
    name: String,
    answeredRegisters: [register],
    root: {
      id: "urn:test:root",
      name: "Root",
      delegates: [
        { id: register, name: "Lenders", answersFor: "lenders", entries: [], answerTtlMs: 60_000 },
      ],
    },
  });
  const answer: AnsweredEntry = {
    register,
    signedAt: "2026-11-20T12:00:00Z",
    validUntil: "2026-11-20T12:00:50Z",
    entry: {
      id: "urn:register:1",
      party: lender,
      authorizedFor: [task],
      claimTypes: [claimType],
      status: "authorized",
    },
  };
  const answers = [answer];
  resolver.bindAnswers(() => answers);
  const resolve = (at: string) => [
    resolver.resolveSource({ evaluator: "urn:actor", source: lender, claimType, at }),
    resolver.resolveRecipient({ party: lender, task, taskLabel: "a loan", at }),
  ];
  for (const checked of resolve("2026-11-20T12:00:45Z"))
    expect(checked).toMatchObject({ outcome: "accepted", expires: "2026-11-20T12:00:50.000Z" });
  for (const checked of resolve("2026-11-20T12:00:51Z"))
    expect(checked.outcome).toBe("not-accepted");
  answers.push({
    ...answer,
    signedAt: "2026-11-20T12:00:20Z",
    validUntil: "2026-11-20T12:00:30Z",
    entry: { ...answer.entry, id: "urn:register:2", status: "suspended" },
  });
  for (const time of ["2026-11-20T12:00:25Z", "2026-11-20T12:00:45Z"])
    for (const checked of resolve(time))
      expect(checked).toMatchObject({ outcome: "not-accepted", rule: { id: "urn:register:2" } });
});

it("requires explicit registered-role evidence even with a matching own-list entry", async () => {
  const task = "urn:role:lender";
  const ownOperation = "urn:op:balance-copy";
  const valuer = "urn:valuer";
  const lender = "urn:lender";
  const at = "2026-11-20T12:00:00Z";
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:owner",
    keys: [],
    sourceAuthority: [],
  });
  const resolver = new TrustResolver({
    principal: "owner",
    trust,
    name: String,
    ownList: [{ party: valuer, tasks: [ownOperation, task] }],
    root: {
      id: "urn:root",
      name: "Root",
      delegates: [
        {
          id: "urn:register",
          name: "Register",
          answersFor: "lenders",
          answerTtlMs: 60_000,
          entries: [
            {
              id: "urn:entry:valuer",
              party: valuer,
              authorizedFor: [ownOperation],
              status: "authorized",
            },
            {
              id: "urn:entry:lender",
              party: lender,
              authorizedFor: [task],
              status: "authorized",
              expiresAt: "2026-11-20T12:01:00Z",
            },
          ],
        },
      ],
    },
  });
  const roleOf = (party: string, when = at) =>
    resolver.resolveRecipient({ party, task, taskLabel: "lender", at: when, registeredRole: true })
      .outcome;
  expect(
    resolver.resolveRecipient({ party: valuer, task: ownOperation, taskLabel: "balance copy", at })
      .outcome,
  ).toBe("accepted");
  expect(roleOf(valuer)).not.toBe("accepted");
  expect(roleOf(lender)).toBe("accepted");
  expect(roleOf(lender, "2026-11-20T12:01:00Z")).toBe("not-accepted");
});
