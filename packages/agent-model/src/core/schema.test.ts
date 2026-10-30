// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { canonicalJson, digestOf } from "./canonical.js";
import { validateMessage } from "./schema.js";

const operation = { id: "urn:example:operation", version: "1" };
const bodies = {
  description: { description: {} },
  propose: { operation, terms: {}, termsDigest: "test-digest", round: 1 },
  accept: {
    proposal: "urn:example:proposal",
    termsDigest: "test-digest",
    agreement: "urn:example:agreement",
    selection: {},
  },
  invoke: { operation, basis: { kind: "public" }, input: {} },
  deliver: { ref: "urn:example:invocation", operation, basis: { kind: "public" }, output: {} },
  receipt: {
    ref: "urn:example:agreement",
    activity: "urn:example:activity",
    outcome: "completed",
    observed: {},
  },
};
const fields = {
  description: "description",
  propose: "terms",
  accept: "selection",
  invoke: "input",
  deliver: "output",
  receipt: "observed",
} as const;
const message = (kind: keyof typeof bodies, value: unknown) => ({
  profile: "urn:example:profile",
  configuration: "urn:example:configuration",
  id: "urn:example:message",
  conversation: "urn:example:conversation",
  kind,
  from: {},
  createdAt: "2026-10-26T10:30:00Z",
  expiresAt: "2026-10-26T11:30:00Z",
  body: { ...bodies[kind], [fields[kind]]: value },
});

describe("opaque message JSON", () => {
  it.each(
    Object.keys(bodies) as (keyof typeof bodies)[],
  )("preserves %s content and digest", (kind) => {
    const opaque = JSON.parse(
      '{"__proto__":{"retained":true},"nested":{"__proto__":null},"items":[{"__proto__":"retained"}],"constructor":{"prototype":"opaque"},"toJSON":"data"}',
    );
    const input = message(kind, opaque);
    if (kind === "propose") Object.assign(input.body, { termsDigest: digestOf(opaque) });
    const result = validateMessage(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    const content = (result.message.body as unknown as Record<string, unknown>)[fields[kind]];
    expect(content).toBe(opaque);
    expect(Object.hasOwn(content as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(content)).toBe(Object.prototype);
    expect(canonicalJson(result.message)).toBe(canonicalJson(input));
    expect(digestOf(content)).toBe(digestOf(opaque));
  });

  it("refuses non-JSON content and non-object opaque fields", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const kind of Object.keys(bodies) as (keyof typeof bodies)[]) {
      for (const value of [
        null,
        [],
        "text",
        1,
        true,
        cyclic,
        { value: undefined },
        { value: NaN },
        { value: Infinity },
        { value: 1n },
        { value: () => null },
        { value: Symbol("invalid") },
      ]) {
        expect(validateMessage(message(kind, value))).toMatchObject({
          ok: false,
          reason: "malformed",
        });
      }
    }
  });
});
