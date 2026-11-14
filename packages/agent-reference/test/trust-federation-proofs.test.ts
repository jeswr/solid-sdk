// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { signCompact } from "../src/mechanisms/jws.js";
import { testKey } from "../src/reference/keys.js";
import { presentFederation } from "../src/standins/federation.js";
import { verifyFederationChain } from "../src/suites/trust-federation.js";
import { decodeCompactPayload } from "../src/wire/inspect.js";

it("checks every JWT signature, anchor, hop, expiry, hint, algorithm and effective policy", async () => {
  const [root, superior, lender, actor, attacker] = await Promise.all(
    ["root", "superior", "lender", "actor", "attacker"].map((x) => testKey(`federation/${x}`)),
  );
  const input = {
    anchor: { id: "https://federation.example/authority", key: root! },
    superior: { id: "https://federation.example/superior", key: superior! },
    subject: { id: "https://lender.example/", key: lender!, actorKey: actor! },
    purpose: "urn:purpose:residential",
    claimTypes: ["mortgage.product"],
    at: "2026-11-13T09:00:00.000Z",
  };
  const evidence = await presentFederation(input);
  const policy = {
    anchor: input.anchor.id,
    keys: [root!],
    subject: input.subject.id,
    purpose: input.purpose,
    claimTypes: input.claimTypes,
    expectedSubjectKey: lender!.kid,
  };
  expect((await verifyFederationChain(evidence, policy, input.at)).ok).toBe(true);
  for (let i = 0; i < evidence.length; i++) {
    const bad = evidence.map((e) => ({ ...e }));
    bad[i]!.value = bad[i]!.value.slice(0, -5) + "AAAAA";
    expect((await verifyFederationChain(bad, policy, input.at)).ok, `signature ${i}`).toBe(false);
  }
  expect((await verifyFederationChain(evidence.slice(1), policy, input.at)).ok).toBe(false);
  expect((await verifyFederationChain([...evidence].reverse(), policy, input.at)).ok).toBe(false);
  expect(
    (await verifyFederationChain(evidence, { ...policy, keys: [attacker!] }, input.at)).ok,
  ).toBe(false);
  expect(
    (
      await verifyFederationChain(
        evidence,
        { ...policy, expectedSubjectKey: attacker!.kid },
        input.at,
      )
    ).ok,
  ).toBe(false);
  for (const field of ["iss", "sub", "authority_hints", "jwks"]) {
    const bad = evidence.map((e) => ({ ...e })),
      payload = decodeCompactPayload(bad[3]!.value);
    payload[field] =
      field === "authority_hints"
        ? ["https://unrelated.example/"]
        : field === "jwks"
          ? { keys: [{ ...attacker!.publicJwk, kid: attacker!.kid }] }
          : "https://unrelated.example/";
    bad[3]!.value = await signCompact(lender!, "entity-statement+jwt", payload);
    expect((await verifyFederationChain(bad, policy, input.at)).ok, field).toBe(false);
  }
  expect(
    await verifyFederationChain(
      await presentFederation({ ...input, expired: true }),
      policy,
      input.at,
    ),
  ).toMatchObject({ ok: false, reason: "lookup-failed" });
  expect(
    await verifyFederationChain(
      await presentFederation({ ...input, businessOnly: true }),
      policy,
      input.at,
    ),
  ).toMatchObject({ ok: false, reason: "source-not-authoritative" });
  expect((await verifyFederationChain(evidence, policy, "2026-11-15T09:00:00Z")).ok).toBe(false);
});
it("expires a previously presented chain before another source or recipient decision", async () => {
  const { PresentedFederationResolver } = await import("../src/suites/trust-federation.js");
  const { TrustStore } = await import("../src/mechanisms/trust.js");
  const [root, superior, lender, actor] = await Promise.all(
    ["root", "superior", "lender", "actor"].map((x) => testKey(`federation/expiry/${x}`)),
  );
  const at = "2026-11-13T09:00:00.000Z";
  const input = {
    anchor: { id: "https://federation.example/authority", key: root! },
    superior: { id: "https://federation.example/superior", key: superior! },
    subject: { id: "https://lender.example/", key: lender!, actorKey: actor! },
    purpose: "urn:purpose:residential",
    claimTypes: ["mortgage.product"],
    at,
  };
  const policy = {
    anchor: input.anchor.id,
    keys: [root!],
    subject: input.subject.id,
    purpose: input.purpose,
    claimTypes: input.claimTypes,
    expectedSubjectKey: lender!.kid,
  };
  const resolver = new PresentedFederationResolver(
    { principal: "Sam", trust: TrustStore.empty("urn:sam"), name: () => "The fictional lender" },
    policy,
  );
  expect((await resolver.present(await presentFederation(input), at)).ok).toBe(true);
  expect(
    resolver.resolveSource({
      evaluator: "urn:sam-agent",
      source: policy.subject,
      claimType: "mortgage.product",
      at,
    }).outcome,
  ).toBe("accepted");
  expect(
    resolver.resolveSource({
      evaluator: "urn:sam-agent",
      source: policy.subject,
      claimType: "mortgage.product",
      at: "2026-11-15T09:00:00Z",
    }).outcome,
  ).toBe("unresolved");
  expect(
    resolver.resolveRecipient({
      party: policy.subject,
      task: "urn:mortgage",
      taskLabel: "a mortgage",
      at: "2026-11-15T09:00:00Z",
    }).outcome,
  ).toBe("unresolved");
});
