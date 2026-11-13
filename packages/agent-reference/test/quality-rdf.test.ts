// AUTHORED-BY Codex GPT-6
import { LiteralFrom, RequiredAs } from "@rdfjs/wrapper";
import { describe, expect, it } from "vitest";
import { claimTime, fitnessOf } from "../src/gates/quality.js";
import { StatementQualityNode } from "../src/model/quality.js";
import { AWP } from "../src/profile/vocabulary.js";
import { readDocument, writeDocument } from "../src/wire/index.js";

const at = "2026-11-13T10:00:00.000Z";
const profile = {
  id: "urn:test:reliance",
  rules: [
    {
      id: "urn:test:rule",
      text: "Use current authority records.",
      claimType: "income.*",
      methods: ["recorded-by-authority"],
      maxAgeDays: 30,
    },
  ],
};
const fresh = { claimType: "income.monthly", method: "recorded-by-authority", issuedAt: at };
const check = (input: Parameters<typeof StatementQualityNode.from>[0]) =>
  fitnessOf(StatementQualityNode.from(input), profile, at);

describe("fitness reads live RDF metadata", () => {
  it("keeps every refusal independent: missing profile, unknown claim, missing or rejected method, absent time, stale time and expired validity", () => {
    const node = StatementQualityNode.from(fresh);
    expect(fitnessOf(node, undefined, at)).toMatchObject({
      verdict: "indeterminate",
      reason: "missing-context",
    });
    expect(check({ ...fresh, claimType: "balance" })).toMatchObject({
      verdict: "indeterminate",
      reason: "missing-context",
    });
    for (const method of [undefined, "self-reported"])
      expect(check({ ...fresh, method })).toMatchObject({
        verdict: "fail",
        reason: "method-not-accepted",
      });
    expect(check({ ...fresh, issuedAt: undefined })).toMatchObject({
      verdict: "indeterminate",
      reason: "missing-context",
    });
    expect(check({ ...fresh, asOf: "2026-09-01T10:00:00.000Z" })).toMatchObject({
      verdict: "fail",
      reason: "stale-data",
    });
    expect(check({ ...fresh, validUntil: at })).toMatchObject({
      verdict: "fail",
      reason: "stale-data",
    });
    expect(check(fresh)).toMatchObject({ verdict: "pass", ageDays: 0 });
  });

  it("observes graph changes rather than retaining the original object", () => {
    const node = StatementQualityNode.from({
      ...fresh,
      issuer: "urn:test:source",
      subject: "urn:test:person",
    });
    const another = new StatementQualityNode(node.id, node.dataset);
    expect(another.issuer).toBe("urn:test:source");
    expect(another.claimSubject).toBe("urn:test:person");
    expect(StatementQualityNode.from(fresh).claimSubject).toBeUndefined();
    expect(check(another).verdict).toBe("pass");
    RequiredAs.object(node.claims, AWP + "method", "self-reported", LiteralFrom.string);
    expect(check(another)).toMatchObject({ verdict: "fail", reason: "method-not-accepted" });
    expect(fresh.method).toBe("recorded-by-authority");
  });

  it("reads the claim period through its wrapper and keeps date precedence and the inclusive age boundary", () => {
    const node = StatementQualityNode.from({
      ...fresh,
      period: { start: "2026-09", end: "2026-10" },
    });
    expect(claimTime(node)).toBe("2026-10-31T23:59:59.000Z");
    if (!node.period) throw new Error("period missing");
    node.period.end = "2026-09";
    expect(claimTime(node)).toBe("2026-09-30T23:59:59.000Z");
    expect(check(node)).toMatchObject({ verdict: "fail", reason: "stale-data" });
    expect(check({ ...fresh, asOf: "2026-10-14T10:00:00.000Z" })).toMatchObject({
      verdict: "pass",
      ageDays: 30,
    });
    expect(check({ ...fresh, asOf: "2026-10-13T10:00:00.000Z" })).toMatchObject({
      verdict: "fail",
      reason: "stale-data",
      ageDays: 31,
    });
  });

  it("writes and re-admits the very metadata graph evaluated by the fitness check", async () => {
    const partial = await writeDocument(StatementQualityNode.from(fresh));
    expect(await readDocument(JSON.stringify(partial), "application/ld+json")).toMatchObject({
      ok: false,
      detail: expect.stringContaining("credentials#issuer"),
    });
    const node = StatementQualityNode.from({
      ...fresh,
      issuer: "urn:test:source",
      subject: "urn:test:person",
      validUntil: "2026-12-01T10:00:00.000Z",
      period: { start: "2026-10", end: "2026-10" },
    });
    const document = await writeDocument(node);
    expect(document).toMatchObject({
      issuedAt: at,
      validUntil: "2026-12-01T10:00:00.000Z",
      credentialSubject: { period: { start: "2026-10", end: "2026-10" } },
    });
    const read = await readDocument(JSON.stringify(document), "application/ld+json");
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.detail);
    expect(check(new StatementQualityNode(read.root, read.dataset))).toEqual(check(node));
  });
});
