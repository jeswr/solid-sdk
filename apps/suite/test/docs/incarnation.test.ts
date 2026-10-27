// AUTHORED-BY Codex
import { describe, expect, it } from "vitest";
import {
  DocumentReplacedError,
  incarnationMirror,
  sameIncarnation,
} from "../../src/apps/docs/lib/model/incarnation";

describe("document incarnation", () => {
  const original = { url: "https://pod.test/docs/plan.ttl", data: { instanceId: "first" } };
  it("requires both the URL and an assigned instance id", () => {
    expect(sameIncarnation(original, original)).toBe(true);
    expect(sameIncarnation(original, { ...original, url: `${original.url}-other` })).toBe(false);
    expect(sameIncarnation(original, { ...original, data: { instanceId: "replacement" } })).toBe(
      false,
    );
    expect(sameIncarnation({ ...original, data: {} }, { ...original, data: {} })).toBe(false);
    expect(sameIncarnation(original, { ...original, data: {} })).toBe(false);
  });
  it("keys mirrors by incarnation and log generation with unambiguous tuple boundaries", () => {
    const first = incarnationMirror(original, "updates/");
    expect(
      incarnationMirror({ ...original, data: { instanceId: "replacement" } }, "updates/"),
    ).not.toBe(first);
    expect(incarnationMirror(original, "updates-2/")).not.toBe(first);
    expect(() => incarnationMirror({ ...original, data: {} }, "updates/")).toThrow(
      "Claim the document identity",
    );
    expect(new DocumentReplacedError()).toMatchObject({ status: 409 });
  });
});
