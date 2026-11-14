// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { FictionalOriginDirectory } from "../src/standins/origin-hosted.js";
import { OriginHostedVerifier } from "../src/suites/authenticity-origin.js";
import { decodeCompactPayload } from "../src/wire/inspect.js";

it("ignores the message pointer, checks the independent register and never turns an origin observation into a transferable proof", async () => {
  const key = await testKey("origin/register"),
    at = "2026-11-13T09:00:00.000Z",
    register = "https://register.example/",
    source = "https://lender.example/",
    address = "https://lender.example/products/fixed";
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:sam",
    keys: [
      { kid: key.kid, alg: key.alg, publicJwk: key.publicJwk, role: "issuer", subject: register },
    ],
    sourceAuthority: [
      {
        id: "urn:source-address-rule",
        version: "1",
        source: register,
        claimTypes: ["source.address"],
        subjects: [source],
      },
    ],
  });
  const directory = new FictionalOriginDirectory({ identity: register, key }, at);
  await directory.publish(address, {
    id: "urn:product",
    issuer: source,
    claimType: "mortgage.product",
    method: "published-by-lender",
    issuedAt: at,
    product: { name: "A fictional product" },
  });
  const verifier = new OriginHostedVerifier(register, directory.fetch),
    item = {
      role: "credential" as const,
      format: "origin-hosted",
      value: directory.locator("urn:product", true),
    };
  const observed = await verifier.verify(item, trust, at, "urn:sam-agent", () => {});
  expect(observed?.string("issuer")).toBe(source);
  expect(directory.requests).toEqual([address]);
  expect(verifier.nonTransferable("urn:product")).toBe(true);
  expect(observed?.fieldsOnly(["id", "issuer", "claimType", "method", "issuedAt", "product"])).toBe(
    true,
  );
  for (const attack of ["signature", "issuer", "subject", "recordId", "address", "validUntil"]) {
    const locator = JSON.parse(item.value),
      anchor = decodeCompactPayload(locator.anchor);
    if (attack === "signature") locator.anchor = locator.anchor.slice(0, -5) + "AAAAA";
    else {
      anchor[attack] =
        attack === "validUntil"
          ? at
          : attack === "address"
            ? "http://127.0.0.1/private"
            : attack === "recordId"
              ? "urn:another-product"
              : "https://attacker.example/";
      locator.anchor = await signStatement(key, "awp-source-address+jws", anchor);
    }
    expect(
      await verifier.verify(
        { ...item, value: JSON.stringify(locator) },
        trust,
        at,
        "urn:sam-agent",
        () => {},
      ),
      attack,
    ).toBeUndefined();
  }
  expect(
    await verifier.verify(item, TrustStore.empty("urn:sam"), at, "urn:sam-agent", () => {}),
  ).toBeUndefined();
  for (const response of [
    new Response("", { status: 302, headers: { location: "https://attacker.example/" } }),
    new Response("{}", { headers: { "content-type": "text/plain" } }),
    new Response(
      JSON.stringify({
        id: "urn:product",
        issuer: "https://attacker.example/",
        claimType: "mortgage.product",
        method: "published-by-lender",
        issuedAt: at,
      }),
      { headers: { "content-type": "application/json" } },
    ),
  ]) {
    const checker = new OriginHostedVerifier(register, async () => response);
    expect(await checker.verify(item, trust, at, "urn:sam-agent", () => {})).toBeUndefined();
  }
});
it("stops transferable origin evidence even when an action has an independent permit", async () => {
  const { GateMemory } = await import("../src/gates/common.js");
  const { OutboundGate } = await import("../src/gates/outbound.js");
  const { BASELINE } = await import("../src/suites/baseline.js");
  const { digestOf } = await import("../src/core/canonical.js");
  const key = await testKey("origin/outbound-register"),
    at = "2026-11-13T09:00:00.000Z",
    source = "https://lender.example/",
    register = "https://register.example/";
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:sam",
    keys: [
      { kid: key.kid, alg: key.alg, publicJwk: key.publicJwk, role: "issuer", subject: register },
    ],
    sourceAuthority: [
      {
        id: "urn:rule",
        version: "1",
        source: register,
        claimTypes: ["source.address"],
        subjects: [source],
      },
    ],
  });
  const directory = new FictionalOriginDirectory({ identity: register, key }, at);
  await directory.publish("https://lender.example/product", {
    id: "urn:product",
    issuer: source,
    claimType: "mortgage.product",
    method: "published-by-lender",
    issuedAt: at,
  });
  const origin = new OriginHostedVerifier(register, directory.fetch);
  await origin.verify(
    { role: "credential", format: "origin-hosted", value: directory.locator("urn:product") },
    trust,
    at,
    "urn:sam-agent",
    () => {},
  );
  const memory = new GateMemory();
  memory.facts.set("urn:product", {
    id: "urn:product",
    claimType: "mortgage.product",
    source,
    label: "The unsigned product",
  });
  const gate = new OutboundGate({
    identity: { actor: "urn:sam-agent", party: "urn:sam" },
    now: () => at,
    mandate: () => undefined,
    gate: { configuration: BASELINE, originHosted: origin },
    memory,
    isReplyTo: () => true,
    offerTerms: () => undefined,
  });
  const intent = {
    action: "distribute",
    target: "urn:product",
    operation: "urn:share-product",
    recipient: "urn:valuer",
    purpose: "urn:product-search",
    conversation: "urn:conversation",
    parameters: { evidence: ["urn:product"] },
  };
  const result = gate.release(intent, {
    type: "authorisation-decision",
    decider: "urn:sam-agent",
    action: intent,
    actionDigest: digestOf(intent),
    at,
    outcome: "permit",
    reason: "within-mandate",
    policy: { id: "urn:exact-permission", digest: "digest", evaluator: "test" },
  });
  expect(result).toMatchObject({ outcome: "stop", decision: { reason: "evidence-invalid" } });
  expect(result.verdicts).toContainEqual(
    expect.objectContaining({ check: "evidence", reason: "evidence-invalid" }),
  );
});
