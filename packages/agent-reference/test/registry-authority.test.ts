// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { FictionalAgentRegistry } from "../src/mechanisms/agent-registry.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";

it("binds current registration to accepted issuer, principal, actor key, query and operation", async () => {
  const key = await testKey("registry-authority");
  let at = "2026-11-13T09:00:00.000Z";
  const registry = new FictionalAgentRegistry("urn:registry", key, () => at);
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:principal",
    sourceAuthority: [],
    keys: [
      {
        kid: key.kid,
        alg: key.alg,
        publicJwk: key.publicJwk,
        role: "issuer",
        subject: registry.identity,
      },
    ],
  });
  const entry = {
    actor: "urn:actor",
    principal: "urn:principal",
    actorKid: (await testKey("registered-actor")).kid,
    operations: ["urn:operation:apply"],
    status: "active" as const,
  };
  registry.register(entry);
  const expected = {
    ...entry,
    kid: entry.actorKid,
    operation: "urn:operation:apply",
    trust,
    accepted: true,
  };
  const signed = await registry.lookup(entry.actor, "urn:query:1");
  expect((await registry.verify(signed, "urn:query:1", expected)).ok).toBe(true);
  for (const changed of [
    { accepted: false },
    { principal: "urn:thief" },
    { actor: "urn:actor:other" },
    { kid: "copied-key" },
    { operation: "urn:operation:pay" },
  ])
    expect((await registry.verify(signed, "urn:query:1", { ...expected, ...changed })).ok).toBe(
      false,
    );
  expect((await registry.verify(signed, "urn:query:2", expected)).ok).toBe(false);
  at = "2026-11-13T09:01:00.000Z";
  expect((await registry.verify(signed, "urn:query:1", expected)).ok).toBe(false);
  registry.register({ ...entry, status: "suspended" });
  expect(await registry.check(expected)).toMatchObject({ ok: false, reason: "mandate-withdrawn" });
  registry.available = false;
  expect(await registry.check(expected)).toMatchObject({ ok: false, reason: "lookup-failed" });
});
