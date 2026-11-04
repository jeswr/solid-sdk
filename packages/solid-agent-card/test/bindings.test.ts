// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChannelCapability } from "@jeswr/agent-model";
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { describeAgent } from "../src/describe.js";
import { verifyDataset, verifyDescriptor } from "../src/verify.js";
import { BINDINGS_EXTENSION_URI, SUPPORTS_BINDING } from "../src/vocab.js";
import { descriptor, gmail, matrix } from "./fixtures/bindings.js";

describe("channel bindings", () => {
  it("emits golden A2A JSON and ANP Turtle with two capability records", async () => {
    const documents = describeAgent(descriptor);
    await expect(`${JSON.stringify(documents.agentCard, null, 2)}\n`).toMatchFileSnapshot(
      "./fixtures/bindings-card.json",
    );
    await expect(documents.agentDescription.toTurtle()).resolves.toMatchFileSnapshot(
      "./fixtures/bindings-description.ttl",
    );
    expect(documents.agentCard.capabilities?.extensions).toEqual([
      {
        uri: BINDINGS_EXTENSION_URI,
        required: false,
        params: { bindings: [gmail, matrix] },
      },
    ]);
  });

  it.each([
    "text/turtle",
    "application/ld+json",
  ])("round-trips every capability field via %s without fetching", async (contentType) => {
    const documents = describeAgent(descriptor);
    const body =
      contentType === "text/turtle"
        ? await documents.agentDescription.toTurtle()
        : JSON.stringify(await documents.agentDescription.toJsonLd());
    const result = await verifyDescriptor(descriptor.id, {
      body,
      bodyContentType: contentType,
      expectedId: descriptor.id,
      fetch: async () => {
        throw new Error("Must not fetch capability IRIs or contexts.");
      },
    });
    expect(result.issues).toEqual([]);
    expect(result.descriptor?.bindings).toEqual([gmail, matrix]);
  });

  it.each([undefined, []])("omits the extension when bindings are %j", async (bindings) => {
    const documents = describeAgent({ ...descriptor, bindings });
    expect(documents.agentCard.capabilities).toBeUndefined();
    expect(
      documents.agentDescription.quads.some((q) => q.predicate.value === SUPPORTS_BINDING),
    ).toBe(false);
    const result = await verifyDescriptor(descriptor.id, {
      body: await documents.agentDescription.toTurtle(),
    });
    expect(result.valid).toBe(true);
    expect(result.descriptor?.bindings).toBeUndefined();
  });

  it("copies advertised records so later caller mutations cannot change the projections", async () => {
    const binding = structuredClone(gmail);
    const documents = describeAgent({ ...descriptor, bindings: [binding] });
    binding.rateLimit.perDay = 999;
    expect(
      documents.agentCard.capabilities?.extensions[0]?.params.bindings[0]?.rateLimit.perDay,
    ).toBe(50);
    const result = await verifyDescriptor(descriptor.id, {
      body: JSON.stringify(await documents.agentDescription.toJsonLd()),
      bodyContentType: "application/ld+json",
    });
    expect(result.descriptor?.bindings?.[0]?.rateLimit.perDay).toBe(50);
  });

  it.each([
    { ...gmail, id: 'https://evil.example/> <urn:evil> <urn:p> "injected"' },
    { ...gmail, id: "relative" },
    { ...gmail, credentialRef: "must-not-be-published" },
    { ...gmail, maxMessageBytes: -1 },
    { ...gmail, type: "account" },
  ])("rejects malformed records and extra account fields before emission", (binding) => {
    expect(() =>
      describeAgent({ ...descriptor, bindings: [binding as ChannelCapability] }),
    ).toThrow(/invalid channel capability/);
  });

  it("rejects conflicting duplicate capability ids", () => {
    expect(() =>
      describeAgent({ ...descriptor, bindings: [gmail, { ...matrix, id: gmail.id }] }),
    ).toThrow(/duplicate/);
  });

  it.each([
    '"literal"',
    "[]",
    "<https://other.example/missing>",
  ])("rejects invalid or dangling supportsBinding %s", async (value) => {
    const body = await describeAgent({ ...descriptor, bindings: [] }).agentDescription.toTurtle();
    const result = await verifyDescriptor(descriptor.id, {
      body: `${body}\n<${descriptor.id}> <${SUPPORTS_BINDING}> ${value}.`,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid-binding");
  });

  it.each([
    'agent:sendSupported "yes"',
    "agent:maxMessageBytes -1",
    'agent:carriage "another"',
    'agent:credentialRef "private"',
    "a <https://jeswr.org/ns/agent#Account>",
  ])("rejects invalid or ambiguous linked capability data: %s", async (addition) => {
    const body = await describeAgent(descriptor).agentDescription.toTurtle();
    const result = await verifyDescriptor(descriptor.id, {
      body: `${body}\n@prefix agent: <https://jeswr.org/ns/agent#>.\n<${gmail.id}> ${addition}.`,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid-binding");
  });

  it("preserves subject binding when capabilities are present", () => {
    const result = verifyDataset(
      new Store(describeAgent(descriptor).agentDescription.quads),
      "https://other.example/agent",
      { requireSubjectMatch: true },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("subject-mismatch");
  });
});
